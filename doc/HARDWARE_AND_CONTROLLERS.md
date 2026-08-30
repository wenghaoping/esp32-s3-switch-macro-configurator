# 硬件、USB 与手柄接入

## 当前开发板端口

推荐板为 ESP32-S3-DevKitC-1，项目假设存在两个物理 USB 口：

| 端口 | 电气路径 | 当前角色 |
| --- | --- | --- |
| 原生 USB | GPIO19 D- / GPIO20 D+ | USB Device，模拟 Switch 有线手柄 |
| USB-UART | 板载桥接芯片 → UART0 | 浏览器控制、日志、烧录 |

USB-UART 桥本身面向电脑是 USB Device，不能成为手柄的 USB Host。不要尝试通过 Y 线、
无源分线器或普通 USB Hub 让同一原生口同时连接 Switch 和手柄。

## ESP32-S3 USB 限制

ESP32-S3 的 USB OTG 硬件可以选择 Host 或 Device，但不能在同一时间同时承担两种角色。
当前项目必须保留 Device 角色连接 Switch。因此有线 Xbox/PS5 输入需要：

- MAX3421E 等独立 USB Host 控制器；或
- 第二颗带 USB Host 的 MCU；或
- Linux SBC 输入网关。

USB Host 端给手柄供电时，应使用受控、限流的稳定 5V 电源。不要把外部 5V 与 Switch
端口 VBUS 直接硬并联；所有通信模块需要共地。

## 蓝牙不是单一协议

| 设备/芯片 | Bluetooth Classic BR/EDR | BLE |
| --- | ---: | ---: |
| Mac | 支持 | 支持 |
| 经典 ESP32-WROOM-32 | 支持 | 支持 |
| ESP32-S3 | 不支持 | 支持 |
| PS5 DualSense 无线模式 | 使用 | 不使用 |
| 新版 Xbox 手柄固件 | 视版本 | v5.x 通常使用 |

因此 Mac 能连接 Xbox 和 PS5，不代表 ESP32-S3 也能连接两者；macOS 的蓝牙硬件和系统
驱动同时覆盖两套传输方式。

### Xbox

新版 Xbox Wireless Controller 在 BLE 模式下，ESP32-S3 硬件上具备直连条件。常见候选：

- 型号 1708，需较新 v5.x 固件。
- Elite Series 2 / 型号 1797。
- Xbox Series / 型号 1914。

仍需固件提供 BLE Central、配对、安全、HID over GATT、报告解析、配对密钥存储、自动
重连和断线回中。当前仓库尚未实现这些功能。旧固件、旧型号或微软专有 2.4GHz 无线
接收器不能因为“S3 有蓝牙”而自动兼容。

### PS5 DualSense

DualSense 无线输入使用 Bluetooth Classic BR/EDR。ESP32-S3 缺少对应硬件控制器，不能
靠增加一个库解决。USB 有线方式可由独立 USB Host 读取。

## 推荐扩展方案

### 同时支持 Xbox 和 PS5 无线：双 MCU

```text
Xbox / PS5 ── Bluetooth ── 经典 ESP32-WROOM-32
                                  ↓ UART/SPI
                             当前 ESP32-S3
                                  ↓ USB Device
                                Switch
```

输入协处理器负责配对和解析；S3 负责统一报告、输入仲裁、宏、故障回中和 Switch USB。
建议使用独立 UART，而不是占用当前网页使用的 UART0。

### 支持有线手柄：独立 USB Host

```text
Xbox / PS5 ── USB ── MAX3421E 或 USB Host MCU
                              ↓ SPI/UART
                         当前 ESP32-S3
                              ↓ USB Device
                            Switch
```

DualSense USB 与 Xbox USB 需要不同解析器；Xbox 有线协议不能一概当作普通 HID。

## 第一版功能边界建议

优先支持：面键、肩键、数字 ZL/ZR、十字键、双摇杆、摇杆按下、加减号、Home/Capture。
Switch 的 ZL/ZR 是数字输入，Xbox/PS5 的模拟扳机需设置阈值。

首版暂不承诺：震动回传、陀螺仪、触摸板、DualSense 自适应扳机、音频和耳机接口。

无论输入来自蓝牙还是外置 USB Host，都必须具有：

- 序号或丢包检测。
- 心跳超时。
- 断线立即发送中立报告。
- 配对清除实体按键。
- 明确的“手柄直通/宏运行/停止”输入仲裁规则。
