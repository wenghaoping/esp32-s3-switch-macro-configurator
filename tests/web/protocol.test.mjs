import assert from "node:assert/strict";
import test from "node:test";

import { buildMacroUploadCommands } from "../../web/src/utils/macro-editor.js";
import { buildTaskUploadCommands } from "../../web/src/utils/task-plan.js";
import { formatDuration, parseDeviceLine } from "../../web/src/utils/protocol.js";
import { MockSerialTransport, SerialLineDecoder } from "../../web/src/utils/serial-transport.js";

test("keeps UTF-8 names intact when a Chinese character spans serial chunks", () => {
  const bytes = new TextEncoder().encode('{"name":"随便测试一下"}\n');
  const decoder = new SerialLineDecoder();
  const splitAt = bytes.indexOf(0xe4) + 1;
  assert.deepEqual(decoder.push(bytes.slice(0, splitAt)), []);
  assert.deepEqual(decoder.push(bytes.slice(splitAt)), ['{"name":"随便测试一下"}']);
  assert.deepEqual(decoder.finish(), []);
});

test("parses firmware status JSON", () => {
  const message = parseDeviceLine(
    '{"type":"status","ok":true,"state":"running","step":9,"steps":48}',
  );
  assert.equal(message.type, "status");
  assert.equal(message.state, "running");
  assert.equal(message.step, 9);
});

test("handles compatibility responses and malformed input", () => {
  assert.deepEqual(parseDeviceLine("PONG\r"), { type: "pong", ok: true });
  assert.deepEqual(parseDeviceLine("OK"), { type: "ack", ok: true });
  assert.equal(parseDeviceLine("ERR").ok, false);
  assert.equal(parseDeviceLine("{broken").type, "unknown");
  assert.equal(parseDeviceLine(""), null);
});

test("formats the complete embedded cycle", () => {
  assert.equal(formatDuration(63595), "01:03.595");
});

test("mock transport follows HELLO, START, STATUS and STOP", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("HELLO");
  await transport.send("START");
  await transport.send("STATUS");
  await transport.send("STOP");

  assert.equal(lines[0].type, "info");
  assert.equal(lines[0].state, "idle");
  assert.equal(lines[1].state, "running");
  assert.equal(lines[2].state, "running");
  assert.equal(lines[3].state, "idle");
  assert.equal(lines[3].routine, "material-farm");
});

test("manual raw report preserves the running macro and is acknowledged", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("START");
  await transport.send("R 20 0 128 128 128 128");
  await transport.send("STATUS");

  assert.equal(transport.lastReport, "R 20 0 128 128 128 128");
  assert.deepEqual(lines[1], { type: "ack", ok: true });
  assert.equal(lines[2].state, "running");
});

test("does not stream a macro while the board-timed route is running", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("START");
  await transport.send("MACRO_GET");

  assert.equal(lines.at(-1).type, "error");
  assert.equal(lines.at(-1).message, "macro-running");
});

test("browsing macro settings never stops a running macro", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });

  await transport.connect();
  await transport.send("MACRO_START 2");
  await transport.send("MACRO_LIST");
  assert.equal(lines.at(-1).type, "macro_list");

  // The editor's legacy load command and all write commands are rejected,
  // rather than stopping the macro they would otherwise replace.
  await transport.send("MACRO_LOAD 0");
  assert.equal(lines.at(-1).message, "macro-running");
  await transport.send("MACRO_BEGIN 0 1 0 1");
  assert.equal(lines.at(-1).message, "macro-running");
  await transport.send("STATUS");
  assert.equal(lines.at(-1).state, "running");
  assert.equal(transport.activeSlot, 2);
});

test("waits for every macro upload acknowledgement", async () => {
  const received = [];
  const transport = new MockSerialTransport({
    onLine: () => {},
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });
  const originalSend = transport.send.bind(transport);
  transport.send = async (command) => {
    received.push(command);
    await originalSend(command);
  };

  await transport.connect();
  const commands = buildMacroUploadCommands({
    steps: [{ durationMs: 10, waitMs: 0, buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 }],
    loopGapMs: 0,
    repeat: false,
  }, { slot: 0, name: "Ack test" });
  for (const command of commands.slice(0, -1)) {
    const response = await transport.sendAndWait(command);
    assert.equal(response.type, "ack");
  }
  const committed = await transport.sendAndWait(commands.at(-1), {
    predicate: (message) => message?.type === "macro" || message?.type === "error",
  });

  assert.equal(committed.type, "macro");
  assert.deepEqual(received, commands);
});

test("mock transport saves and reloads a named macro library transaction", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });
  const macro = {
    steps: [
      {
        durationMs: 120,
        waitMs: 0,
        buttons: 4,
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
    loopGapMs: 100,
    repeat: true,
  };

  await transport.connect();
  for (const command of buildMacroUploadCommands(macro, { slot: 2, name: "Test route" })) {
    await transport.send(command);
  }
  await transport.send("MACRO_GET");

  const saved = lines.filter((line) => line.type === "macro").at(-1);
  assert.equal(saved.source, "stored");
  assert.equal(saved.slot, 2);
  assert.equal(saved.name, "Test route");
  assert.equal(saved.steps.length, 2);
  assert.equal(saved.steps[0].left_y, 0);
  assert.equal(saved.loop_gap_ms, 100);

  await transport.send("MACRO_LIST");
  await transport.send("MACRO_LOAD 2");
  const library = lines.filter((line) => line.type === "macro_list").at(-1);
  assert.equal(library.active_slot, 2);
  assert.equal(library.slots[2].name, "Test route");
});

test("mock transport persists and starts a five-entry board task plan", async () => {
  const lines = [];
  const transport = new MockSerialTransport({
    onLine: (line) => lines.push(parseDeviceLine(line)),
    onDisconnect: () => assert.fail("mock should not disconnect"),
  });
  await transport.connect();
  const plan = { name: "素材大循环", repeat: true, entries: [
    { slot: 0, repeatCount: 100, gapMs: 0 },
    { slot: 1, repeatCount: 20, gapMs: 0 },
    { slot: 2, repeatCount: 1, gapMs: 2000 },
  ] };
  for (const command of buildTaskUploadCommands(plan, transport.slots)) {
    await transport.send(command);
  }
  assert.equal(lines.filter((line) => line.type === "task_plan").at(-1).entries.length, 3);
  await transport.send("TASK_START");
  const running = lines.at(-1);
  assert.equal(running.task_active, true);
  assert.equal(running.task_target_iterations, 100);
  assert.equal(running.progress_step, 1);
});
