# 开发与验证

## 环境与命令

```bash
npm install
npm test
npm run build
pio run
```

- `npm test`：运行主机侧 C++ 宏引擎测试和 Node Web 测试。
- `npm run test:firmware`：只验证可在桌面编译的宏引擎与内置宏。
- `npm run test:web`：只运行 `tests/web/` 与 `tests/data/`。
- `npm run build`：验证 Vue/Vite 生产构建。
- `pio run`：验证完整 ESP32-S3 固件和嵌入式依赖。
- `npm run serve`：以 `0.0.0.0` 启动 Vite 并打开浏览器。

真实烧录通常走开发板 USB-UART，例如：

```bash
pio run -t upload --upload-port /dev/cu.usbserial-XXXX
```

## 按任务定位

| 需求 | 先读/先测 |
| --- | --- |
| 修改宏时序 | `MacroEngine.*`、`test_macro_engine.cpp` |
| 增加或修正内置宏 | `firmware/src/builtins/`、`BuiltinMacroLibrary.cpp` |
| 修改手柄映射 | `gamepad-input.js`、`manual-input.js`、对应 Web 测试 |
| 修改宏编辑/录制 | `macro-editor.js`、`macro-recorder.js`、页面和相关测试 |
| 修改串口生命周期 | `serial-transport.js`、`device.js`、`protocol.test.mjs` |
| 修改存储 | `MacroLibrary.*`、`TaskPlanStorage.*`、协议和设备页 |
| 修改 GPIO | `main.cpp` Trigger 区段、`DevicePage.vue`、协议构造器 |
| 修改页面样式 | 目标 `.vue`、`theme.css`，随后 `npm run build` |

## 跨端改动检查

以下常量或语义不能只改一端：

- 12 个宏槽位。
- 最多 512 个宏步骤。
- 最多 5 个任务项。
- 14 位按钮掩码、dpad 15 中立、摇杆 128 中立。
- 步骤时长、等待和任务次数上限。
- 宏和任务的校验和字段顺序。
- 新增命令的真实串口实现、mock、store 处理和错误翻译。

## 工作区安全

- 每次任务开始运行 `git status --short`。
- 用户的未提交内容不是可清理的临时文件；只修改任务需要的文件。
- 不使用 `git reset --hard` 或 `git checkout --` 回退用户修改。
- Flash 格式化、槽位删除和任务清除属于破坏性行为，测试和 UI 中必须明确区分。

## 完成标准

文档修改至少检查链接与文件名；Web 修改至少运行相关测试和 `npm run build`；固件协议或
存储修改通常需要 `npm test` 加 `pio run`。无法运行硬件实测时，最终说明未验证部分。

架构、协议、硬件约束发生变化时，同步更新 `doc/`，以保证后续 Agent 可以继续采用最小
读取策略，而不是重新遍历全仓库。
