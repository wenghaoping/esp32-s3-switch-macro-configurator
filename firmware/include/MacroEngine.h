#pragma once

// 文件职责：声明非阻塞宏时间轴引擎。
// 主循环反复调用 tick(millis())；引擎只在动作阶段切换时更新手柄报告，
// 不会使用 delay() 阻塞串口、GPIO 停止键或 USB HID 服务。

#include <stddef.h>
#include <stdint.h>

#include "ControllerReport.h"

namespace farmers {

struct MacroStep {
  // 保持当前手柄状态的时间、完整手柄报告、松开后的等待时间。
  uint32_t durationMs;
  ControllerReport report;
  uint32_t waitMs;

  constexpr MacroStep(uint32_t duration = 0,
                      ControllerReport controllerReport = kNeutralReport,
                      uint32_t wait = 0)
      : durationMs(duration), report(controllerReport), waitMs(wait) {}
};

enum class MacroPhase : uint8_t {
  // 空闲、按住某一步、松开后等待、整轮完成后的等待。
  kIdle,
  kSteps,
  kStepWait,
  kLoopGap,
};

class MacroEngine {
 public:
  // steps 的生命周期必须长于引擎；内置宏使用 constexpr 数组，网页宏使用
  // main.cpp 中的全局 UserMacro 缓冲区。
  MacroEngine(const MacroStep* steps, size_t stepCount, uint32_t loopGapMs,
              bool repeat);

  // 从第 0 步开始/立即停止；停止总会产生一份中立报告。
  void start(uint32_t nowMs);
  void stop();
  // 更换要运行的宏。空数组会被拒绝，以免启动后访问无效步骤。
  bool configure(const MacroStep* steps, size_t stepCount, uint32_t loopGapMs,
                 bool repeat);
  void tick(uint32_t nowMs);

  bool running() const;
  MacroPhase phase() const;
  size_t stepIndex() const;
  size_t stepCount() const;
  uint32_t cycleCount() const;
  uint32_t loopGapMs() const;
  bool repeat() const;
  uint32_t phaseDurationMs() const;
  uint32_t phaseElapsedMs(uint32_t nowMs) const;
  uint32_t phaseRemainingMs(uint32_t nowMs) const;
  const ControllerReport& report() const;
  // 读取并清除“报告已变化”标记，供主循环决定是否调用 USB 写入。
  bool consumeReportChanged();

 private:
  void advancePhase();
  void setReport(const ControllerReport& report);

  const MacroStep* steps_;
  size_t stepCount_;
  uint32_t loopGapMs_;
  bool repeat_;

  bool running_;
  MacroPhase phase_;
  size_t stepIndex_;
  uint32_t phaseStartedAtMs_;
  uint32_t cycleCount_;
  ControllerReport report_;
  bool reportChanged_;
};

}  // namespace farmers
