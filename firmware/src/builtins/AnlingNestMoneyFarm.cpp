#include "BuiltinMacros.h"
#include "ControllerPresets.h"

// 文件职责：槽位 2“杏棱巢穴刷钱”的完整板载动作表。

namespace farmers {
namespace builtins {
namespace {

// 来源：杏棱巢穴刷钱.jpg。方向沿用原编辑器的左摇杆方向；waitMs 精确保留
// 截图中“释放并等待”的时长。
constexpr MacroStep kSteps[] = {
    {200, kReportX, 500}, {200, kReportA, 200}, {200, kReportA, 200},
    {200, kReportA, 200}, {5000, kNeutralReport, 4000},
    {1000, kLeftStickRight, 20}, {15000, kLeftStickUp, 20},
    {2000, kLeftStickUpWithZR, 20}, {200, kReportX, 1500},
    {200, kReportB, 200}, {200, kReportB, 1000}, {200, kReportR, 750},
    {200, kReportR, 750}, {1000, kReportL, 1000}, {1000, kReportZR, 200},
    {750, kLeftStickLeftWithZR, 20}, {1200, kLeftStickRightWithZR, 20},
    {200, kReportA, 3000}, {150, kLeftStickLeft, 4000},
    {5000, kLeftStickDown, 5000}, {200, kReportA, 1000},
    {200, kReportA, 1000}, {200, kReportA, 1000},
    {200, kReportA, 1000}, {200, kReportA, 2000}, {200, kReportB, 2000},
};

}  // namespace

const BuiltinMacroDefinition kAnlingNestMoneyFarm = {
    2, "杏棱巢穴刷钱", kSteps, sizeof(kSteps) / sizeof(kSteps[0]), 0};

}  // namespace builtins
}  // namespace farmers
