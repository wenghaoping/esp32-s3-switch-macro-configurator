# 项目快速上下文

更新日期：2026-08-30

## 一句话说明

这是一个基于 ESP32-S3-DevKitC-1 的 Nintendo Switch 有线手柄模拟器。ESP32-S3
通过原生 USB 向 Switch 输出手柄报告；Vue 3 网页通过板载 USB-UART 和 Web Serial
配置、录制、运行宏。宏、任务方案和 GPIO 触发均在板端运行，因此日常自动执行可以脱离电脑。

## 当前硬件拓扑

```text
Xbox / PS5 / 键盘 / 网页虚拟手柄
                ↓ 浏览器 Gamepad API 或页面操作
Vue 3 WebUI ── Web Serial ── USB-UART桥 ── UART0
                                                ↓
                                          ESP32-S3
                                      宏 / 任务 / GPIO
                                                ↓
                                  原生 USB GPIO19/20
                                                ↓
                                      Nintendo Switch
```

- 原生 USB：GPIO19 D-、GPIO20 D+，工作在 USB Device 模式，使用 `switch_ESP32`
  模拟 Switch 有线手柄。
- USB-UART：经开发板桥接芯片连接 UART0，115200 baud，用于网页控制和烧录。
- 两个接口彼此独立；USB-UART 口不是 USB Host，不能直接插 Xbox/PS5 手柄。
- 浏览器断开后，已经启动的宏或任务继续由板端执行；实时手柄直通则依赖浏览器。

## 产品能力

- 12 个宏槽位，槽位 1～4 有 C++ 内置宏，槽位 5～12 默认空白。
- 同槽位优先级：SPIFFS 中的网页宏 > C++ 内置宏。
- 单个用户宏最多 512 步，每步包含完整手柄报告、保持时间和释放后等待时间。
- 一份板载任务方案最多引用 5 个宏，可设置每项次数、项间隔和整轮循环。
- 12 个 GPIO 启动触发器、1 个停止触发器，均使用安全引脚白名单和防抖。
- 支持宏 JSON v2 导入导出、完整脚本库备份恢复、事务式上传与校验。
- 板载 WS2812（GPIO48）显示启动、空闲、宏、任务、上传、写入和错误状态。
- SPIFFS 挂载失败时保留现场并回退内置宏，绝不在启动时自动格式化；只有用户明确
  执行 `MACRO_STORAGE_RESET` 才清空并重新初始化宏存储。

## 技术栈与版本

- 固件：Arduino-ESP32，PlatformIO `espressif32@6.10.0`，C++17。
- 目标板：`esp32-s3-devkitc-1`。
- Switch HID：`switch_ESP32` 固定提交
  `0adba99d9c2b32c86aed21cb74558cc35841530e`。
- 固件上报版本：`SplatoonFarmers/2.0.1`。
- WebUI：Vue 3、Pinia、Vue Router、Vite，ES modules。
- package 版本：`2.0.0`。

## 关键数据模型

统一手柄报告 `ControllerReport`：

- `buttons`：14 位数字按钮掩码。
- `dpad`：0～7 为方向，15 为中立。
- `leftX/leftY/rightX/rightY`：0～255，128 为中心。
- 中立报告必须是按钮 0、方向 15、四轴 128。

网页实体手柄映射按物理位置统一到 Switch 布局：下→B、右→A、左→Y、上→X；
Xbox 和 DualSense 在浏览器中最终都转换成同一 `ControllerReport`。

## 首要代码入口

| 任务 | 首先查看 |
| --- | --- |
| 固件总控、串口命令、GPIO、任务 | `firmware/src/main.cpp` |
| 手柄报告格式 | `firmware/include/ControllerReport.h` |
| 宏状态机 | `firmware/include/MacroEngine.h`、`firmware/src/MacroEngine.cpp` |
| 用户宏范围和校验 | `firmware/include/UserMacro.h` |
| 12 槽存储 | `firmware/include/MacroLibrary.h`、`firmware/src/MacroLibrary.cpp` |
| 板载任务 | `firmware/include/TaskPlan.h`、`firmware/src/TaskPlanStorage.cpp` |
| Web 串口生命周期 | `web/src/utils/serial-transport.js`、`web/src/stores/device.js` |
| 网页协议生成/解析 | `web/src/utils/protocol.js`、`web/src/utils/macro-editor.js` |
| 实体手柄映射 | `web/src/utils/gamepad-input.js` |
| 页面路由 | `web/src/router.js` |

## 不应重新猜测的关键约束

1. ESP32-S3 的单个 USB OTG 控制器不能同时作为 USB Host 和 USB Device；现有原生
   USB 已占用为 Switch Device。
2. ESP32-S3 只有 BLE、没有 Bluetooth Classic。新版 Xbox BLE 在硬件上可直连，
   但当前固件尚未实现蓝牙手柄 Host；PS5 DualSense 蓝牙使用 BR/EDR，不能由单块
   ESP32-S3 直接连接。
3. 同时支持 Xbox 与 PS5 无线输入的推荐架构是增加经典 ESP32-WROOM-32 作为蓝牙
   输入协处理器，通过 UART/SPI 把标准化报告传给现有 S3。
4. 有线手柄输入需要独立 USB Host，例如 MAX3421E 或第二颗专用 MCU，不能通过
   USB 分线或 USB-UART 端口实现。
5. 宏计时在 MCU 内执行；网页只发送高层命令。不要把关键时序移回浏览器。
6. 修改协议或校验算法时必须同步固件、网页和测试。

## 新任务最小读取策略

先读本文件，再按 `AGENTS.md` 选择一个专题文档。一般只需局部打开 2～5 个源文件；
不要为了回答硬件问题扫描前端，也不要为了改一个 Vue 页面读取全部固件。
