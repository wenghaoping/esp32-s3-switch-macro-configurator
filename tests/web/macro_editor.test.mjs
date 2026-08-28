import assert from "node:assert/strict";
import test from "node:test";

import {
  axesForStickOption,
  buildMacroUploadCommands,
  buttonEnabled,
  copySelectedSteps,
  deleteSelectedSteps,
  macroChecksum,
  macroCycleMs,
  normalizeMacroDocument,
  serializeMacroDocument,
  setButtonEnabled,
  stickOptionForAxes,
  validateMacro,
  MAX_MACRO_STEPS,
  moveSelectedSteps,
} from "../../web/src/utils/macro-editor.js";

const macro = {
  steps: [
    {
      durationMs: 120,
      waitMs: 0,
      buttons: 20,
      dpad: 15,
      leftX: 128,
      leftY: 0,
      rightX: 128,
      rightY: 128,
    },
    {
      durationMs: 80,
      waitMs: 0,
      buttons: 0,
      dpad: 15,
      leftX: 128,
      leftY: 128,
      rightX: 128,
      rightY: 128,
    },
  ],
  loopGapMs: 500,
  repeat: true,
};

test("builds a complete ordered macro upload", () => {
  const commands = buildMacroUploadCommands(macro);
  assert.equal(commands[0], "MACRO_BEGIN 0 2 500 1");
  assert.equal(commands[1], "MACRO_NAME Macro%201");
  assert.equal(commands[2], "MACRO_STEP 0 120 0 20 15 128 0 128 128");
  assert.equal(commands[3], "MACRO_STEP 1 80 0 0 15 128 128 128 128");
  assert.equal(commands.at(-1), `MACRO_COMMIT ${macroChecksum(macro)}`);
  assert.equal(macroCycleMs(macro), 700);
});

test("uploads a named macro to the selected library slot", () => {
  const commands = buildMacroUploadCommands(macro, { slot: 3, name: "Test route" });
  assert.equal(commands[0], "MACRO_BEGIN 3 2 500 1");
  assert.equal(commands[1], "MACRO_NAME Test%20route");
});

test("rejects an empty or invalid macro before serial upload", () => {
  assert.match(validateMacro({ steps: [] })[0], /at least one/);
  assert.match(
    validateMacro({ ...macro, steps: [{ ...macro.steps[0], durationMs: 9 }] })[0],
    /duration/,
  );
  assert.throws(() => buildMacroUploadCommands({ steps: [] }));
});

test("accepts the full 512-step board limit", () => {
  const steps = Array.from({ length: MAX_MACRO_STEPS }, () => ({
    durationMs: 10,
    waitMs: 0,
    buttons: 0,
    dpad: 15,
    leftX: 128,
    leftY: 128,
    rightX: 128,
    rightY: 128,
  }));
  assert.deepEqual(validateMacro({ steps, loopGapMs: 0, repeat: false }), []);
});

test("copies and deletes a selected group without splitting it", () => {
  const steps = [
    { ...macro.steps[0], durationMs: 10 },
    { ...macro.steps[0], durationMs: 20 },
    { ...macro.steps[0], durationMs: 30 },
    { ...macro.steps[0], durationMs: 40 },
  ];
  const copied = copySelectedSteps(steps, [0, 2]);
  assert.deepEqual(copied.steps.map((step) => step.durationMs), [10, 20, 30, 10, 30, 40]);
  assert.deepEqual(copied.selectedIndexes, [3, 4]);

  const deleted = deleteSelectedSteps(copied.steps, copied.selectedIndexes);
  assert.deepEqual(deleted.steps.map((step) => step.durationMs), [10, 20, 30, 40]);
  assert.deepEqual(deleteSelectedSteps(steps, [0, 1, 2, 3]), null);
});

test("moves selected steps together and preserves their order", () => {
  const steps = [10, 20, 30, 40, 50].map((durationMs) => ({
    ...macro.steps[0],
    durationMs,
  }));
  const moved = moveSelectedSteps(steps, [1, 3], 4, true);
  assert.deepEqual(moved.steps.map((step) => step.durationMs), [10, 30, 50, 20, 40]);
  assert.deepEqual(moved.selectedIndexes, [3, 4]);
  assert.equal(moveSelectedSteps(steps, [1, 3], 3), null);
});

test("maps editor controls to exact controller reports", () => {
  const withA = setButtonEnabled(macro.steps[0], "A", true);
  assert(buttonEnabled(withA, "A"));
  assert.equal(buttonEnabled(withA, "B"), false);
  assert.deepEqual(axesForStickOption("down-left"), { x: 0, y: 255 });
  assert.equal(stickOptionForAxes(255, 0).value, "up-right");
});

test("accepts only the new version 2 macro JSON document", () => {
  const documentData = serializeMacroDocument("测试宏", macro);
  assert.equal(documentData.format, "splatoon-farmers-macro");
  assert.equal(documentData.version, 2);
  assert.equal(normalizeMacroDocument(documentData).name, "测试宏");
  assert.throws(() => normalizeMacroDocument({ ...documentData, version: 1 }), /旧格式/);
  assert.throws(() => normalizeMacroDocument(macro), /旧格式/);
  assert.throws(
    () => normalizeMacroDocument({ ...documentData, plan: { segments: [] } }),
    /步骤分段/,
  );
  const oldFields = structuredClone(documentData);
  oldFields.macro.steps[0].duration_ms = oldFields.macro.steps[0].durationMs;
  delete oldFields.macro.steps[0].durationMs;
  assert.throws(() => normalizeMacroDocument(oldFields), /2.0 字段/);
});
