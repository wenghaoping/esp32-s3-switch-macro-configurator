#pragma once

// 宏槽位数量由固件和任务方案共同使用，集中定义避免协议上下限不一致。

#include <stdint.h>

namespace farmers {

constexpr uint8_t kMacroLibrarySlotCount = 12;

}  // namespace farmers
