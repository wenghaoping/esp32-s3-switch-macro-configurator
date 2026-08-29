import assert from "node:assert/strict";
import test from "node:test";

import {
  optimizeMacroSteps,
  quantizeAxis,
  summarizeMacroDirections,
} from "../../web/src/utils/macro-optimizer.js";

const step = (overrides = {}) => ({
  durationMs: 10,
  waitMs: 0,
  buttons: 0,
  dpad: 15,
  leftX: 128,
  leftY: 128,
  rightX: 128,
  rightY: 128,
  ...overrides,
});

test("quantizes analog values without changing stick endpoints", () => {
  assert.equal(quantizeAxis(0), 0);
  assert.equal(quantizeAxis(128), 128);
  assert.equal(quantizeAxis(255), 255);
  assert.equal(quantizeAxis(135), 136);
  assert.equal(quantizeAxis(140), 144);
});

test("merges nearby analog steps and preserves duration", () => {
  const source = [
    step({ leftX: 128 }),
    step({ leftX: 135 }),
    step({ leftX: 142 }),
    step({ leftX: 160 }),
  ];
  const optimized = optimizeMacroSteps(source);

  assert.deepEqual(optimized.map(({ durationMs, leftX }) => ({ durationMs, leftX })), [
    { durationMs: 20, leftX: 128 },
    { durationMs: 10, leftX: 144 },
    { durationMs: 10, leftX: 160 },
  ]);
  assert.equal(
    optimized.reduce((total, current) => total + current.durationMs, 0),
    source.reduce((total, current) => total + current.durationMs, 0),
  );
});

test("does not merge across waits or digital transitions", () => {
  const source = [
    step({ leftX: 128 }),
    step({ leftX: 136, waitMs: 50 }),
    step({ leftX: 144 }),
    step({ leftX: 152, buttons: 4 }),
  ];

  assert.equal(optimizeMacroSteps(source).length, 4);
});

test("summarizes a continuous stick combination into one hold", () => {
  const source = [
    step({ leftX: 144, leftY: 112, rightX: 152 }),
    step({ durationMs: 20, leftX: 216, leftY: 40, rightX: 240 }),
    step({ durationMs: 30, leftX: 255, leftY: 0, rightX: 255 }),
  ];

  assert.deepEqual(summarizeMacroDirections(source).map(({ durationMs, leftX, leftY, rightX, rightY }) => ({
    durationMs,
    leftX,
    leftY,
    rightX,
    rightY,
  })), [
    { durationMs: 60, leftX: 255, leftY: 0, rightX: 255, rightY: 128 },
  ]);
});
