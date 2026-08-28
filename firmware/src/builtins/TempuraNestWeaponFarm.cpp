#include "BuiltinMacros.h"
#include "ControllerPresets.h"

// 文件职责：槽位 1“天埠罗巢穴刷武器”的完整板载动作表。

namespace farmers {
namespace builtins {
namespace {

// 来源：天埠罗巢穴刷武器.png。
// MacroStep 的格式是 {按住毫秒数、完整手柄报告、松开后等待毫秒数}；waitMs
// 期间宏引擎会发送中立报告。Right/Up/Down/Left 均按原宏编辑器解释为左摇杆。
constexpr MacroStep kSteps[] = {
    {200, kReportX, 200}, {200, kReportA, 200}, {200, kReportA, 200},
    {200, kReportA, 200}, {5000, kNeutralReport, 4000},
    {30000, kReportZR, 20}, {500, kReportZRWithRightStickPress, 20},
    {11000, kReportZR, 3000}, {300, kLeftStickRight, 20},
    {5500, kLeftStickUp, 20}, {1000, kLeftStickLeftWithZR, 20},
    {1000, kLeftStickDown, 7000}, {200, kReportA, 1000},
    {200, kReportA, 1000}, {200, kReportA, 1000},
    {200, kReportA, 1000}, {200, kReportA, 2000},
    {200, kReportB, 1000},
};

}  // namespace

const BuiltinMacroDefinition kTempuraNestWeaponFarm = {
    1, "天埠罗巢穴刷武器", kSteps, sizeof(kSteps) / sizeof(kSteps[0]), 0};

}  // namespace builtins
}  // namespace farmers
