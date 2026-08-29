import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_MACROS } from "../../web/src/utils/builtin-macros.js";

test("the frontend mirror exposes the four compiled board macros", () => {
  assert.deepEqual(BUILTIN_MACROS.map(({ name }) => name), [
    "天埠罗巢穴刷武器", "杏棱巢穴刷钱", "武器分解", "连接手柄",
  ]);
  assert.deepEqual(BUILTIN_MACROS.map(({ macro }) => macro.steps.length), [18, 26, 23, 1]);
  assert.deepEqual(BUILTIN_MACROS.map(({ macro }) => macro.steps.reduce(
    (total, step) => total + step.durationMs + step.waitMs, 0,
  )), [72000, 65900, 24800, 1000]);

  const weaponFarm = BUILTIN_MACROS[0].macro.steps;
  assert.equal(weaponFarm[6].buttons, (1 << 7) | (1 << 11));
  assert.equal(weaponFarm[10].leftX, 0);
  assert.equal(weaponFarm[10].buttons, 1 << 7);
});
