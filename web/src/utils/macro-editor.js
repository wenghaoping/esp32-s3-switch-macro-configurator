import { BUTTON_BITS } from "./manual-input.js";
import { MACRO_SLOT_COUNT } from "./slot-config.js";

export const MAX_MACRO_STEPS = 512;
export const MAX_MACRO_NAME_BYTES = 32;
export const MACRO_DOCUMENT_FORMAT = "splatoon-farmers-macro";
export const MACRO_DOCUMENT_VERSION = 2;
export const MIN_STEP_DURATION_MS = 10;
export const MAX_STEP_DURATION_MS = 600000;
export const MAX_LOOP_GAP_MS = 600000;

export const BUTTON_OPTIONS = Object.freeze(
  Object.entries(BUTTON_BITS).map(([name, bit]) => ({ name, bit })),
);

export const DPAD_OPTIONS = Object.freeze([
  { value: 15, label: "Neutral" },
  { value: 0, label: "Up" },
  { value: 1, label: "Up-right" },
  { value: 2, label: "Right" },
  { value: 3, label: "Down-right" },
  { value: 4, label: "Down" },
  { value: 5, label: "Down-left" },
  { value: 6, label: "Left" },
  { value: 7, label: "Up-left" },
]);

export const STICK_OPTIONS = Object.freeze([
  { value: "center", label: "Center", x: 128, y: 128 },
  { value: "up", label: "Up", x: 128, y: 0 },
  { value: "up-right", label: "Up-right", x: 255, y: 0 },
  { value: "right", label: "Right", x: 255, y: 128 },
  { value: "down-right", label: "Down-right", x: 255, y: 255 },
  { value: "down", label: "Down", x: 128, y: 255 },
  { value: "down-left", label: "Down-left", x: 0, y: 255 },
  { value: "left", label: "Left", x: 0, y: 128 },
  { value: "up-left", label: "Up-left", x: 0, y: 0 },
]);

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function asInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeStep(step = {}) {
  return {
    durationMs: asInteger(step.durationMs ?? step.duration_ms, 100),
    waitMs: asInteger(step.waitMs ?? step.wait_ms, 0),
    buttons: asInteger(step.buttons, 0),
    dpad: asInteger(step.dpad, 15),
    leftX: asInteger(step.leftX ?? step.left_x, 128),
    leftY: asInteger(step.leftY ?? step.left_y, 128),
    rightX: asInteger(step.rightX ?? step.right_x, 128),
    rightY: asInteger(step.rightY ?? step.right_y, 128),
  };
}

export function createBlankStep() {
  return normalizeStep();
}

export function normalizeMacro(macro = {}) {
  const sourceSteps = Array.isArray(macro.steps) ? macro.steps : [];
  return {
    steps: sourceSteps.map(normalizeStep),
    loopGapMs: asInteger(macro.loopGapMs ?? macro.loop_gap_ms, 0),
    repeat: Boolean(macro.repeat),
  };
}

export function cloneMacro(macro) {
  return normalizeMacro(macro);
}

