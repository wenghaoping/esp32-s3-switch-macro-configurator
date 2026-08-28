#pragma once

// 文件职责：集中声明每个“一宏一源文件”的内置宏对象。
// 新增内置宏的顺序：
// 1. 在 firmware/src/builtins/ 新建一个 .cpp；
// 2. 在本文件增加 extern 声明；
// 3. 在 BuiltinMacroLibrary.cpp 的 switch 中绑定一个槽位；
// 4. 视需要调整 kBuiltinMacroCount，并补充测试。

#include "BuiltinMacroLibrary.h"

namespace farmers {
namespace builtins {

// 各对象由同名 .cpp 定义；这里只提供给槽位注册表使用的声明。
extern const BuiltinMacroDefinition kTempuraNestWeaponFarm;
extern const BuiltinMacroDefinition kAnlingNestMoneyFarm;
extern const BuiltinMacroDefinition kWeaponDismantle;
extern const BuiltinMacroDefinition kConnectController;

}  // namespace builtins
}  // namespace farmers
