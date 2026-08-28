#include "BuiltinMacros.h"
#include "ControllerPresets.h"

// 文件职责：槽位 3“武器分解”的完整板载动作表。

namespace farmers {
namespace builtins {
namespace {

// 来源：武器分解.jpg。重复的 A/向右动作刻意保留为独立步骤，方便学习时逐项
// 对照截图，也能分别调整每一次松开后的等待时间。
constexpr MacroStep kSteps[] = {
    {200, kReportX, 200}, {200, kLeftStickDown, 200},
    {200, kLeftStickDown, 200}, {200, kLeftStickDown, 200},
    {200, kReportA, 2000}, {200, kLeftStickRight, 200},
    {200, kReportA, 2000}, {200, kReportX, 1500},
    {200, kReportA, 300}, {200, kLeftStickRight, 300},
    {200, kReportA, 300}, {200, kLeftStickRight, 300},
    {200, kReportA, 300}, {200, kLeftStickRight, 300},
    {200, kReportA, 300}, {200, kLeftStickDown, 300},
    {200, kReportA, 1500}, {200, kReportPlus, 1000},
    {200, kLeftStickRight, 200}, {200, kReportA, 5000},
    {200, kReportB, 300}, {200, kReportB, 1000},
    {200, kReportB, 2000},
};

}  // namespace

const BuiltinMacroDefinition kWeaponDismantle = {
    3, "武器分解", kSteps, sizeof(kSteps) / sizeof(kSteps[0]), 0};

}  // namespace builtins
}  // namespace farmers
