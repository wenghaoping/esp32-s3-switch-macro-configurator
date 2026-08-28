import { normalizeMacroPayloadV2 } from "./macro-editor.js";
import { MACRO_SLOT_COUNT } from "./slot-config.js";
import { normalizeTaskPlan, validateTaskPlan } from "./task-plan.js";

export const LIBRARY_FORMAT = "splatoon-farmers-library";
export const LIBRARY_VERSION = 2;
export const TASK_TRIGGER_SLOT = MACRO_SLOT_COUNT;
export const TRIGGER_ENTRY_COUNT = 12;
export const SAFE_TRIGGER_PINS = Object.freeze([
  1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21,
]);

const TRIGGER_MAGIC = 0x53465431;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const DEFAULT_TRIGGER_PINS = [1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];

function hashByte(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, FNV_PRIME) >>> 0;
}

function hashUint32(checksum, value) {
  let result = checksum;
  for (let shift = 0; shift < 32; shift += 8) {
    result = hashByte(result, value >>> shift);
  }
  return result;
}

export function defaultTriggerConfig() {
  return {
    stop_pin: 10,
    entries: DEFAULT_TRIGGER_PINS.map((pin, index) => ({
      index,
      pin,
      slot: index,
      enabled: index < 4,
    })),
  };
}

// Pinia exposes nested state as Vue proxies. Read the primitive fields into a
// fresh object instead of passing that proxy to structuredClone(), which would
// throw a DataCloneError and prevent the device route from rendering.
export function cloneTriggerConfig(config) {
  const fallback = defaultTriggerConfig();
  if (!config || !Array.isArray(config.entries)) return fallback;
  return {
    stop_pin: Number(config.stop_pin ?? fallback.stop_pin),
    entries: fallback.entries.map((defaultEntry, index) => {
      const entry = config.entries[index] ?? defaultEntry;
      return {
        index,
        pin: Number(entry.pin ?? defaultEntry.pin),
        slot: Number(entry.slot ?? defaultEntry.slot),
        enabled: entry.enabled === true,
      };
    }),
  };
}

export function triggerConfigChecksum(config) {
  let checksum = hashUint32(FNV_OFFSET, TRIGGER_MAGIC);
  for (const entry of config.entries) {
    checksum = hashByte(checksum, entry.pin);
    checksum = hashByte(checksum, entry.slot);
    checksum = hashByte(checksum, entry.enabled ? 1 : 0);
  }
  return hashByte(checksum, config.stop_pin);
}

export function validateTriggerConfig(config, slots = [], taskPlan = null) {
  const errors = [];
  if (!config || !Array.isArray(config.entries) || config.entries.length !== TRIGGER_ENTRY_COUNT) {
    return [`触发配置必须包含 ${TRIGGER_ENTRY_COUNT} 个条目。`];
  }
  const stopPin = Number(config.stop_pin);
  if (!SAFE_TRIGGER_PINS.includes(stopPin)) {
    errors.push("停止 GPIO 不在安全白名单中。");
  }
  const enabledPins = new Set();
  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    if (Number(entry.index) !== index || !SAFE_TRIGGER_PINS.includes(Number(entry.pin))) {
      errors.push(`触发器 ${index + 1} 的 GPIO 无效。`);
    }
    const target = Number(entry.slot);
    if (!Number.isInteger(target) || target < 0 || target > TASK_TRIGGER_SLOT) {
      errors.push(`触发器 ${index + 1} 的触发目标无效。`);
    }
    if (!entry.enabled) continue;
    const pin = Number(entry.pin);
    if (enabledPins.has(pin)) errors.push(`GPIO${pin} 被重复使用。`);
    if (pin === stopPin) errors.push(`GPIO${pin} 不能同时用于启动和停止。`);
    enabledPins.add(pin);
    if (target === TASK_TRIGGER_SLOT) {
      if (!Array.isArray(taskPlan?.entries) || taskPlan.entries.length === 0) {
        errors.push("请先保存宏循环，才能启用 GPIO 宏循环触发。");
      }
    } else if (slots.length > 0 && !slots[target]?.occupied) {
      errors.push(`槽位 ${target + 1} 为空，不能启用 GPIO 绑定。`);
    }
  }
  return [...new Set(errors)];
}

export function buildTriggerUploadCommands(config, slots = [], taskPlan = null) {
  const normalized = {
    stop_pin: Number(config.stop_pin),
    entries: config.entries.map((entry, index) => ({
      index,
      pin: Number(entry.pin),
      slot: Number(entry.slot),
      enabled: entry.enabled === true,
    })),
  };
  const errors = validateTriggerConfig(normalized, slots, taskPlan);
  if (errors.length > 0) throw new Error(errors[0]);
  return [
    `TRIGGER_BEGIN ${TRIGGER_ENTRY_COUNT}`,
    ...normalized.entries.map((entry) =>
      `TRIGGER_ENTRY ${entry.index} ${entry.enabled ? 1 : 0} ${entry.pin} ${entry.slot}`),
    `TRIGGER_STOP_PIN ${normalized.stop_pin}`,
    `TRIGGER_COMMIT ${triggerConfigChecksum(normalized)}`,
  ];
}

