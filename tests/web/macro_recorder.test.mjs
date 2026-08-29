import assert from "node:assert/strict";
import test from "node:test";

import { MacroRecorder, RECORDER_MODES } from "../../web/src/utils/macro-recorder.js";

test("records buttons, analog directions and gaps with exact transitions", () => {
  const recorder = new MacroRecorder();
  recorder.start([], 1000);
  recorder.change(["A"], 1100);
  recorder.change(["A", "LEFT_STICK_UP"], 1250);
  recorder.change([], 1500);
  recorder.change(["RIGHT_STICK_RIGHT"], 1700);
  const steps = recorder.stop(1900);

  assert.deepEqual(steps, [
    { durationMs: 150, waitMs: 0, buttons: 4, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 },
    { durationMs: 250, waitMs: 200, buttons: 4, dpad: 15, leftX: 128, leftY: 0, rightX: 128, rightY: 128 },
    { durationMs: 200, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 255, rightY: 128 },
  ]);
});

test("ignores leading and trailing idle time", () => {
  const recorder = new MacroRecorder();
  recorder.start([], 0);
  recorder.change([], 1000);
  recorder.change(["ZR"], 1100);
  recorder.change([], 1600);
  assert.deepEqual(recorder.stop(2100), [
    { durationMs: 500, waitMs: 0, buttons: 128, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 },
  ]);
});

test("filters small analog jitter but keeps meaningful stick transitions", () => {
  const recorder = new MacroRecorder();
  const center = { buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 };
  recorder.start(center, 0);
  recorder.changeReport({ ...center, leftX: 135 }, 10);
  recorder.changeReport({ ...center, leftX: 145 }, 20);
  recorder.changeReport(center, 40);

  assert.deepEqual(recorder.stop(100), [
    { durationMs: 20, waitMs: 0, buttons: 0, dpad: 15, leftX: 144, leftY: 128, rightX: 128, rightY: 128 },
  ]);
});

test("records right-stick pulse mode as a fixed single-axis hold", () => {
  const recorder = new MacroRecorder({ mode: RECORDER_MODES.RIGHT_STICK_PULSE });
  const center = { buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 };
  recorder.start(center, 0);
  recorder.changeReport({ ...center, rightX: 135 }, 10);
  recorder.changeReport({ ...center, rightX: 170 }, 20);
  recorder.changeReport({ ...center, rightX: 240 }, 50);
  recorder.changeReport(center, 80);

  assert.deepEqual(recorder.stop(100), [
    { durationMs: 60, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 255, rightY: 128 },
  ]);
});

test("projects diagonal right-stick input to the dominant cardinal axis", () => {
  const recorder = new MacroRecorder({ mode: RECORDER_MODES.RIGHT_STICK_PULSE });
  const center = { buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 };
  recorder.start(center, 0);
  recorder.changeReport({ ...center, rightX: 220, rightY: 220 }, 10);
  recorder.changeReport({ ...center, rightX: 128, rightY: 220 }, 40);

  assert.deepEqual(recorder.stop(60), [
    { durationMs: 30, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 255, rightY: 128 },
    { durationMs: 20, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 255 },
  ]);
});

test("preserves a neutral wait between right-stick pulses", () => {
  const recorder = new MacroRecorder({ mode: RECORDER_MODES.RIGHT_STICK_PULSE });
  const center = { buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 };
  recorder.start(center, 0);
  recorder.changeReport({ ...center, rightX: 220 }, 10);
  recorder.changeReport(center, 50);
  recorder.changeReport({ ...center, rightY: 220 }, 80);

  assert.deepEqual(recorder.stop(100), [
    { durationMs: 40, waitMs: 30, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 255, rightY: 128 },
    { durationMs: 20, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 255 },
  ]);
});
