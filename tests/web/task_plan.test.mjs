import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskUploadCommands, describeTaskPlan, normalizeTaskPlan, taskPlanChecksum, validateTaskPlan } from "../../web/src/utils/task-plan.js";

const slots = Array.from({ length: 12 }, (_, slot) => ({ slot, occupied: slot < 3, name: `宏${slot + 1}` }));
const plan = { name: "素材大循环", repeat: true, entries: [
  { slot: 0, repeatCount: 100, gapMs: 0 },
  { slot: 1, repeatCount: 20, gapMs: 0 },
  { slot: 2, repeatCount: 1, gapMs: 2000 },
] };

test("builds a transactional five-entry board task upload", () => {
  const commands = buildTaskUploadCommands(plan, slots);
  assert.equal(commands[0], "TASK_BEGIN 5");
  assert.equal(commands[1], "TASK_META %E7%B4%A0%E6%9D%90%E5%A4%A7%E5%BE%AA%E7%8E%AF 3 1");
  assert.equal(commands[2], "TASK_ENTRY 0 0 100 0");
  assert.equal(commands[4], "TASK_ENTRY 2 2 1 2000");
  assert.equal(commands.at(-1), `TASK_COMMIT ${taskPlanChecksum(plan)}`);
});

test("allows duplicate slots, rejects empty slots and more than five entries", () => {
  assert.deepEqual(validateTaskPlan({ ...plan, entries: [...plan.entries, { slot: 0, repeatCount: 1, gapMs: 0 }] }, slots), []);
  assert.match(validateTaskPlan({ ...plan, entries: [{ slot: 11, repeatCount: 1, gapMs: 0 }] }, slots)[0], /空/);
  assert.match(validateTaskPlan({ ...plan, entries: Array.from({ length: 6 }, () => plan.entries[0]) }, slots)[0], /最多/);
});

test("normalizes firmware snake case and describes the large loop in Chinese", () => {
  const normalized = normalizeTaskPlan({ name: plan.name, repeat: true, entries: [{ slot: 0, repeat_count: 100, gap_ms: 0 }] });
  assert.equal(normalized.entries[0].repeatCount, 100);
  assert.match(describeTaskPlan(plan, slots), /宏1运行 100 次.*宏2运行 20 次.*从头大循环/);
});
