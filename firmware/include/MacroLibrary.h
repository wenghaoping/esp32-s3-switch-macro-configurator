#pragma once

// 文件职责：声明网页自定义宏的 SPIFFS 持久化库。
// 每个槽位保存一份完整 UserMacro；若该槽位有 Flash 记录，它会覆盖同槽位
// 的 C++ 内置宏。删除 Flash 记录后，固件会再次使用内置版本。

#include <stddef.h>
#include <stdint.h>

#include "SlotLimits.h"
#include "UserMacro.h"

namespace farmers {

// 名称按 UTF-8 字节计数；网页会以相同的 32 字节限制校验。
constexpr size_t kMacroLibraryNameBytes = 32;

struct MacroSlotInfo {
  // 仅保存供 MACRO_LIST 返回的轻量摘要，不含 512 步动作数组。
  bool occupied;
  char name[kMacroLibraryNameBytes + 1];
  uint16_t stepCount;
  uint32_t durationMs;
  uint32_t loopGapMs;
  bool repeat;
};

class MacroLibrary {
 public:
  // 挂载 SPIFFS，并扫描十二个槽位的 Flash 文件。
  bool begin();
  bool available() const;
  const char* storageStatus() const;
  bool hasAnyMacro() const;
  int8_t activeSlot() const;
  const MacroSlotInfo& slotInfo(uint8_t slot) const;

  // 读取、保存、删除一个 Flash 宏；save 采用临时文件替换，避免断电留下半文件。
  bool load(uint8_t slot, UserMacro* macro, MacroSlotInfo* info = nullptr);
  bool save(uint8_t slot, const char* name, const UserMacro& macro);
  bool erase(uint8_t slot);
  // 仅由用户显式发起；清空宏库后重新挂载，但不会在 begin() 中自动调用。
  bool resetStorage();
  // 记录上次选择的 Flash 槽位；-1 表示当前使用内置宏或默认宏。
  bool setActive(int8_t slot);

 private:
  bool mounted_ = false;
  int8_t activeSlot_ = -1;
  MacroSlotInfo slots_[kMacroLibrarySlotCount]{};
};

}  // namespace farmers
