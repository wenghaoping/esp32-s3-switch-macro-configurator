import { buildManualReport } from "./manual-input.js";
import { MIN_STEP_DURATION_MS } from "./macro-editor.js";

function reportStep(activeControls, durationMs = 0) {
  const report = buildManualReport(activeControls);
  return {
    durationMs,
    waitMs: 0,
    buttons: report.buttons,
    dpad: report.dpad,
    leftX: report.leftX,
    leftY: report.leftY,
    rightX: report.rightX,
    rightY: report.rightY,
  };
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

export class MacroRecorder {
  constructor() {
    this.reset();
  }

  start(activeControls, now) {
    this.reset();
    this.recording = true;
    this.lastStep = reportStep(activeControls);
    this.lastChangedAt = now;
    this.startedAt = now;
    this.hasInput = !isNeutral(this.lastStep);
  }

  change(activeControls, now) {
    if (!this.recording) {
      return;
    }
    const nextStep = reportStep(activeControls);
    if (sameInput(this.lastStep, nextStep)) {
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
    return actions;
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
