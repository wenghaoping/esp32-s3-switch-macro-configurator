#pragma once

// 文件职责：定义“编译进固件”的内置宏描述格式，并按槽位查询它们。
// 网页保存到 Flash 的同槽位宏优先于本文件描述的内置宏；恢复内置时会
// 删除 Flash 覆盖，随后由 builtinMacroForSlot() 返回对应的默认宏。

#include <stddef.h>
#include <stdint.h>

#include "UserMacro.h"

namespace farmers {

struct BuiltinMacroDefinition {
  // 槽位编号使用 1 基数；串口协议和网页内部使用 0 基数，两者相差 1。
  uint8_t slot;
  // 显示给网页和串口 JSON 的 UTF-8 名称。
  const char* name;
  // 完整动作数组及其元素数量；动作数据常量驻留在固件 Flash 中。
  const MacroStep* steps;
  size_t stepCount;
  // 整轮宏完成并松开按键后的额外等待时间。
  uint32_t loopGapMs;
};

// 当前前 4 个槽位带有 C++ 内置版本，槽位 5～8 可由网页写入 Flash。
constexpr uint8_t kBuiltinMacroCount = 4;

// 按 1 基槽位编号返回内置宏；该槽位没有内置版本时返回 nullptr。
const BuiltinMacroDefinition* builtinMacroForSlot(uint8_t slot);

}  // namespace farmers