function normalizedSelectedIndexes(indexes, length) {
  return [...new Set(indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
    .sort((left, right) => left - right);
}

export function copySelectedSteps(steps, selectedIndexes) {
  const normalizedSteps = normalizeMacro({ steps }).steps;
  const selected = normalizedSelectedIndexes(selectedIndexes, normalizedSteps.length);
  if (selected.length === 0 || normalizedSteps.length + selected.length > MAX_MACRO_STEPS) {
    return null;
  }
  const copies = selected.map((index) => normalizeStep(normalizedSteps[index]));
  const insertAt = selected.at(-1) + 1;
  return {
    steps: [
      ...normalizedSteps.slice(0, insertAt),
      ...copies,
      ...normalizedSteps.slice(insertAt),
    ],
    selectedIndexes: copies.map((_, index) => insertAt + index),
  };
}

export function deleteSelectedSteps(steps, selectedIndexes) {
  const normalizedSteps = normalizeMacro({ steps }).steps;
  const selected = normalizedSelectedIndexes(selectedIndexes, normalizedSteps.length);
  if (selected.length === 0 || selected.length === normalizedSteps.length) {
    return null;
  }
  const selectedSet = new Set(selected);
  return {
    steps: normalizedSteps.filter((_, index) => !selectedSet.has(index)),
    selectedIndexes: [],
  };
}

export function moveSelectedSteps(steps, selectedIndexes, targetIndex, insertAfter = false) {
  const normalizedSteps = normalizeMacro({ steps }).steps;
  const selected = normalizedSelectedIndexes(selectedIndexes, normalizedSteps.length);
  if (
    selected.length === 0 ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= normalizedSteps.length ||
    selected.includes(targetIndex)
  ) {
    return null;
  }

  const selectedSet = new Set(selected);
  const moving = selected.map((index) => normalizedSteps[index]);
  const remaining = normalizedSteps.filter((_, index) => !selectedSet.has(index));
  const originalInsertionIndex = targetIndex + (insertAfter ? 1 : 0);
  const insertionIndex = normalizedSteps
    .slice(0, originalInsertionIndex)
    .filter((_, index) => !selectedSet.has(index)).length;
  remaining.splice(insertionIndex, 0, ...moving);
  return {
    steps: remaining,
    selectedIndexes: moving.map((_, index) => insertionIndex + index),
  };
}

export function macroDurationMs(macro) {
  return normalizeMacro(macro).steps.reduce(
    (total, step) => total + step.durationMs + step.waitMs,
    0,
  );
}

export function macroCycleMs(macro) {
  const normalized = normalizeMacro(macro);
  return macroDurationMs(normalized) + normalized.loopGapMs;
}

export function validateMacro(macro) {
  const normalized = normalizeMacro(macro);
  const errors = [];
  if (normalized.steps.length === 0) {
    errors.push("Add at least one step.");
  }
  if (normalized.steps.length > MAX_MACRO_STEPS) {
    errors.push(`A macro can contain at most ${MAX_MACRO_STEPS} steps.`);
  }
  if (
    normalized.loopGapMs < 0 ||
    normalized.loopGapMs > MAX_LOOP_GAP_MS
  ) {
    errors.push(`Loop gap must be between 0 and ${MAX_LOOP_GAP_MS} ms.`);
  }

  normalized.steps.forEach((step, index) => {
    if (
      step.durationMs < MIN_STEP_DURATION_MS ||
      step.durationMs > MAX_STEP_DURATION_MS
    ) {
      errors.push(
        `Step ${index + 1} duration must be ${MIN_STEP_DURATION_MS}-${MAX_STEP_DURATION_MS} ms.`,
      );
    }
    if (step.waitMs < 0 || step.waitMs > MAX_LOOP_GAP_MS) {
      errors.push(`Step ${index + 1} wait must be 0-${MAX_LOOP_GAP_MS} ms.`);
    }
    if (step.buttons < 0 || step.buttons > 0x3fff) {
      errors.push(`Step ${index + 1} contains an invalid button mask.`);
    }
    if (!DPAD_OPTIONS.some((option) => option.value === step.dpad)) {
      errors.push(`Step ${index + 1} contains an invalid D-pad direction.`);
    }
    for (const axis of [step.leftX, step.leftY, step.rightX, step.rightY]) {
      if (axis < 0 || axis > 255) {
        errors.push(`Step ${index + 1} contains an invalid stick position.`);
        break;
      }
    }
  });
  return errors;
}

function hashByte(hash, value) {
  return Math.imul((hash ^ (value & 0xff)) >>> 0, FNV_PRIME) >>> 0;
}

function hashUint16(hash, value) {
  let next = hashByte(hash, value);
  next = hashByte(next, value >>> 8);
  return next;
}

function hashUint32(hash, value) {
  let next = hashByte(hash, value);
  next = hashByte(next, value >>> 8);
  next = hashByte(next, value >>> 16);
  next = hashByte(next, value >>> 24);
  return next;
}

export function macroChecksum(macro) {
  const normalized = normalizeMacro(macro);
  let hash = FNV_OFFSET;
  hash = hashUint16(hash, normalized.steps.length);
  hash = hashUint32(hash, normalized.loopGapMs);
  hash = hashByte(hash, normalized.repeat ? 1 : 0);
  for (const step of normalized.steps) {
    hash = hashUint32(hash, step.durationMs);
    hash = hashUint32(hash, step.waitMs);
    hash = hashUint16(hash, step.buttons);
    hash = hashByte(hash, step.dpad);
    hash = hashByte(hash, step.leftX);
    hash = hashByte(hash, step.leftY);
    hash = hashByte(hash, step.rightX);
    hash = hashByte(hash, step.rightY);
  }
  return hash >>> 0;
}

export function normalizeMacroName(name, fallback = "Macro 1") {
  const normalized = String(name ?? "").trim() || fallback;
  if (new TextEncoder().encode(normalized).length > MAX_MACRO_NAME_BYTES) {
    throw new Error(`Macro name can contain at most ${MAX_MACRO_NAME_BYTES} UTF-8 bytes.`);
  }
  return normalized;
}

export function serializeMacroDocument(name, macro) {
  const normalizedName = normalizeMacroName(name, "");
  if (!normalizedName) throw new Error("请输入宏名称。");
  const normalized = normalizeMacro(macro);
  const errors = validateMacro(normalized);
  if (errors.length > 0) throw new Error(errors[0]);
  return {
    format: MACRO_DOCUMENT_FORMAT,
    version: MACRO_DOCUMENT_VERSION,
    name: normalizedName,
    macro: {
      steps: normalized.steps,
      loopGapMs: normalized.loopGapMs,
    },
  };
}

export function normalizeMacroPayloadV2(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("脚本 JSON 的 macro 必须是对象。");
  }
  const macroKeys = Object.keys(payload).sort();
  if (macroKeys.join(",") !== "loopGapMs,steps") {
    throw new Error("macro 只允许包含 steps 和 loopGapMs 两个 2.0 字段。");
  }
  if (!Number.isInteger(payload.loopGapMs) || !Array.isArray(payload.steps)) {
    throw new Error("脚本 JSON 的 steps 或 loopGapMs 类型无效。");
  }
  const requiredStepKeys = [
    "buttons", "dpad", "durationMs", "leftX", "leftY", "rightX", "rightY", "waitMs",
  ];
  payload.steps.forEach((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step) ||
        Object.keys(step).sort().join(",") !== requiredStepKeys.join(",") ||
        requiredStepKeys.some((key) => !Number.isInteger(step[key]))) {
      throw new Error(`动作 ${index + 1} 必须完整使用 2.0 字段。`);
    }
  });
  const macro = normalizeMacro({ ...payload, repeat: true });
  const errors = validateMacro(macro);
  if (errors.length > 0) throw new Error(errors[0]);
  return macro;
}