function normalizeLibraryTriggers(value) {
  const result = defaultTriggerConfig();
  if (!value || !Array.isArray(value.entries)) {
    throw new Error("脚本库 JSON 缺少 triggers.entries。");
  }
  result.entries = DEFAULT_TRIGGER_PINS.map((pin, index) => ({
    index,
    pin,
    slot: index,
    enabled: false,
  }));
  value.entries.forEach((entry, index) => {
    const action = entry.action ?? entry.target;
    const slot = action === "task" ? TASK_TRIGGER_SLOT : Number(entry.slot) - 1;
    const entryIndex = Number.isInteger(Number(entry.index)) ? Number(entry.index) :
      (slot < TRIGGER_ENTRY_COUNT ? slot : index);
    if (!Number.isInteger(slot) || slot < 0 || slot > TASK_TRIGGER_SLOT ||
        !Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= TRIGGER_ENTRY_COUNT) {
      throw new Error(`triggers.entries[${index}] 的目标无效。`);
    }
    result.entries[entryIndex] = {
      index: entryIndex,
      pin: Number(entry.pin),
      slot,
      enabled: entry.enabled === true,
    };
  });
  result.stop_pin = Number(value.stopPin ?? value.stop_pin);
  return result;
}

export function normalizeLibraryDocument(documentData) {
  if (documentData?.format !== LIBRARY_FORMAT || documentData?.version !== LIBRARY_VERSION) {
    throw new Error("只支持 Splatoon Farmers 2.0 配置备份，旧格式不再兼容。");
  }
  if ("plan" in documentData || documentData.slots?.some((entry) => "plan" in entry)) {
    throw new Error("备份包含已停用的步骤分段，不能导入。");
  }
  if (!Array.isArray(documentData.slots)) {
    throw new Error("脚本库 JSON 缺少 slots 数组。");
  }
  const seen = new Set();
  const slots = documentData.slots.map((entry, index) => {
    const slot = Number(entry.slot) - 1;
    if (!Number.isInteger(slot) || slot < 0 || slot >= MACRO_SLOT_COUNT || seen.has(slot)) {
      throw new Error(`slots[${index}].slot 无效或重复。`);
    }
    seen.add(slot);
    if (!["builtin", "stored", "empty"].includes(entry.source)) {
      throw new Error(`槽位 ${slot + 1} 的 source 只能是 builtin、stored 或 empty。`);
    }
    if (entry.source === "empty") return { slot, source: "empty", name: `槽位 ${slot + 1}` };
    const name = String(entry.name || `Macro ${slot + 1}`).trim();
    if (!name || new TextEncoder().encode(name).length > 32) {
      throw new Error(`槽位 ${slot + 1} 的名称为空或超过 32 字节。`);
    }
    if (entry.source === "builtin") return { slot, source: "builtin", name };
    let macro;
    try {
      macro = normalizeMacroPayloadV2(entry.macro);
    } catch (error) {
      throw new Error(`槽位 ${slot + 1}: ${error.message}`);
    }
    return { slot, source: "stored", name, macro };
  });
  if (seen.size !== 8 && seen.size !== MACRO_SLOT_COUNT) throw new Error(`配置备份必须包含 8 或 ${MACRO_SLOT_COUNT} 个槽位。`);
  while (slots.length < MACRO_SLOT_COUNT) {
    const slot = slots.length;
    slots.push({ slot, source: "empty", name: `槽位 ${slot + 1}` });
  }
  slots.sort((left, right) => left.slot - right.slot);
  const triggers = normalizeLibraryTriggers(documentData.triggers);
  const occupied = Array.from({ length: MACRO_SLOT_COUNT }, () => ({ occupied: false }));
  slots.forEach((entry) => { occupied[entry.slot] = { occupied: entry.source !== "empty", name: entry.name, slot: entry.slot }; });
  const taskPlan = documentData.taskPlan == null ? null : normalizeTaskPlan(documentData.taskPlan);
  if (taskPlan) {
    const taskErrors = validateTaskPlan(taskPlan, occupied);
    if (taskErrors.length > 0) throw new Error(taskErrors[0]);
  }
  const triggerErrors = validateTriggerConfig(triggers, occupied, taskPlan);
  if (triggerErrors.length > 0) throw new Error(triggerErrors[0]);
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, slots, triggers, taskPlan };
}

export function serializeTriggerConfig(config) {
  return {
    entries: config.entries.filter((entry) => entry.enabled).map((entry) => ({
      name: entry.slot === TASK_TRIGGER_SLOT ? "宏循环触发" : `槽位 ${entry.slot + 1} 触发`,
      index: entry.index,
      pin: entry.pin,
      ...(entry.slot === TASK_TRIGGER_SLOT ? { action: "task" } : { slot: entry.slot + 1 }),
      enabled: true,
    })),
    stopPin: config.stop_pin,
  };
}
