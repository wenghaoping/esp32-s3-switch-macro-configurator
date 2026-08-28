import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMacroUploadCommands } from "../../web/src/utils/macro-editor.js";
import {
  buildTriggerUploadCommands,
  cloneTriggerConfig,
  defaultTriggerConfig,
  normalizeLibraryDocument,
  SAFE_TRIGGER_PINS,
  TASK_TRIGGER_SLOT,
  triggerConfigChecksum,
  validateTriggerConfig,
} from "../../web/src/utils/library-manager.js";
import { parseDeviceLine } from "../../web/src/utils/protocol.js";
import { MockSerialTransport } from "../../web/src/utils/serial-transport.js";

const macro = {
  steps: [{
    durationMs: 100,
    waitMs: 0,
    buttons: 0,
    dpad: 15,
    leftX: 128,
    leftY: 128,
    rightX: 128,
    rightY: 128,
  }],
  loopGapMs: 0,
  repeat: false,
};

test("uses only the agreed safe GPIO allowlist", () => {
  assert.deepEqual(SAFE_TRIGGER_PINS, [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21]);
  assert(!SAFE_TRIGGER_PINS.includes(0));
  assert(!SAFE_TRIGGER_PINS.includes(19));
  assert(!SAFE_TRIGGER_PINS.includes(43));
});

test("builds an 8-entry transactional GPIO upload with firmware checksum", () => {
  const config = defaultTriggerConfig();
  const slots = Array.from({ length: 8 }, (_, slot) => ({ occupied: slot < 4 }));
  const commands = buildTriggerUploadCommands(config, slots);
  assert.equal(commands[0], "TRIGGER_BEGIN 8");
  assert.equal(commands[1], "TRIGGER_ENTRY 0 1 1 0");
  assert.equal(commands[8], "TRIGGER_ENTRY 7 0 9 7");
  assert.equal(commands[9], "TRIGGER_STOP_PIN 10");
  assert.equal(triggerConfigChecksum(config), 2609298067);
  assert.equal(commands[10], `TRIGGER_COMMIT ${triggerConfigChecksum(config)}`);
});

test("copies a reactive trigger config without cloning its proxy", () => {
  const original = defaultTriggerConfig();
  original.entries[0].pin = 11;
  const reactiveLikeProxy = new Proxy(original, {});
  const copy = cloneTriggerConfig(reactiveLikeProxy);
  assert.deepEqual(copy, original);
  copy.entries[0].pin = 12;
  assert.equal(original.entries[0].pin, 11);
});

test("rejects duplicate, stop-conflicting and empty-slot trigger bindings", () => {
  const slots = Array.from({ length: 8 }, (_, slot) => ({ occupied: slot < 4 }));
  const duplicate = defaultTriggerConfig();
  duplicate.entries[1].pin = 1;
  assert.match(validateTriggerConfig(duplicate, slots).join(" "), /重复/);

  const stopConflict = defaultTriggerConfig();
  stopConflict.stop_pin = 1;
  assert.match(validateTriggerConfig(stopConflict, slots).join(" "), /同时/);

  const empty = defaultTriggerConfig();
  empty.entries[4].enabled = true;
  assert.match(validateTriggerConfig(empty, slots).join(" "), /空/);
});

test("allows a GPIO trigger to start a saved macro loop", () => {
  const slots = Array.from({ length: 8 }, (_, slot) => ({ occupied: slot < 4 }));
  const taskPlan = {
    name: "按键大循环",
    repeat: true,
    entries: [{ slot: 0, repeatCount: 3, gapMs: 0 }],
  };
  const config = defaultTriggerConfig();
  config.entries[0].slot = TASK_TRIGGER_SLOT;

  assert.match(validateTriggerConfig(config, slots).join(" "), /请先保存宏循环/);
  const commands = buildTriggerUploadCommands(config, slots, taskPlan);
  assert.equal(commands[1], "TRIGGER_ENTRY 0 1 1 8");

  const restored = normalizeLibraryDocument({
    format: "splatoon-farmers-library",
    version: 2,
    slots: Array.from({ length: 8 }, (_, index) => ({
      slot: index + 1,
      source: index === 0 ? "builtin" : "empty",
      name: `Slot ${index + 1}`,
    })),
    triggers: {
      entries: [{ index: 0, pin: 1, action: "task", enabled: true }],
      stopPin: 10,
    },
    taskPlan,
  });
  assert.equal(restored.triggers.entries[0].slot, TASK_TRIGGER_SLOT);
});

