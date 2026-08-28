# 固件目录学习导航

`firmware/` 是 ESP32-S3 上实际运行的 Arduino 固件。浏览器只经由 UART
发送高层命令；宏计时、GPIO 离线触发、任务循环和 Switch USB HID 都由这里
完成，因此网页断开后正在运行的宏仍会继续。

## 建议阅读顺序

1. 先读 `include/ControllerReport.h`、`include/MacroEngine.h`，理解“一步宏”
   如何表示为一份完整手柄状态和两段时间。
2. 再读 `src/builtins/`，按图片逐项理解四个内置宏。
3. 读 `src/BuiltinMacroLibrary.cpp` 与 `include/BuiltinMacros.h`，理解宏如何
   注册到槽位 1～4。
4. 读 `src/MacroEngine.cpp`，理解非阻塞的状态机如何按时推进动作。
5. 最后读 `src/main.cpp`，它将串口、Flash、GPIO、任务和 USB HID 组合起来。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| `include/ControllerReport.h` | 定义一帧 Switch 手柄报告：数字按键位、十字键、两个摇杆和全中立报告。 |
| `include/ControllerPresets.h` | 集中定义全部按键位、常用单键报告、左摇杆方向和常用组合报告。 |
| `include/MacroEngine.h` | 声明宏步骤、阶段枚举和非阻塞宏引擎接口。 |
| `src/MacroEngine.cpp` | 实现宏状态机；不使用 `delay()`，所以运行时仍可响应停止和串口命令。 |
| `include/UserMacro.h` | 定义网页上传宏的 512 步固定容量格式、时长限制及跨端校验和。 |
| `include/MacroLibrary.h` | 声明 8 槽 Flash 宏库；Flash 版本优先于同槽位 C++ 内置版本。 |
| `src/MacroLibrary.cpp` | 使用 SPIFFS 保存宏文件，并以临时文件/备份文件方式完成替换。 |
| `include/BuiltinMacroLibrary.h` | 定义内置宏描述结构，并按 1 基槽位查询内置宏。 |
| `include/BuiltinMacros.h` | 汇总各独立内置宏文件的声明，是新增内置宏时要补充的声明点。 |
| `src/BuiltinMacroLibrary.cpp` | 内置宏的槽位注册表：将槽位 1～4 映射到各自独立文件。 |
| `src/builtins/TempuraNestWeaponFarm.cpp` | 槽位 1：天埠罗巢穴刷武器。 |
| `src/builtins/AnlingNestMoneyFarm.cpp` | 槽位 2：杏棱巢穴刷钱。 |
| `src/builtins/WeaponDismantle.cpp` | 槽位 3：武器分解。 |
| `src/builtins/ConnectController.cpp` | 槽位 4：连接手柄。 |
| `include/TaskPlan.h` | 定义最多 5 项的板载任务方案及其校验。 |
| `include/TaskPlanStorage.h` | 声明任务方案的 NVS 存储接口。 |
| `src/TaskPlanStorage.cpp` | 用 Preferences/NVS 保存或清除唯一的一份任务方案。 |
| `src/main.cpp` | Arduino 入口和总控：UART 协议、宏选择、任务执行、GPIO、状态 JSON、USB HID。 |

## 关键数据流

```text
网页 UART 命令 / GPIO 低电平
        ↓
main.cpp 选择槽位
        ↓
Flash 宏（若存在）优先；否则 C++ 内置宏
        ↓
MacroEngine 按“按住 → 松开等待 → 下一步”推进
        ↓
ControllerReport
        ↓
switch_ESP32 USB HID -> Nintendo Switch
```

## 内置宏与网页宏的关系

网页在某一槽位写入宏时，数据会保存到 SPIFFS，并覆盖同槽位的内置宏用于
运行；这不会改写任何 `.cpp` 文件。选择“恢复内置”会删除这个 Flash 覆盖，
再次启用 `src/builtins/` 内编译进固件的版本。

## 新增一个内置宏

1. 在 `src/builtins/` 新建一个 `.cpp`，定义动作数组和 `BuiltinMacroDefinition`。
2. 在 `include/BuiltinMacros.h` 添加 `extern` 声明。
3. 在 `src/BuiltinMacroLibrary.cpp` 的 `switch` 中分配槽位。
4. 若新增的是第 5 个内置槽位，更新 `kBuiltinMacroCount`，并同步网页默认数据与测试。
5. 运行 `npm test` 和 `pio run`；烧录后若该槽位已有网页 Flash 覆盖，请点击“恢复内置”查看新版本。
