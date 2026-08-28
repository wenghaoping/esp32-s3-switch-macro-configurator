#include "BuiltinMacros.h"

// 文件职责：内置宏的唯一槽位注册表。
// 每个实际脚本位于 src/builtins/ 的独立文件；这里故意只保留“槽位 -> 宏”的
// 映射，使新增、删除或调整槽位时不必修改其他宏的动作数据。

namespace farmers {

const BuiltinMacroDefinition* builtinMacroForSlot(uint8_t slot) {
  // C++ 内置宏使用 1 基编号，以匹配用户看到的“槽位 1～4”。
  switch (slot) {
    case 1:
      return &builtins::kTempuraNestWeaponFarm;
    case 2:
      return &builtins::kAnlingNestMoneyFarm;
    case 3:
      return &builtins::kWeaponDismantle;
    case 4:
      return &builtins::kConnectController;
    default:
      return nullptr;
  }
}

}  // namespace farmers
