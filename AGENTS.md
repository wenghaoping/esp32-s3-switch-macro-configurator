# Agent 项目入口

本仓库是 ESP32-S3 Nintendo Switch 有线手柄模拟器、板载宏引擎和 Vue 3
Web Serial 控制台。开始任务时不要默认扫描整个仓库。

## 新对话读取顺序

1. 必读 `doc/PROJECT_CONTEXT.md`，它是项目的最小完整上下文。
2. 运行 `git status --short`，保留用户已有的未提交修改。
3. 只按任务选择一个专题文档：
   - 固件、数据流、文件职责：`doc/ARCHITECTURE.md`
   - 串口命令、Flash/NVS、跨端约束：`doc/PROTOCOL_AND_STORAGE.md`
   - USB、蓝牙、Xbox、PS5、接线：`doc/HARDWARE_AND_CONTROLLERS.md`
   - 构建、测试和修改检查表：`doc/DEVELOPMENT.md`
4. 之后只打开专题文档指向的具体源文件。只有在摘要不足、代码审查或跨模块
   重构时才扩大搜索范围。

## 事实优先级

发生冲突时按以下顺序判断：当前代码与配置 > 自动测试 > `doc/` > 根 README。
文档用于减少重复扫描，不能替代修改前对相关代码的局部核对。

## 修改规则

- 保留无关的工作区修改，不回退用户代码。
- 固件和网页共享的按钮位、校验和、槽位数量、时长边界或协议字段必须同步修改，
  并运行两端相关测试。
- 不允许在启动流程自动格式化 SPIFFS。宏存储重置只能由用户明确操作触发。
- USB 原生口必须保留为连接 Switch 的 USB Device；当前 ESP32-S3 不能用同一个
  USB OTG 控制器同时作为手柄 USB Host。
- 架构、协议、硬件接线或重要限制发生变化时，同步更新对应 `doc/` 文件。

## 常用验证

```bash
npm test
npm run build
pio run
```

具体适用范围和较轻量的单项命令见 `doc/DEVELOPMENT.md`。
