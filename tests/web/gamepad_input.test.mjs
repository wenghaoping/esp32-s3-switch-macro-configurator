import assert from "node:assert/strict";
import test from "node:test";

import {
  gamepadToReport,
  GamepadInputSource,
  identifyGamepadType,
  mappingForGamepad,
  NEUTRAL_GAMEPAD_REPORT,
  reportsEqual,
} from "../../web/src/utils/gamepad-input.js";

function mockGamepad(overrides = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  return {
    id: "Xbox Wireless Controller",
    index: 0,
    connected: true,
    mapping: "standard",
    buttons,
    axes: [0, 0, 0, 0],
    ...overrides,
  };
}

test("maps Xbox face buttons by physical position to Switch", () => {
  const gamepad = mockGamepad({ axes: [-1, 1, 0.5, -0.5] });
  gamepad.buttons[0].pressed = true; // Xbox bottom A -> Switch bottom B
  gamepad.buttons[4].pressed = true; // LB -> L
  gamepad.buttons[12].pressed = true; // d-pad up
  gamepad.buttons[15].pressed = true; // d-pad right

  const result = gamepadToReport(gamepad);

  assert.equal(result.report.buttons, (1 << 1) | (1 << 4));
  assert.equal(result.report.dpad, 1);
  assert.equal(result.report.leftX, 0);
  assert.equal(result.report.leftY, 255);
  assert.ok(result.report.rightX > 128);
  assert.ok(result.report.rightY < 128);
  assert.deepEqual(result.controls, ["B", "L", "DPAD_UP", "DPAD_RIGHT", "LEFT_STICK_DOWN", "LEFT_STICK_LEFT", "RIGHT_STICK_UP", "RIGHT_STICK_RIGHT"]);
});

test("automatically identifies PS5 DualSense and maps its face buttons by position", () => {
  const gamepad = mockGamepad({
    id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  });
  gamepad.buttons[0].pressed = true; // PS5 bottom Cross -> Switch bottom B
  gamepad.buttons[1].pressed = true; // PS5 right Circle -> Switch right A
  gamepad.buttons[2].pressed = true; // PS5 left Square -> Switch left Y
  gamepad.buttons[3].pressed = true; // PS5 top Triangle -> Switch top X

  assert.equal(identifyGamepadType(gamepad), "ps5");
  assert.equal(mappingForGamepad(gamepad).type, "ps5");
  assert.equal(gamepadToReport(gamepad).report.buttons, 0b1111);
});

test("keeps unknown standard controllers usable with the same physical layout", () => {
  const gamepad = mockGamepad({ id: "USB Gamepad" });
  gamepad.buttons[0].pressed = true;

  assert.equal(identifyGamepadType(gamepad), "generic");
  assert.equal(mappingForGamepad(gamepad).type, "generic");
  assert.equal(gamepadToReport(gamepad).report.buttons, 1 << 1);
});

test("applies an analog deadzone to Elite controller stick drift", () => {
  const result = gamepadToReport(mockGamepad({ axes: [0.1, -0.15, 0.16, -0.2] }));

  assert.deepEqual(result.report, {
    buttons: 0,
    dpad: 15,
    leftX: 128,
    leftY: 128,
    rightX: 128,
    rightY: 121,
  });
});

test("gamepad source emits a neutral report when no controller is available", () => {
  const changes = [];
  let frameCallback;
  const source = new GamepadInputSource({
    onChange: (state) => changes.push(state),
    getGamepads: () => [null],
    eventTarget: { addEventListener() {}, removeEventListener() {} },
    requestFrame: (callback) => { frameCallback = callback; return 1; },
    cancelFrame() {},
  });

  source.start();
  frameCallback();

  assert.equal(changes.length, 1);
  assert.equal(changes[0].connected, false);
  assert.ok(reportsEqual(changes[0].report, NEUTRAL_GAMEPAD_REPORT));
  source.stop();
});
