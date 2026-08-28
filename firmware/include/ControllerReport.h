#pragma once

// 文件职责：定义一帧 Nintendo Switch 手柄报告的通用数据结构。
// 宏引擎和手动串口输入最终都会转换成 ControllerReport，再由 main.cpp
// 交给 switch_ESP32 库发送给主机。

#include <stdint.h>

namespace farmers {

// switch_ESP32 使用 15 表示十字键未按下，摇杆范围是 0～255，128 为回中。
constexpr uint8_t kDpadCentered = 15;
constexpr uint8_t kAxisCentered = 128;

struct ControllerReport {
  // 14 个数字按键的位掩码；具体位号和网页 BUTTON_BITS 保持一致。
  uint16_t buttons;
  // 十字键方向：0～7 表示八个方向，15 表示居中。
  uint8_t dpad;
  // 左、右摇杆的 X/Y 轴；0、128、255 分别近似左/中/右或上/中/下。
  uint8_t leftX;
  uint8_t leftY;
  uint8_t rightX;
  uint8_t rightY;
};

// 只有报告内容真正改变时才需要向 USB HID 再发送一帧。
constexpr bool operator==(const ControllerReport& lhs,
                          const ControllerReport& rhs) {
  return lhs.buttons == rhs.buttons && lhs.dpad == rhs.dpad &&
         lhs.leftX == rhs.leftX && lhs.leftY == rhs.leftY &&
         lhs.rightX == rhs.rightX && lhs.rightY == rhs.rightY;
}

constexpr bool operator!=(const ControllerReport& lhs,
                          const ControllerReport& rhs) {
  return !(lhs == rhs);
}

// 完全松开所有按钮并使两个摇杆回中的标准报告。
constexpr ControllerReport kNeutralReport{
    0, kDpadCentered, kAxisCentered, kAxisCentered, kAxisCentered,
    kAxisCentered};

}  // namespace farmers
