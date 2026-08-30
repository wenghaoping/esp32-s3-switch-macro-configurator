#include "MacroLibrary.h"

#include <FS.h>
#include <SPIFFS.h>

#include <stdio.h>
#include <string.h>

// 文件职责：实现 12 槽网页宏的 SPIFFS 文件存储。
// 每槽使用“临时文件 -> 旧文件备份 -> 替换”的小型事务，尽量避免断电时将
// 已保存宏破坏成半份数据；读取时还会检查魔数、版本、动作范围与校验和。

namespace farmers {
namespace {

constexpr uint32_t kLibraryMacroMagic = 0x53464d32u;
constexpr uint16_t kLibraryMacroVersion = 4;
constexpr uint32_t kLibraryIndexMagic = 0x53464c31u;
constexpr uint16_t kLibraryIndexVersion = 1;
constexpr char kIndexPath[] = "/macro-index.bin";
constexpr char kIndexTemporaryPath[] = "/macro-index.tmp";
constexpr char kIndexBackupPath[] = "/macro-index.bak";

struct StoredLibraryMacro {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  char name[kMacroLibraryNameBytes + 1];
  UserMacro macro;
  uint32_t checksum;
};

struct StoredLibraryIndex {
  uint32_t magic;
  uint16_t version;
  int8_t activeSlot;
  uint8_t reserved;
  uint32_t checksum;
};

// 512 步记录超过 6 KiB。使用全局共享缓冲区而不是 Arduino loopTask 栈，
// 避免串口解析与存储同时占用栈空间时触发栈溢出。
StoredLibraryMacro RecordBuffer{};

void slotPath(uint8_t slot, char* path, size_t pathSize) {
  snprintf(path, pathSize, "/macro-%u.bin", static_cast<unsigned int>(slot));
}

void slotTemporaryPath(uint8_t slot, char* path, size_t pathSize) {
  snprintf(path, pathSize, "/macro-%u.tmp", static_cast<unsigned int>(slot));
}

void slotBackupPath(uint8_t slot, char* path, size_t pathSize) {
  snprintf(path, pathSize, "/macro-%u.bak", static_cast<unsigned int>(slot));
}

uint32_t indexChecksum(const StoredLibraryIndex& index) {
  uint32_t checksum = kUserMacroChecksumOffset;
  checksum = macroChecksumUint32(checksum, index.magic);
  checksum = macroChecksumUint16(checksum, index.version);
  return macroChecksumByte(checksum, static_cast<uint8_t>(index.activeSlot));
}

bool readExact(const char* path, void* value, size_t size) {
  File file = SPIFFS.open(path, FILE_READ);
  if (!file || file.size() != size) {
    if (file) {
      file.close();
    }
    return false;
  }
  const size_t read = file.read(static_cast<uint8_t*>(value), size);
  file.close();
  return read == size;
}

bool writeExact(const char* path, const void* value, size_t size) {
  File file = SPIFFS.open(path, FILE_WRITE);
  if (!file) {
    return false;
  }
  const size_t written = file.write(static_cast<const uint8_t*>(value), size);
  file.close();
  return written == size;
}

bool replaceFile(const char* path, const char* temporaryPath, const char* backupPath,
                 const void* value, size_t size) {
  // 写入顺序：先完整写临时文件，再把旧文件改名为备份，最后提升临时文件。
  // 任何一步失败都会尽力恢复旧文件。
  SPIFFS.remove(temporaryPath);
  if (!writeExact(temporaryPath, value, size)) {
    SPIFFS.remove(temporaryPath);
    return false;
  }

  SPIFFS.remove(backupPath);
  const bool hadPrevious = SPIFFS.exists(path);
  if (hadPrevious && !SPIFFS.rename(path, backupPath)) {
    SPIFFS.remove(temporaryPath);
    return false;
  }
  if (!SPIFFS.rename(temporaryPath, path)) {
    if (hadPrevious) {
      SPIFFS.rename(backupPath, path);
    }
    SPIFFS.remove(temporaryPath);
    return false;
  }
  SPIFFS.remove(backupPath);
  return true;
}

void clearSlotInfo(MacroSlotInfo* info) {
  *info = {};
}

void copyName(char* destination, const char* source, uint8_t slot) {
  if (source == nullptr || source[0] == '\0') {
    snprintf(destination, kMacroLibraryNameBytes + 1, "Macro %u",
             static_cast<unsigned int>(slot + 1));
    return;
  }
  strncpy(destination, source, kMacroLibraryNameBytes);
  destination[kMacroLibraryNameBytes] = '\0';
}

bool readRecord(uint8_t slot, StoredLibraryMacro* stored) {
  // 文件尺寸也是格式的一部分，先拒绝旧版本或截断文件。
  char path[20] = {};
  slotPath(slot, path, sizeof(path));
  File file = SPIFFS.open(path, FILE_READ);
  if (!file) {
    return false;
  }
  const size_t size = file.size();
  if (size != sizeof(*stored)) {
    file.close();
    return false;
  }
  const size_t read = file.read(reinterpret_cast<uint8_t*>(stored), size);
  file.close();
  stored->name[kMacroLibraryNameBytes] = '\0';
  return read == size && stored->magic == kLibraryMacroMagic &&
         stored->version == kLibraryMacroVersion && stored->name[0] != '\0' &&
         isUserMacroValid(stored->macro) &&
         stored->checksum == userMacroChecksum(stored->macro);
}

void assignSlotInfo(MacroSlotInfo* info, const StoredLibraryMacro& stored) {
  *info = {};
  info->occupied = true;
  copyName(info->name, stored.name, 0);
  info->stepCount = stored.macro.stepCount;
  info->durationMs = userMacroDurationMs(stored.macro);
  info->loopGapMs = stored.macro.loopGapMs;
  info->repeat = stored.macro.repeat;
}

}  // namespace

bool MacroLibrary::begin() {
  // 启动时重建内存摘要；Flash 文件本身仍保持按需读取。
  // 严禁在启动路径自动格式化。突然断电、分区配置错误或文件系统损坏时，
  // 保留现场并让上层回退到 C++ 内置宏，等待用户明确确认后再 resetStorage()。
  mounted_ = SPIFFS.begin(false);
  activeSlot_ = -1;
  for (MacroSlotInfo& slot : slots_) {
    clearSlotInfo(&slot);
  }
  if (!mounted_) {
    return false;
  }

  StoredLibraryIndex index{};
  if (readExact(kIndexPath, &index, sizeof(index)) &&
      index.magic == kLibraryIndexMagic &&
      index.version == kLibraryIndexVersion &&
      index.checksum == indexChecksum(index) && index.activeSlot >= -1 &&
      index.activeSlot < static_cast<int8_t>(kMacroLibrarySlotCount)) {
    activeSlot_ = index.activeSlot;
  }

  for (uint8_t slot = 0; slot < kMacroLibrarySlotCount; ++slot) {
    if (readRecord(slot, &RecordBuffer)) {
      assignSlotInfo(&slots_[slot], RecordBuffer);
    }
  }
  if (activeSlot_ >= 0 && !slots_[activeSlot_].occupied) {
    activeSlot_ = -1;
  }
  return true;
}

bool MacroLibrary::available() const {
  return mounted_;
}

const char* MacroLibrary::storageStatus() const {
  return mounted_ ? "ready" : "mount-failed";
}

bool MacroLibrary::hasAnyMacro() const {
  for (const MacroSlotInfo& slot : slots_) {
    if (slot.occupied) {
      return true;
    }
  }
  return false;
}

int8_t MacroLibrary::activeSlot() const {
  return activeSlot_;
}

const MacroSlotInfo& MacroLibrary::slotInfo(uint8_t slot) const {
  static const MacroSlotInfo kEmpty{};
  return slot < kMacroLibrarySlotCount ? slots_[slot] : kEmpty;
}

bool MacroLibrary::load(uint8_t slot, UserMacro* macro, MacroSlotInfo* info) {
  // 成功读取 Flash 记录即代表该槽位覆盖同槽位的 C++ 内置宏。
  if (!mounted_ || macro == nullptr || slot >= kMacroLibrarySlotCount) {
    return false;
  }
  if (!readRecord(slot, &RecordBuffer)) {
    return false;
  }
  *macro = RecordBuffer.macro;
  assignSlotInfo(&slots_[slot], RecordBuffer);
  if (info != nullptr) {
    *info = slots_[slot];
  }
  return true;
}

bool MacroLibrary::save(uint8_t slot, const char* name, const UserMacro& macro) {
  if (!mounted_ || slot >= kMacroLibrarySlotCount || !isUserMacroValid(macro) ||
      name == nullptr || name[0] == '\0') {
    return false;
  }

  // 不使用 `RecordBuffer = {}`：该写法可能在 loopTask 栈创建完整临时对象。
  memset(&RecordBuffer, 0, sizeof(RecordBuffer));
  RecordBuffer.magic = kLibraryMacroMagic;
  RecordBuffer.version = kLibraryMacroVersion;
  copyName(RecordBuffer.name, name, slot);
  RecordBuffer.macro = macro;
  RecordBuffer.checksum = userMacroChecksum(macro);

  char path[20] = {};
  char temporaryPath[20] = {};
  char backupPath[20] = {};
  slotPath(slot, path, sizeof(path));
  slotTemporaryPath(slot, temporaryPath, sizeof(temporaryPath));
  slotBackupPath(slot, backupPath, sizeof(backupPath));
  if (!replaceFile(path, temporaryPath, backupPath, &RecordBuffer,
                   sizeof(RecordBuffer))) {
    return false;
  }
  assignSlotInfo(&slots_[slot], RecordBuffer);
  return true;
}

bool MacroLibrary::erase(uint8_t slot) {
  // 删除的只是 Flash 覆盖；main.cpp 随后会自动回退到 C++ 内置宏（若存在）。
  if (!mounted_ || slot >= kMacroLibrarySlotCount) {
    return false;
  }
  char path[20] = {};
  slotPath(slot, path, sizeof(path));
  const bool wasActive = activeSlot_ == static_cast<int8_t>(slot);
  if (wasActive && !setActive(-1)) {
    return false;
  }
  if (SPIFFS.exists(path) && !SPIFFS.remove(path)) {
    if (wasActive) {
      setActive(static_cast<int8_t>(slot));
    }
    return false;
  }
  clearSlotInfo(&slots_[slot]);
  return true;
}

bool MacroLibrary::resetStorage() {
  // 这是唯一允许格式化宏 SPIFFS 的入口，必须由用户通过明确的网页操作触发。
  // 先卸载再格式化，避免在仍有文件句柄时破坏挂载状态。
  if (mounted_) {
    SPIFFS.end();
  }
  mounted_ = false;
  activeSlot_ = -1;
  for (MacroSlotInfo& slot : slots_) {
    clearSlotInfo(&slot);
  }

  if (!SPIFFS.format()) {
    return false;
  }
  mounted_ = SPIFFS.begin(false);
  return mounted_;
}

bool MacroLibrary::setActive(int8_t slot) {
  if (!mounted_ || slot < -1 ||
      slot >= static_cast<int8_t>(kMacroLibrarySlotCount) ||
      (slot >= 0 && !slots_[slot].occupied)) {
    return false;
  }
  StoredLibraryIndex index{};
  index.magic = kLibraryIndexMagic;
  index.version = kLibraryIndexVersion;
  index.activeSlot = slot;
  index.checksum = indexChecksum(index);
  if (!replaceFile(kIndexPath, kIndexTemporaryPath, kIndexBackupPath, &index,
                   sizeof(index))) {
    return false;
  }
  activeSlot_ = slot;
  return true;
}

}  // namespace farmers
