# 串口协议与持久化

## 传输约定

- UART0，115200 baud，ASCII 编码，一行一条命令。
- 固件响应是一行一个 JSON 对象。
- 网页的请求/响应匹配集中在 `web/src/stores/device.js`。
- 命令生成、宏/任务校验逻辑必须与固件保持字段顺序和数值语义一致。

## 命令分组

| 分组 | 主要命令 | 用途 |
| --- | --- | --- |
| 握手/状态 | `HELLO`、`INFO`、`STATUS`、`PING` | 设备发现、版本、运行进度、保活 |
| 运行控制 | `START`、`STOP`、`MACRO_START slot` | 启停当前或指定槽位 |
| 实时报告 | `R buttons dpad lx ly rx ry` | 临时发送一帧完整手柄报告 |
| 宏读取 | `MACRO_GET`、`MACRO_LIST`、`MACRO_LOAD` | 读取宏和选择活动槽位 |
| 宏写入 | `MACRO_BEGIN`、`MACRO_NAME`、`MACRO_STEP`、`MACRO_COMMIT` | 事务式上传 |
| 宏管理 | `MACRO_DELETE`、`MACRO_RESTORE`、`MACRO_RENAME` | 删除覆盖、恢复内置、改名 |
| 存储恢复 | `MACRO_STORAGE_RESET` | 用户明确确认后格式化宏 SPIFFS |
| 任务 | `TASK_GET/START/STOP/DELETE`、`TASK_BEGIN/META/ENTRY/COMMIT` | 保存和运行最多 5 项的任务 |
| GPIO | `TRIGGER_GET/DEFAULT`、`TRIGGER_BEGIN/ENTRY/STOP_PIN/COMMIT` | 配置离线触发 |
| LED | `LED_BRIGHTNESS 0..255` | 临时调整状态灯亮度 |

槽位在线路协议和 C++ 内部使用 0 基编号；UI 展示通常是 1～12。改动时特别注意不要产生
一位偏差。

## 手柄报告范围

- `buttons`：`0..0x3fff`。
- `dpad`：`0..7` 或 `15`。
- 四根轴：`0..255`，中间值 `128`。
- 用户宏步骤保持时间：`10..600000 ms`。
- 步骤释放等待与宏循环间隔：`0..600000 ms`。

## 宏事务

宏上传先暂存在 RAM，只有满足以下条件才提交：

- 槽位、步骤数和所有字段在范围内。
- 声明的每个步骤都已经收到。
- 网页与固件计算出的校验和一致。
- 当前没有冲突的宏/任务或其他上传事务。

校验使用 FNV-1a 风格递推，字段顺序定义在 `firmware/include/UserMacro.h`；网页对应实现
在 `web/src/utils/macro-editor.js`。任何一侧调整字段或字节序都必须同步另一侧和测试。

## 存储职责

| 数据 | 存储 | 说明 |
| --- | --- | --- |
| 自定义宏动作与名称 | SPIFFS | `/macro-N.bin`，临时文件和备份文件用于替换 |
| Flash 活动槽位索引 | SPIFFS | 独立索引记录，带 magic/checksum |
| 唯一板载任务方案 | Preferences/NVS | 小型二进制结构，带 magic/checksum |
| GPIO 触发配置 | Preferences/NVS | 安全引脚、目标和校验和 |
| C++ 内置宏 | 固件镜像 | 不会被网页真正覆盖或删除 |

### SPIFFS 安全原则

- `MacroLibrary::begin()` 使用 `SPIFFS.begin(false)`，启动挂载失败时禁止自动格式化。
- 状态响应中的 `macro_storage` 为 `ready` 或 `mount-failed`。
- 挂载失败时内置宏仍可运行，自定义宏暂时不可用。
- `MACRO_STORAGE_RESET` 是唯一允许格式化的路径，必须由 UI 明确确认。
- 重置会删除自定义宏，并清除可能引用失效槽位的任务方案；内置宏保留。

## 修改协议的同步清单

通常需要同时检查：

- `firmware/src/main.cpp`
- `firmware/include/UserMacro.h` 或 `TaskPlan.h`
- `web/src/utils/protocol.js`
- `web/src/utils/macro-editor.js` 或 `task-plan.js`
- `web/src/utils/serial-transport.js` 中的 mock
- `web/src/stores/device.js`
- `tests/web/protocol.test.mjs`
- `README.md`、`README-en.md` 和本文件
