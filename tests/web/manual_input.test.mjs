import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALL_CONTROLS,
  bindingConflict,
  buildManualReport,
  BUTTON_BITS,
  controlForKey,
  dpadValue,
  DEFAULT_KEY_BINDINGS,
  KEYBOARD_BINDINGS,
  ManualInputState,
  normalizeKeyBindings,
} from "../../web/src/utils/manual-input.js";

test("all 14 Switch button bits are represented", () => {
  assert.deepEqual(BUTTON_BITS, {
    Y: 0,
    B: 1,
    A: 2,
    X: 3,
    L: 4,
    R: 5,
    ZL: 6,
    ZR: 7,
    MINUS: 8,
    PLUS: 9,
    L_STICK_PRESS: 10,
    R_STICK_PRESS: 11,
    HOME: 12,
    CAPTURE: 13,
  });
  assert.equal(buildManualReport(Object.keys(BUTTON_BITS)).buttons, 0x3fff);
});

test("D-pad supports cardinals, diagonals and cancels opposite directions", () => {
  assert.equal(dpadValue([]), 15);
  assert.equal(dpadValue(["DPAD_UP"]), 0);
  assert.equal(dpadValue(["DPAD_UP", "DPAD_RIGHT"]), 1);
  assert.equal(dpadValue(["DPAD_RIGHT"]), 2);
  assert.equal(dpadValue(["DPAD_DOWN", "DPAD_RIGHT"]), 3);
  assert.equal(dpadValue(["DPAD_DOWN"]), 4);
  assert.equal(dpadValue(["DPAD_DOWN", "DPAD_LEFT"]), 5);
  assert.equal(dpadValue(["DPAD_LEFT"]), 6);
  assert.equal(dpadValue(["DPAD_UP", "DPAD_LEFT"]), 7);
  assert.equal(dpadValue(["DPAD_UP", "DPAD_DOWN"]), 15);
  assert.equal(
    dpadValue(["DPAD_UP", "DPAD_DOWN", "DPAD_RIGHT"]),
    2,
  );
});

test("manual reports use both analog sticks and combine cardinal directions", () => {
  assert.deepEqual(buildManualReport(["A", "L", "DPAD_UP"]), {
    buttons: (1 << 2) | (1 << 4),
    dpad: 0,
    leftX: 128,
    leftY: 128,
    rightX: 128,
    rightY: 128,
    command: "R 20 0 128 128 128 128",
  });
  assert.deepEqual(
    buildManualReport([
      "LEFT_STICK_UP",
      "LEFT_STICK_RIGHT",
      "RIGHT_STICK_DOWN",
      "RIGHT_STICK_LEFT",
    ]),
    {
      buttons: 0,
      dpad: 15,
      leftX: 255,
      leftY: 0,
      rightX: 0,
      rightY: 255,
      command: "R 0 15 255 0 0 255",
    },
  );
  assert.equal(buildManualReport([]).command, "R 0 15 128 128 128 128");
});

test("every digital control has one keyboard binding and one UI button", async () => {
  const keyboardControls = [...new Set(Object.values(KEYBOARD_BINDINGS))].sort();
  assert.deepEqual(keyboardControls, [...ALL_CONTROLS].sort());

  const html = await readFile("web/src/components/VirtualGamepad.vue", "utf8");
  const uiControls = [
    ...html.matchAll(/\["[^"]+","([A-Z0-9_]+)"\]/g),
  ].map((match) => match[1]).filter((control) => ALL_CONTROLS.includes(control));
  assert.equal(uiControls.length, ALL_CONTROLS.length);
  assert.deepEqual([...uiControls].sort(), [...ALL_CONTROLS].sort());
});

test("shoulder buttons keep the requested Q E O U keyboard layout", () => {
  assert.equal(DEFAULT_KEY_BINDINGS.ZL, "KeyQ");
  assert.equal(DEFAULT_KEY_BINDINGS.L, "KeyE");
  assert.equal(DEFAULT_KEY_BINDINGS.R, "KeyU");
  assert.equal(DEFAULT_KEY_BINDINGS.ZR, "KeyO");
});

test("shoulder buttons use the requested left-to-right visual order", async () => {
  const html = await readFile("web/src/components/VirtualGamepad.vue", "utf8");
  assert.match(html, /shouldersLeft = \[\["ZL","ZL"\],\["L","L"\]\]/);
  assert.match(html, /shouldersRight = \[\["R","R"\],\["ZR","ZR"\]\]/);
});

test("input state keeps a control pressed until every source releases it", () => {
  const changes = [];
  const state = new ManualInputState((active) =>
    changes.push([...active].sort()),
  );

  assert.equal(state.press("keyboard:KeyL", "A"), true);
  assert.equal(state.press("pointer:1", "A"), false);
  assert.deepEqual([...state.activeControls()], ["A"]);
  assert.equal(state.release("keyboard:KeyL"), false);
  assert.deepEqual([...state.activeControls()], ["A"]);
  assert.equal(state.release("pointer:1"), true);
  assert.deepEqual([...state.activeControls()], []);
  assert.deepEqual(changes, [["A"], []]);
});

test("clearing input releases simultaneous controls in one state change", () => {
  const changes = [];
  const state = new ManualInputState((active) =>
    changes.push([...active].sort()),
  );
  state.press("keyboard:ArrowUp", "DPAD_UP");
  state.press("keyboard:KeyI", "X");
  assert.equal(state.clear(), true);
  assert.deepEqual(changes.at(-1), []);
  assert.equal(state.clear(), false);
});

test("custom bindings preserve defaults and reject duplicate keys", () => {
  const custom = normalizeKeyBindings({ ...DEFAULT_KEY_BINDINGS, A: "KeyP" });
  assert.equal(controlForKey(custom, "KeyP"), "A");
  assert.equal(controlForKey(custom, "KeyL"), null);
  assert.equal(bindingConflict(custom, "B", "KeyP"), "A");
  assert.equal(normalizeKeyBindings({ A: "KeyP" }).B, DEFAULT_KEY_BINDINGS.B);
});
