#include "MacroEngine.h"

// 文件职责：实现非阻塞的宏状态机。
// 状态流转为：按住步骤 ->（可选）松开等待 -> 下一步骤 ->（可选）整轮等待。
// tick() 根据 millis() 的差值补齐阶段，不使用 delay()，所以串口/GPIO/USB
// 处理仍可在宏运行过程中继续响应。

namespace farmers {

MacroEngine::MacroEngine(const MacroStep* steps, size_t stepCount,
                         uint32_t loopGapMs, bool repeat)
    : steps_(steps),
      stepCount_(stepCount),
      loopGapMs_(loopGapMs),
      repeat_(repeat),
      running_(false),
      phase_(MacroPhase::kIdle),
      stepIndex_(0),
      phaseStartedAtMs_(0),
      cycleCount_(0),
      report_(kNeutralReport),
      reportChanged_(false) {}

void MacroEngine::start(uint32_t nowMs) {
  cycleCount_ = 0;
  stepIndex_ = 0;
  phaseStartedAtMs_ = nowMs;

  if (steps_ == nullptr || stepCount_ == 0) {
    running_ = false;
    phase_ = MacroPhase::kIdle;
    setReport(kNeutralReport);
    return;
  }

  running_ = true;
  phase_ = MacroPhase::kSteps;
  setReport(steps_[0].report);
  // 即使第 1 步是中立状态或与上一份手动报告相同，START 也必须强制发送一次，
  // 否则 Switch 端可能不会收到新的开始状态。
  reportChanged_ = true;
}

void MacroEngine::stop() {
  running_ = false;
  phase_ = MacroPhase::kIdle;
  stepIndex_ = 0;
  setReport(kNeutralReport);
  // 同理，STOP 必须强制发送中立报告，确保所有按键和摇杆都被释放。
  reportChanged_ = true;
}

bool MacroEngine::configure(const MacroStep* steps, size_t stepCount,
                            uint32_t loopGapMs, bool repeat) {
  if (steps == nullptr || stepCount == 0) {
    return false;
  }

  stop();
  steps_ = steps;
  stepCount_ = stepCount;
  loopGapMs_ = loopGapMs;
  repeat_ = repeat;
  return true;
}

void MacroEngine::tick(uint32_t nowMs) {
  if (!running_) {
    return;
  }

  // loop() 通常每几毫秒调用一次 tick。上限防止异常卡顿数分钟后在一次调用中
  // 无限补算阶段，导致主循环再次失去响应。
  const size_t transitionLimit = stepCount_ * 2 + 2;
  size_t transitions = 0;

  while (running_ &&
         static_cast<uint32_t>(nowMs - phaseStartedAtMs_) >=
             phaseDurationMs()) {
    const uint32_t elapsedPhaseDuration = phaseDurationMs();
    phaseStartedAtMs_ += elapsedPhaseDuration;
    advancePhase();
    ++transitions;

    if (transitions >= transitionLimit) {
      phaseStartedAtMs_ = nowMs;
      break;
    }
  }
}

bool MacroEngine::running() const { return running_; }

MacroPhase MacroEngine::phase() const { return phase_; }

size_t MacroEngine::stepIndex() const { return stepIndex_; }

size_t MacroEngine::stepCount() const { return stepCount_; }

uint32_t MacroEngine::cycleCount() const { return cycleCount_; }

uint32_t MacroEngine::loopGapMs() const { return loopGapMs_; }

bool MacroEngine::repeat() const { return repeat_; }

const ControllerReport& MacroEngine::report() const { return report_; }

bool MacroEngine::consumeReportChanged() {
  const bool changed = reportChanged_;
  reportChanged_ = false;
  return changed;
}

uint32_t MacroEngine::phaseDurationMs() const {
  if (phase_ == MacroPhase::kSteps) {
    return steps_[stepIndex_].durationMs;
  }
  if (phase_ == MacroPhase::kStepWait) {
    return steps_[stepIndex_].waitMs;
  }
  if (phase_ == MacroPhase::kLoopGap) {
    return loopGapMs_;
  }
  return 1;
}

uint32_t MacroEngine::phaseElapsedMs(uint32_t nowMs) const {
  if (!running_) {
    return 0;
  }
  const uint32_t duration = phaseDurationMs();
  const uint32_t elapsed = static_cast<uint32_t>(nowMs - phaseStartedAtMs_);
  return elapsed < duration ? elapsed : duration;
}

uint32_t MacroEngine::phaseRemainingMs(uint32_t nowMs) const {
  if (!running_) {
    return 0;
  }
  return phaseDurationMs() - phaseElapsedMs(nowMs);
}

void MacroEngine::advancePhase() {
  // 整轮间隔结束后，从第 1 步重新开始。
  if (phase_ == MacroPhase::kLoopGap) {
    phase_ = MacroPhase::kSteps;
    stepIndex_ = 0;
    setReport(steps_[0].report);
    return;
  }

  // 一步按住结束后，若配置了 waitMs，先发送中立报告再等待。
  if (phase_ == MacroPhase::kSteps && steps_[stepIndex_].waitMs > 0) {
    phase_ = MacroPhase::kStepWait;
    setReport(kNeutralReport);
    return;
  }

  // 没有等待或等待结束后，推进至下一动作。
  if (stepIndex_ + 1 < stepCount_) {
    phase_ = MacroPhase::kSteps;
    ++stepIndex_;
    setReport(steps_[stepIndex_].report);
    return;
  }

  // 已跑完最后一步：记录轮数，然后停止或进入下一轮。
  ++cycleCount_;
  if (!repeat_) {
    running_ = false;
    phase_ = MacroPhase::kIdle;
    stepIndex_ = 0;
    setReport(kNeutralReport);
    return;
  }

  if (loopGapMs_ > 0) {
    phase_ = MacroPhase::kLoopGap;
    stepIndex_ = 0;
    setReport(kNeutralReport);
    return;
  }

  phase_ = MacroPhase::kSteps;
  stepIndex_ = 0;
  setReport(steps_[0].report);
}

void MacroEngine::setReport(const ControllerReport& report) {
  if (report_ != report) {
    report_ = report;
    reportChanged_ = true;
  }
}

}  // namespace farmers
