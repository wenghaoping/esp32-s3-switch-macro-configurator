import assert from "node:assert/strict";
import test from "node:test";

import { describeCurrentAction, describeMacroStep } from "../../web/src/utils/action-description.js";
import { createInputProbe, describeInputProbe, stopInputProbe, updateInputProbe } from "../../web/src/utils/input-probe.js";

test("describes buttons, d-pad, sticks and hold duration", () => {
  const result = describeCurrentAction({
    state: "running",
    phase: "steps",
    current_buttons: (1 << 2) | (1 << 6),
    current_dpad: 0,
    current_left_x: 128,
    current_left_y: 0,
    current_right_x: 128,
    current_right_y: 128,
    current_hold_ms: 500,
    current_phase_remaining_ms: 320,
  });
  assert.equal(result.title, "A + ZL + 十字键上 ↑ + 左摇杆上");
  assert.equal(result.timing, "保持 500 毫秒 · 剩余 320 毫秒");
});

test("describes released controls during an action wait", () => {
  const result = describeCurrentAction({
    state: "running",
    phase: "step-wait",
    current_wait_ms: 1000,
    current_phase_remaining_ms: 250,
  });
  assert.equal(result.title, "已松开全部按键");
  assert.equal(result.timing, "动作后等待 1 秒 · 剩余 250 毫秒");
});

test("summarizes one editable macro step", () => {
  const result = describeMacroStep({
    buttons: (1 << 2) | (1 << 6), dpad: 15,
    leftX: 128, leftY: 0, rightX: 128, rightY: 128,
    durationMs: 240, waitMs: 80,
  });
  assert.equal(result.title, "A + ZL + 左摇杆上");
  assert.equal(result.timing, "按住 240 毫秒 → 松开全部按键 → 等待 80 毫秒");
});

test("measures an input without starting macro recording and replaces it", () => {
  let probe = createInputProbe();
  probe = updateInputProbe(probe, ["RIGHT_STICK_RIGHT"], 1000);
  assert.deepEqual(describeInputProbe(probe, 1250), {
    title: "右摇杆右 →", timing: "正在按住 · 250 毫秒",
  });
  probe = updateInputProbe(probe, [], 1400);
  assert.deepEqual(describeInputProbe(probe, 1700), {
    title: "右摇杆右 →", timing: "共按住 400 毫秒 · 松开 300 毫秒",
  });
  probe = stopInputProbe(probe, 1800);
  assert.equal(describeInputProbe(probe, 2400).timing, "共按住 400 毫秒 · 松开 400 毫秒 · 计时已停止");
  probe = updateInputProbe(probe, ["A"], 1800);
  assert.equal(describeInputProbe(probe, 1850).title, "A");
});
