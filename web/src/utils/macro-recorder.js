import { buildManualReport, normalizeControllerReport } from "./manual-input.js";
import { MIN_STEP_DURATION_MS } from "./macro-editor.js";
import {
  DEFAULT_AXIS_CHANGE_THRESHOLD,
  DEFAULT_AXIS_QUANTUM,
  normalizeRightStickPulseStep,
  optimizeMacroSteps,
  quantizeMacroStep,
} from "./macro-optimizer.js";

export const RECORDER_MODES = Object.freeze({
  PRECISE: "precise",
  RIGHT_STICK_PULSE: "right-stick-pulse",
});

function normalizeRecorderMode(mode) {
  return mode === RECORDER_MODES.RIGHT_STICK_PULSE
    ? RECORDER_MODES.RIGHT_STICK_PULSE
    : RECORDER_MODES.PRECISE;
}

function reportStep(activeControls, durationMs = 0, mode = RECORDER_MODES.PRECISE) {
  const report = buildManualReport(activeControls);
  return reportStepFromReport(report, durationMs, mode);
}

function reportStepFromReport(inputReport, durationMs = 0, mode = RECORDER_MODES.PRECISE) {
  const report = normalizeControllerReport(inputReport);
  const step = quantizeMacroStep({
    durationMs,
    waitMs: 0,
    buttons: report.buttons,
    dpad: report.dpad,
    leftX: report.leftX,
    leftY: report.leftY,
    rightX: report.rightX,
    rightY: report.rightY,
  }, DEFAULT_AXIS_QUANTUM);
  return mode === RECORDER_MODES.RIGHT_STICK_PULSE
    ? normalizeRightStickPulseStep(step)
    : step;
}

function isNeutral(step) {
  return (
    step.buttons === 0 &&
    step.dpad === 15 &&
    step.leftX === 128 &&
    step.leftY === 128 &&
    step.rightX === 128 &&
    step.rightY === 128
  );
}

function sameInput(left, right) {
  return (
    left.buttons === right.buttons &&
    left.dpad === right.dpad &&
    left.leftX === right.leftX &&
    left.leftY === right.leftY &&
    left.rightX === right.rightX &&
    left.rightY === right.rightY
  );
}

function sameDigitalInput(left, right) {
  return left.buttons === right.buttons && left.dpad === right.dpad;
}

function axisDistance(left, right) {
  return Math.max(
    Math.abs(left.leftX - right.leftX),
    Math.abs(left.leftY - right.leftY),
    Math.abs(left.rightX - right.rightX),
    Math.abs(left.rightY - right.rightY),
  );
}

export class MacroRecorder {
  constructor({ mode = RECORDER_MODES.PRECISE } = {}) {
    this.mode = normalizeRecorderMode(mode);
    this.reset();
  }

  setMode(mode) {
    if (this.recording) return false;
    this.mode = normalizeRecorderMode(mode);
    return true;
  }

  start(activeControls, now) {
    this.reset();
    this.recording = true;
    this.lastStep = Array.isArray(activeControls)
      ? reportStep(activeControls, 0, this.mode)
      : reportStepFromReport(activeControls, 0, this.mode);
    this.lastChangedAt = now;
    this.startedAt = now;
    this.hasInput = !isNeutral(this.lastStep);
  }

  change(activeControls, now) {
    this.changeReport(buildManualReport(activeControls), now);
  }

  changeReport(report, now) {
    if (!this.recording) {
      return;
    }
    const nextStep = reportStepFromReport(report, 0, this.mode);
    if (sameInput(this.lastStep, nextStep)) {
      return;
    }
    if (
      sameDigitalInput(this.lastStep, nextStep) &&
      axisDistance(this.lastStep, nextStep) < DEFAULT_AXIS_CHANGE_THRESHOLD
    ) {
      return;
    }
    if (this.hasInput) {
      this.appendCurrent(now);
    } else if (!isNeutral(nextStep)) {
      this.hasInput = true;
    }
    this.lastStep = nextStep;
    this.lastChangedAt = now;
  }

  stop(now) {
    if (!this.recording) {
      return [];
    }
    if (this.hasInput && !isNeutral(this.lastStep)) {
      this.appendCurrent(now);
    }
    this.recording = false;
    const actions = [];
    for (const step of this.steps) {
      if (isNeutral(step) && actions.length > 0) {
        actions.at(-1).waitMs += step.durationMs;
      } else if (!isNeutral(step)) {
        actions.push({ ...step, waitMs: 0 });
      }
    }
    return optimizeMacroSteps(actions);
  }

  cancel() {
    this.reset();
  }

  elapsedMs(now) {
    return this.recording ? Math.max(0, Math.round(now - this.startedAt)) : 0;
  }

  reset() {
    this.recording = false;
    this.steps = [];
    this.lastStep = null;
    this.lastChangedAt = 0;
    this.startedAt = 0;
    this.hasInput = false;
  }

  appendCurrent(now) {
    const durationMs = Math.max(
      MIN_STEP_DURATION_MS,
      Math.round(now - this.lastChangedAt),
    );
    const previous = this.steps.at(-1);
    if (previous && sameInput(previous, this.lastStep)) {
      previous.durationMs += durationMs;
      return;
    }
    this.steps.push({ ...this.lastStep, durationMs });
  }
}
