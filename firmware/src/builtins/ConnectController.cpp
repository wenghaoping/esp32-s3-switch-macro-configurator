#include "BuiltinMacros.h"
#include "ControllerPresets.h"

// 文件职责：槽位 4“连接手柄”的最小板载动作表。

namespace farmers {
namespace builtins {
namespace {

// 来源：连接手柄.jpg。按住 A 500 ms，松开 500 ms 后开始下一轮。
constexpr MacroStep kSteps[] = {{500, kReportA, 500}};

}  // namespace

const BuiltinMacroDefinition kConnectController = {
    4, "连接手柄", kSteps, sizeof(kSteps) / sizeof(kSteps[0]), 0};

}  // namespace builtins
}  // namespace farmers
