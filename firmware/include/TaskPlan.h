#pragma once

// 文件职责：定义“板载任务方案”的纯数据格式和校验函数。
// 一个任务方案可按顺序运行最多 5 个宏槽位，并可为每项设置执行次数和间隔；
// 它与单个宏分开保存，因此可在断开网页后继续执行。

#include <stddef.h>
#include <stdint.h>

#include "SlotLimits.h"
#include "UserMacro.h"

namespace farmers {

constexpr uint8_t kMaxTaskPlanEntries = 5;
constexpr uint16_t kMaxTaskPlanRepeatCount = 10000;
constexpr uint32_t kMaxTaskPlanGapMs = 600000;
constexpr size_t kTaskPlanNameBytes = 32;

struct TaskPlanEntry {
  // slot 使用 0 基槽位编号；repeatCount 是本项完整宏的运行次数。
  uint8_t slot;
  uint16_t repeatCount;
  uint32_t gapMs;
};

struct TaskPlan {
  // 任务名称、顺序项数，以及整套任务完成后是否回到第 1 项。
  char name[kTaskPlanNameBytes + 1];
  TaskPlanEntry entries[kMaxTaskPlanEntries];
  uint8_t entryCount;
  bool repeat;
};

// 检查数据结构自身的范围；“槽位当前是否存在”由 main.cpp 额外检查。
inline bool isTaskPlanStructValid(const TaskPlan& plan) {
  if (plan.name[0] == '\0' || plan.entryCount == 0 ||
      plan.entryCount > kMaxTaskPlanEntries) {
    return false;
  }
  for (size_t index = 0; index < plan.entryCount; ++index) {
    const TaskPlanEntry& entry = plan.entries[index];
    if (entry.slot >= kMacroLibrarySlotCount || entry.repeatCount == 0 ||
        entry.repeatCount > kMaxTaskPlanRepeatCount ||
        entry.gapMs > kMaxTaskPlanGapMs) {
      return false;
    }
  }
  return true;
}

// 与网页 task-plan.js 使用同一 FNV-1a 风格校验，防止串口传输或存储损坏。
inline uint32_t taskPlanChecksum(const TaskPlan& plan) {
  uint32_t checksum = kUserMacroChecksumOffset;
  for (size_t index = 0; index < kTaskPlanNameBytes + 1; ++index) {
    checksum = macroChecksumByte(checksum,
                                 static_cast<uint8_t>(plan.name[index]));
    if (plan.name[index] == '\0') {
      break;
    }
  }
  checksum = macroChecksumByte(checksum, plan.entryCount);
  checksum = macroChecksumByte(checksum, plan.repeat ? 1 : 0);
  for (size_t index = 0; index < plan.entryCount; ++index) {
    const TaskPlanEntry& entry = plan.entries[index];
    checksum = macroChecksumByte(checksum, entry.slot);
    checksum = macroChecksumUint16(checksum, entry.repeatCount);
    checksum = macroChecksumUint32(checksum, entry.gapMs);
  }
  return checksum;
}

}  // namespace farmers
