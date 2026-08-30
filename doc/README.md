# 项目文档索引

这里保存面向开发者和代码 Agent 的短上下文，目标是避免每次新对话重新遍历整个项目。

| 文档 | 何时读取 |
| --- | --- |
| [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) | 每个新任务必读；项目目的、现状、关键约束 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 修改固件、网页数据流、宏执行或模块边界 |
| [`PROTOCOL_AND_STORAGE.md`](./PROTOCOL_AND_STORAGE.md) | 修改串口命令、上传事务、SPIFFS、NVS 或备份 |
| [`HARDWARE_AND_CONTROLLERS.md`](./HARDWARE_AND_CONTROLLERS.md) | USB 接线、GPIO、蓝牙、Xbox/PS5 接入方案 |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | 构建、测试、改动检查和常用定位路径 |

这些文档记录稳定架构，不记录临时调试日志。代码变更导致文档失真时，应在同一任务中更新。
