# 架构与模块职责

## 固件数据流

```text
UART 命令 / GPIO 低电平
          ↓
main.cpp：命令解析、选择输入源、任务调度
          ↓
Flash 用户宏优先，否则 C++ 内置宏
          ↓
MacroEngine：保持 → 中立等待 → 下一步 → 循环间隔
          ↓
ControllerReport
          ↓
switch_ESP32 / USB Device
          ↓
Nintendo Switch
```

`loop()` 不使用阻塞式长延时。串口、GPIO、防抖、待启动触发、宏状态机、任务状态机
和状态灯持续轮询，从而保证运行时仍能停止或查询。

## 固件模块

| 文件/目录 | 职责 |
| --- | --- |
| `firmware/src/main.cpp` | 总控、UART 协议、GPIO、任务、USB HID、JSON 状态 |
| `ControllerReport.h` | 跨输入源统一的一帧 Switch 报告 |
| `ControllerPresets.h` | 按钮位、摇杆方向和常用报告常量 |
| `MacroEngine.*` | 非阻塞宏状态机，不负责存储 |
| `UserMacro.h` | 512 步固定容量、边界校验、跨端校验和 |
| `MacroLibrary.*` | SPIFFS 的 12 槽自定义宏及活动槽位索引 |
| `BuiltinMacroLibrary.*` | 将槽位 1～4 映射到编译期内置宏 |
| `firmware/src/builtins/` | 四个相互独立的内置流程 |
| `TaskPlan.h` | 最多 5 项任务的数据结构与校验和 |
| `TaskPlanStorage.*` | 使用 Preferences/NVS 保存唯一任务方案 |
| `StatusLed.*` | GPIO48 WS2812 非阻塞状态显示 |

### 宏运行语义

每个 `MacroStep` 包含一份完整报告：

1. 输出步骤报告并保持 `durationMs`。
2. 输出完全中立报告并等待 `waitMs`。
3. 推进下一步；整轮结束后按运行模式停止或进入 `loopGapMs`。

`STOP`、任务停止和 Stop GPIO 都必须使所有按键释放、摇杆回中。网页手动报告只临时
覆盖当前输出，不应悄悄改变宏文件或槽位。

## WebUI 数据流

```text
Vue 页面
   ↓ Pinia action
web/src/stores/device.js
   ↓ 一行一条 ASCII 命令
serial-transport.js / Web Serial
   ↓ UART0
固件 JSON 行响应
   ↓ store.handleMessage()
页面状态
```

- `App.vue` 保持全局设备 store，页面切换不应重建串口连接。
- `serial-transport.js` 负责端口生命周期、读写循环和断线处理。
- `device.js` 负责请求/响应匹配、轮询、通知、槽位/任务/GPIO 状态。
- `MockSerialTransport` 是页面模拟模式和协议测试的重要兼容实现；添加真实命令时通常
  也要同步 mock。

## 页面与路由

| 路由 | 页面 | 主要职责 |
| --- | --- | --- |
| `#/` | `HomePage.vue` | 状态和快捷入口 |
| `#/control` | `ControlPage.vue` | 启动、停止、实时虚拟手柄 |
| `#/scripts` | `ScriptsPage.vue` | 12 槽管理和板载任务 |
| `#/scripts/:slot/edit` | `ScriptEditorPage.vue` | 逐步编辑和事务上传 |
| `#/recorder` | `RecorderPage.vue` | 键盘/实体手柄录制 |
| `#/device` | `DevicePage.vue` | 接线、GPIO、备份和设备信息 |

## 内置宏和 Flash 覆盖

- 槽位 1：天埠罗巢穴刷武器。
- 槽位 2：杏棱巢穴刷钱。
- 槽位 3：武器分解。
- 槽位 4：连接手柄。
- 槽位 5～12：默认空白。

读取槽位时先尝试 SPIFFS；没有有效存储版本才查询 `builtinMacroForSlot()`。恢复内置
脚本本质是删除对应 Flash 覆盖，不是重新写一份内置宏到 Flash。

## 未来蓝牙输入的推荐边界

如果增加手柄输入协处理器，不要让它了解宏、槽位或 Switch USB 描述符。它只负责：

1. 扫描、配对和自动重连。
2. 解析 Xbox/PS5 原始报告。
3. 输出标准化 `ControllerReport`、连接状态、序号和心跳。

现有 S3 继续负责输入仲裁、断线回中、宏和最终 USB 输出。这样网页输入、蓝牙输入和未来
USB Host 输入都能共享同一报告层。