test("normalizes a complete version 2 backup into board protocol slots", () => {
  const documentData = normalizeLibraryDocument({
    format: "splatoon-farmers-library",
    version: 2,
    slots: [
      { slot: 1, source: "builtin", name: "天埠罗巢穴刷武器" },
      ...Array.from({ length: 6 }, (_, index) => ({ slot: index + 2, source: index < 3 ? "builtin" : "empty", name: `Slot ${index + 2}` })),
      { slot: 8, source: "stored", name: "Slot 8", macro: { steps: macro.steps, loopGapMs: macro.loopGapMs } },
    ],
    triggers: {
      entries: [{ pin: 9, slot: 8, enabled: true }],
      stopPin: 10,
    },
  });
  assert.equal(documentData.slots[0].slot, 0);
  assert.equal(documentData.slots.at(-1).slot, 7);
  assert.equal(documentData.triggers.entries[7].slot, 7);
  assert.equal(documentData.triggers.entries[7].enabled, true);
});

test("rejects old backups and retired per-macro plans", () => {
  const slots = Array.from({ length: 8 }, (_, index) => ({
    slot: index + 1,
    source: index < 4 ? "builtin" : "empty",
    name: `Slot ${index + 1}`,
  }));
  const base = {
    format: "splatoon-farmers-library",
    version: 2,
    slots,
    triggers: { entries: [], stopPin: 10 },
  };
  assert.throws(() => normalizeLibraryDocument({ ...base, version: 1 }), /旧格式/);
  const withPlan = structuredClone(base);
  withPlan.slots[0].plan = { segments: [] };
  assert.throws(() => normalizeLibraryDocument(withPlan), /步骤分段/);
});

test("mock exposes built-ins, starts a requested slot and restores an override", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });
  await transport.connect();
  await transport.send("MACRO_LIST");
  const initial = lines.at(-1);
  assert.equal(initial.slots.length, 8);
  assert.equal(initial.slots[0].source, "builtin");
  assert.equal(initial.slots[0].name, "天埠罗巢穴刷武器");
  assert.equal(initial.slots[1].steps, 26);
  assert.equal(initial.slots[2].name, "武器分解");
  assert.equal(initial.slots[3].name, "连接手柄");

  await transport.send("MACRO_START 2");
  assert.equal(lines.at(-1).state, "running");
  assert.equal(lines.at(-1).slot, 2);

  await transport.send("STOP");
  for (const command of buildMacroUploadCommands(macro, { slot: 0, name: "Override" })) {
    await transport.send(command);
  }
  assert.equal(transport.slots[0].source, "stored");
  await transport.send("MACRO_RESTORE 0");
  assert.equal(transport.slots[0].source, "builtin");
  assert.equal(transport.slots[0].has_stored, false);
});

test("mock commits GPIO as one checked transaction", async () => {
  const transport = new MockSerialTransport({ onLine: () => {}, onDisconnect: () => {} });
  await transport.connect();
  const config = defaultTriggerConfig();
  config.entries[2].pin = 11;
  for (const command of buildTriggerUploadCommands(config, transport.slots)) {
    await transport.send(command);
  }
  assert.equal(transport.triggerConfig.entries[2].pin, 11);
});

test("Vue router separates control, scripts, recorder and device responsibilities", async () => {
  const [router, scripts, control, recorder, device, editor, deviceStore, index] = await Promise.all([
    readFile(new URL("../../web/src/router.js", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/pages/ScriptsPage.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/pages/ControlPage.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/pages/RecorderPage.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/pages/DevicePage.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/pages/ScriptEditorPage.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/stores/device.js", import.meta.url), "utf8"),
    readFile(new URL("../../web/index.html", import.meta.url), "utf8"),
  ]);
  for (const path of ["/control", "/scripts", "/recorder", "/device"]) assert.match(router, new RegExp(`path: "${path}"`));
  assert.match(scripts, /MAX_TASK_ENTRIES/);
  assert.match(scripts, /moveEntry\(index,-1\)/);
  assert.match(scripts, /moveEntry\(index,1\)/);
  assert.doesNotMatch(scripts, /draggable=/);
  assert.doesNotMatch(scripts, /起始步骤|结束步骤|plan-segment/);
  assert.match(control, /需要补一刀/);
  assert.match(control, /当前动作/);
  assert.match(control, /运行宏循环/);
  assert.match(recorder, /写入 Flash/);
  assert.match(recorder, /停止计时/);
  assert.match(device, /GPIO 触发配置/);
  assert.doesNotMatch(device, /structuredClone/);
  for (const label of ["复制 JSON", "粘贴 JSON", "查看 JSON"]) assert.match(editor, new RegExp(label));
  assert.match(index, /<title>ESP32-S3 Configurator · 板载宏控制台<\/title>/);
  assert.match(deviceStore, /retryHandshake \? 5 : 1/);
  assert.match(deviceStore, /if \(!connected\.value \|\| !isStatusActive\(\)\) return/);
  assert.doesNotMatch(deviceStore, /5000/);
});

test("accepts uploading the eighth macro slot", () => {
  assert.equal(buildMacroUploadCommands(macro, { slot: 7, name: "Eight" })[0], "MACRO_BEGIN 7 1 0 0");
});
