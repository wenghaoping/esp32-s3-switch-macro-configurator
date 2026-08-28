#include "TaskPlanStorage.h"

#include <Preferences.h>

// 文件职责：把唯一的一份“多宏任务方案”保存到 ESP32 NVS。
// 任务数据量很小，采用 Preferences 的一个二进制键；宏动作本体仍由
// MacroLibrary.cpp 保存到 SPIFFS，两者职责分离。

namespace farmers {
namespace {

constexpr char kNamespace[] = "sftask";
constexpr char kKey[] = "active";
constexpr uint32_t kMagic = 0x53465450u;
constexpr uint16_t kVersion = 1;

struct StoredTaskPlan {
  // 魔数/版本/校验和让旧格式或损坏记录在读取时安全失效。
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  TaskPlan plan;
  uint32_t checksum;
};

}  // namespace

bool TaskPlanStorage::load(TaskPlan* plan) {
  // 只读方式打开 NVS，读完马上关闭，避免长期占用 Preferences 句柄。
  if (plan == nullptr) {
    return false;
  }
  Preferences preferences;
  if (!preferences.begin(kNamespace, true)) {
    return false;
  }
  StoredTaskPlan stored{};
  const size_t size = preferences.getBytesLength(kKey);
  const size_t read = size == sizeof(stored)
                          ? preferences.getBytes(kKey, &stored, sizeof(stored))
                          : 0;
  preferences.end();
  stored.plan.name[kTaskPlanNameBytes] = '\0';
  if (read != sizeof(stored) || stored.magic != kMagic ||
      stored.version != kVersion || !isTaskPlanStructValid(stored.plan) ||
      stored.checksum != taskPlanChecksum(stored.plan)) {
    return false;
  }
  *plan = stored.plan;
  return true;
}

bool TaskPlanStorage::save(const TaskPlan& plan) {
  // 先验证结构，再一次性覆盖二进制键；网页提交前也做过同样的校验。
  if (!isTaskPlanStructValid(plan)) {
    return false;
  }
  StoredTaskPlan stored{};
  stored.magic = kMagic;
  stored.version = kVersion;
  stored.plan = plan;
  stored.checksum = taskPlanChecksum(plan);
  Preferences preferences;
  if (!preferences.begin(kNamespace, false)) {
    return false;
  }
  const size_t written =
      preferences.putBytes(kKey, &stored, sizeof(stored));
  preferences.end();
  return written == sizeof(stored);
}

bool TaskPlanStorage::clear() {
  // 不存在也视为清除成功，便于实现幂等的 TASK_DELETE。
  Preferences preferences;
  if (!preferences.begin(kNamespace, false)) {
    return false;
  }
  const bool removed = !preferences.isKey(kKey) || preferences.remove(kKey);
  preferences.end();
  return removed;
}

}  // namespace farmers