export function normalizeMacroDocument(documentData) {
  if (
    documentData?.format !== MACRO_DOCUMENT_FORMAT ||
    documentData?.version !== MACRO_DOCUMENT_VERSION
  ) {
    throw new Error("只支持 Splatoon Farmers 2.0 脚本 JSON，旧格式不再兼容。");
  }
  if ("plan" in documentData || documentData?.macro?.plan) {
    throw new Error("此文件包含已停用的步骤分段，不能导入。");
  }
  if (!documentData.macro || typeof documentData.macro !== "object") {
    throw new Error("脚本 JSON 缺少 macro 对象。");
  }
  const name = normalizeMacroName(documentData.name, "");
  if (!name) throw new Error("脚本 JSON 缺少名称。");
  const macro = normalizeMacroPayloadV2(documentData.macro);
  return { format: MACRO_DOCUMENT_FORMAT, version: MACRO_DOCUMENT_VERSION, name, macro };
}

export function buildMacroUploadCommands(macro, { slot = 0, name = "Macro 1" } = {}) {
  const normalized = normalizeMacro(macro);
  const errors = validateMacro(normalized);
  if (errors.length > 0) {
    throw new Error(errors[0]);
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= MACRO_SLOT_COUNT) {
    throw new Error(`Macro slot must be between 1 and ${MACRO_SLOT_COUNT}.`);
  }
  const normalizedName = normalizeMacroName(name);

  const commands = [
    `MACRO_BEGIN ${slot} ${normalized.steps.length} ${normalized.loopGapMs} ${normalized.repeat ? 1 : 0}`,
    `MACRO_NAME ${encodeURIComponent(normalizedName)}`,
  ];
  normalized.steps.forEach((step, index) => {
    commands.push(
      `MACRO_STEP ${index} ${step.durationMs} ${step.waitMs} ${step.buttons} ${step.dpad} ${step.leftX} ${step.leftY} ${step.rightX} ${step.rightY}`,
    );
  });
  commands.push(`MACRO_COMMIT ${macroChecksum(normalized)}`);
  return commands;
}

export function stickOptionForAxes(x, y) {
  return (
    STICK_OPTIONS.find((option) => option.x === x && option.y === y) ??
    STICK_OPTIONS[0]
  );
}

export function axesForStickOption(value) {
  const option = STICK_OPTIONS.find((candidate) => candidate.value === value);
  return option ? { x: option.x, y: option.y } : { x: 128, y: 128 };
}

export function buttonEnabled(step, buttonName) {
  const option = BUTTON_OPTIONS.find((candidate) => candidate.name === buttonName);
  return option ? (step.buttons & (1 << option.bit)) !== 0 : false;
}

export function setButtonEnabled(step, buttonName, enabled) {
  const option = BUTTON_OPTIONS.find((candidate) => candidate.name === buttonName);
  if (!option) {
    return normalizeStep(step);
  }
  const next = normalizeStep(step);
  next.buttons = enabled
    ? next.buttons | (1 << option.bit)
    : next.buttons & ~(1 << option.bit);
  return next;
}
