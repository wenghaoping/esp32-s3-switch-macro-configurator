#pragma once

// 文件职责：声明任务方案的 Preferences/NVS 存储适配器。
// 相比宏库使用的 SPIFFS 文件，任务方案很小，适合以单个 NVS 二进制键保存。

#include "TaskPlan.h"

namespace farmers {

class TaskPlanStorage {
 public:
  // 读取、写入或清除唯一的一份任务方案；读取和写入都会校验数据完整性。
  bool load(TaskPlan* plan);
  bool save(const TaskPlan& plan);
  bool clear();
};

}  // namespace farmers
