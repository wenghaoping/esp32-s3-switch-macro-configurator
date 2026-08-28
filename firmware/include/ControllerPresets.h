#pragma once

// 文件职责：集中定义 Switch 手柄的按键位和常用完整手柄报告。
// 所有内置宏都应引用本文件，避免每个宏重复定义 kReportA、摇杆方向等常量。
// ControllerReport 表示“这一时刻所有控制器状态”，不是增量按键：未列出的
// 按键均松开，未列出的摇杆均回中。

#include "ControllerReport.h"

namespace farmers {

// ---------- 数字按键位 ----------
// 与网页 web/src/utils/manual-input.js 的 BUTTON_BITS 和 switch_ESP32 的
// button 位定义一致。组合输入可使用按位或，例如 kButtonZR | kButtonA。
constexpr uint16_t kButtonY = 1u << 0;                // Y
constexpr uint16_t kButtonB = 1u << 1;                // B
constexpr uint16_t kButtonA = 1u << 2;                // A
constexpr uint16_t kButtonX = 1u << 3;                // X
constexpr uint16_t kButtonL = 1u << 4;                // 左肩键 L
constexpr uint16_t kButtonR = 1u << 5;                // 右肩键 R
constexpr uint16_t kButtonZL = 1u << 6;               // 左扳机 ZL
constexpr uint16_t kButtonZR = 1u << 7;               // 右扳机 ZR
constexpr uint16_t kButtonMinus = 1u << 8;            // 减号键 −
constexpr uint16_t kButtonPlus = 1u << 9;             // 加号键 +
constexpr uint16_t kButtonLeftStickPress = 1u << 10;  // 左摇杆按下 L3
constexpr uint16_t kButtonRightStickPress = 1u << 11; // 右摇杆按下 R3/RS
constexpr uint16_t kButtonHome = 1u << 12;            // Home
constexpr uint16_t kButtonCapture = 1u << 13;         // 截图键

// ---------- 常用单键完整报告 ----------
// 每一项都只按住注释中说明的按键，其余控制器状态均为中立。
inline constexpr ControllerReport kReportY{kButtonY, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportB{kButtonB, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportA{kButtonA, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportX{kButtonX, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportL{kButtonL, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportR{kButtonR, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportZL{kButtonZL, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportZR{kButtonZR, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportMinus{kButtonMinus, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportPlus{kButtonPlus, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportLeftStickPress{
    kButtonLeftStickPress, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportRightStickPress{
    kButtonRightStickPress, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportHome{kButtonHome, kDpadCentered, 128, 128, 128, 128};
inline constexpr ControllerReport kReportCapture{
    kButtonCapture, kDpadCentered, 128, 128, 128, 128};

// ---------- 左摇杆方向完整报告 ----------
// 0/128/255 分别是轴的最小值/回中/最大值。名称显式包含 LeftStick，避免与
// 十字键方向混淆；本项目图片中的 Up/Down/Left/Right 均按左摇杆方向转写。
inline constexpr ControllerReport kLeftStickUp{0, kDpadCentered, 128, 0, 128, 128};
inline constexpr ControllerReport kLeftStickRight{0, kDpadCentered, 255, 128, 128, 128};
inline constexpr ControllerReport kLeftStickDown{0, kDpadCentered, 128, 255, 128, 128};
inline constexpr ControllerReport kLeftStickLeft{0, kDpadCentered, 0, 128, 128, 128};
inline constexpr ControllerReport kLeftStickUpRight{0, kDpadCentered, 255, 0, 128, 128};
inline constexpr ControllerReport kLeftStickDownRight{0, kDpadCentered, 255, 255, 128, 128};
inline constexpr ControllerReport kLeftStickDownLeft{0, kDpadCentered, 0, 255, 128, 128};
inline constexpr ControllerReport kLeftStickUpLeft{0, kDpadCentered, 0, 0, 128, 128};

// ---------- 当前内置宏使用的组合报告 ----------
// 同时按住 ZR 与 R3；对应截图中的 “ZR + RS”。
inline constexpr ControllerReport kReportZRWithRightStickPress{
    static_cast<uint16_t>(kButtonZR | kButtonRightStickPress), kDpadCentered,
    128, 128, 128, 128};
// 同时按住 ZR 并将左摇杆推向指定方向。
inline constexpr ControllerReport kLeftStickUpWithZR{
    kButtonZR, kDpadCentered, 128, 0, 128, 128};
inline constexpr ControllerReport kLeftStickLeftWithZR{
    kButtonZR, kDpadCentered, 0, 128, 128, 128};
inline constexpr ControllerReport kLeftStickRightWithZR{
    kButtonZR, kDpadCentered, 255, 128, 128, 128};

}  // namespace farmers
