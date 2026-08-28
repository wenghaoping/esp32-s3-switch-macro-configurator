import assert from "node:assert/strict";
import test from "node:test";

import { MacroRecorder } from "../../web/src/utils/macro-recorder.js";

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
