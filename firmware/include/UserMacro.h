#pragma once

// 文件职责：定义网页上传/Flash 保存的完整宏格式、边界约束和校验和。
// 内置宏也会在 main.cpp 中复制为 UserMacro 后交给同一个 MacroEngine 执行，
// 因而两种来源共享完全相同的动作语义。

#include <stddef.h>
#include <stdint.h>

#include "MacroEngine.h"

namespace farmers {

constexpr size_t kMaxUserMacroSteps = 512;
constexpr uint32_t kMinUserMacroStepMs = 10;
constexpr uint32_t kMaxUserMacroStepMs = 600000;
constexpr uint32_t kMaxUserMacroLoopGapMs = 600000;
constexpr uint32_t kUserMacroChecksumOffset = 2166136261u;
constexpr uint32_t kUserMacroChecksumPrime = 16777619u;

struct UserMacro {
  // 固定上限数组避免嵌入式运行时动态分配；有效长度由 stepCount 决定。
  MacroStep steps[kMaxUserMacroSteps];
  uint16_t stepCount;
  uint32_t loopGapMs;
  bool repeat;
};

// 以下三个函数按小端字节序递推 FNV-1a 风格校验，须与网页 macro-editor.js
// 保持字段顺序和字节顺序一致，不能随意调整。
inline uint32_t macroChecksumByte(uint32_t checksum, uint8_t value) {
  return (checksum ^ value) * kUserMacroChecksumPrime;
}

inline uint32_t macroChecksumUint16(uint32_t checksum, uint16_t value) {
  checksum = macroChecksumByte(checksum, static_cast<uint8_t>(value));
  return macroChecksumByte(checksum, static_cast<uint8_t>(value >> 8));
}

inline uint32_t macroChecksumUint32(uint32_t checksum, uint32_t value) {
  checksum = macroChecksumByte(checksum, static_cast<uint8_t>(value));
  checksum = macroChecksumByte(checksum, static_cast<uint8_t>(value >> 8));
  checksum = macroChecksumByte(checksum, static_cast<uint8_t>(value >> 16));
  return macroChecksumByte(checksum, static_cast<uint8_t>(value >> 24));
}

// 计算一份宏的事务提交校验和；只计算 stepCount 指定的有效步骤。
inline uint32_t userMacroChecksum(const UserMacro& macro) {
  uint32_t checksum = kUserMacroChecksumOffset;
  checksum = macroChecksumUint16(checksum, macro.stepCount);
  checksum = macroChecksumUint32(checksum, macro.loopGapMs);
  checksum = macroChecksumByte(checksum, macro.repeat ? 1 : 0);

  for (size_t index = 0; index < macro.stepCount; ++index) {
    const MacroStep& step = macro.steps[index];
    checksum = macroChecksumUint32(checksum, step.durationMs);
    checksum = macroChecksumUint32(checksum, step.waitMs);
    checksum = macroChecksumUint16(checksum, step.report.buttons);
    checksum = macroChecksumByte(checksum, step.report.dpad);
    checksum = macroChecksumByte(checksum, step.report.leftX);
    checksum = macroChecksumByte(checksum, step.report.leftY);
    checksum = macroChecksumByte(checksum, step.report.rightX);
    checksum = macroChecksumByte(checksum, step.report.rightY);
  }
  return checksum;
}

// 计算一轮总时长，包含每个动作后的松开等待，不包含 loopGapMs。
inline uint32_t userMacroDurationMs(const UserMacro& macro) {
  uint32_t total = 0;
  for (size_t index = 0; index < macro.stepCount; ++index) {
    total += macro.steps[index].durationMs + macro.steps[index].waitMs;
  }
  return total;
}

// 在写入 Flash 或配置引擎前验证所有数值范围，避免非法 HID 报告。
inline bool isUserMacroValid(const UserMacro& macro) {
  if (macro.stepCount == 0 || macro.stepCount > kMaxUserMacroSteps ||
      macro.loopGapMs > kMaxUserMacroLoopGapMs) {
    return false;
  }

  for (size_t index = 0; index < macro.stepCount; ++index) {
    const MacroStep& step = macro.steps[index];
    if (step.durationMs < kMinUserMacroStepMs ||
        step.durationMs > kMaxUserMacroStepMs ||
        step.waitMs > kMaxUserMacroLoopGapMs ||
        (step.report.buttons & ~0x3fffu) != 0 ||
        (step.report.dpad > 7 && step.report.dpad != kDpadCentered)) {
      return false;
    }
  }
  return true;
}

}  // namespace farmers
