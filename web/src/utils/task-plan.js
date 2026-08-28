export const MAX_TASK_ENTRIES = 5;
export const MAX_TASK_REPEAT_COUNT = 10000;
export const MAX_TASK_GAP_MS = 600000;
export const MAX_TASK_NAME_BYTES = 32;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function hashByte(hash, value) {
  return Math.imul((hash ^ (value & 0xff)) >>> 0, FNV_PRIME) >>> 0;
}

function hashUint16(hash, value) {
  let next = hashByte(hash, value);
  return hashByte(next, value >>> 8);
}

function hashUint32(hash, value) {
  let next = hashByte(hash, value);
  next = hashByte(next, value >>> 8);
  next = hashByte(next, value >>> 16);
  return hashByte(next, value >>> 24);
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function normalizeTaskPlan(plan = {}) {
  return {
    name: String(plan.name ?? "").trim(),
    repeat: plan.repeat !== false,
    entries: Array.isArray(plan.entries)
      ? plan.entries.map((entry) => ({
          slot: integer(entry.slot),
          repeatCount: integer(entry.repeatCount ?? entry.repeat_count, 1),
          gapMs: integer(entry.gapMs ?? entry.gap_ms, 0),
        }))
      : [],
  };
}

export function createDefaultTaskPlan(slots = []) {
  const first = slots.find((slot) => slot?.occupied && slot.confirmed !== false);
  return {
    name: "素材循环方案",
    repeat: true,
    entries: first ? [{ slot: first.slot, repeatCount: 100, gapMs: 0 }] : [],
  };
}

export function validateTaskPlan(plan, slots = []) {
  const normalized = normalizeTaskPlan(plan);
  const errors = [];
  const nameBytes = new TextEncoder().encode(normalized.name).length;
  if (!normalized.name) errors.push("请输入任务方案名称。");
  if (nameBytes > MAX_TASK_NAME_BYTES) errors.push("方案名称最多 32 个 UTF-8 字节。");
  if (normalized.entries.length < 1) errors.push("请至少添加一个脚本任务。");
  if (normalized.entries.length > MAX_TASK_ENTRIES) errors.push("任务方案最多包含 5 个脚本。");
  normalized.entries.forEach((entry, index) => {
    const label = `第 ${index + 1} 项`;
    if (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot > 7 || !slots[entry.slot]?.occupied || slots[entry.slot]?.confirmed === false) {
      errors.push(`${label}引用的脚本槽位为空。`);
    }
    if (entry.repeatCount < 1 || entry.repeatCount > MAX_TASK_REPEAT_COUNT) {
      errors.push(`${label}运行次数必须是 1～10000。`);
    }
    if (entry.gapMs < 0 || entry.gapMs > MAX_TASK_GAP_MS) {
      errors.push(`${label}完成后等待必须是 0～600000 毫秒。`);
    }
  });
  return errors;
}

export function taskPlanChecksum(plan) {
  const normalized = normalizeTaskPlan(plan);
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(normalized.name)) hash = hashByte(hash, byte);
  hash = hashByte(hash, 0);
  hash = hashByte(hash, normalized.entries.length);
  hash = hashByte(hash, normalized.repeat ? 1 : 0);
  normalized.entries.forEach((entry) => {
    hash = hashByte(hash, entry.slot);
    hash = hashUint16(hash, entry.repeatCount);
    hash = hashUint32(hash, entry.gapMs);
  });
  return hash >>> 0;
}

export function buildTaskUploadCommands(plan, slots) {
  const normalized = normalizeTaskPlan(plan);
  const errors = validateTaskPlan(normalized, slots);
  if (errors.length) throw new Error(errors[0]);
  const commands = [
    `TASK_BEGIN ${MAX_TASK_ENTRIES}`,
    `TASK_META ${encodeURIComponent(normalized.name)} ${normalized.entries.length} ${normalized.repeat ? 1 : 0}`,
  ];
  normalized.entries.forEach((entry, index) => {
    commands.push(`TASK_ENTRY ${index} ${entry.slot} ${entry.repeatCount} ${entry.gapMs}`);
  });
  commands.push(`TASK_COMMIT ${taskPlanChecksum(normalized)}`);
  return commands;
}

export function describeTaskPlan(plan, slots = []) {
  const normalized = normalizeTaskPlan(plan);
  const sequence = normalized.entries.map((entry) => {
    const name = slots[entry.slot]?.name || `槽位 ${entry.slot + 1}`;
    const wait = entry.gapMs ? `，等待 ${entry.gapMs / 1000} 秒` : "";
    return `${name}运行 ${entry.repeatCount} 次${wait}`;
  }).join(" → ");
  if (!sequence) return "尚未添加脚本。";
  return `${sequence}${normalized.repeat ? " → 完成后从头大循环" : " → 完成后停止"}`;
}
