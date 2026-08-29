import { normalizeMacro } from "./macro-editor.js";

export const DEFAULT_AXIS_QUANTUM = 8;
export const DEFAULT_AXIS_CHANGE_THRESHOLD = 12;
export const DEFAULT_DIRECTION_THRESHOLD = 12;

const AXIS_FIELDS = Object.freeze([
  "leftX",
  "leftY",
  "rightX",
  "rightY",
]);

function clampAxis(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

export function quantizeAxis(value, quantum = DEFAULT_AXIS_QUANTUM) {
  const axis = clampAxis(value);
  const size = Math.max(1, Math.round(Number(quantum) || DEFAULT_AXIS_QUANTUM));
  if (axis <= 0 || axis >= 255 || axis === 128) {
    return axis;
  }
  return clampAxis(128 + Math.round((axis - 128) / size) * size);
}

export function quantizeMacroStep(step, quantum = DEFAULT_AXIS_QUANTUM) {
  const normalized = normalizeMacro({ steps: [step] }).steps[0];
  return {
    ...normalized,
    ...Object.fromEntries(
      AXIS_FIELDS.map((field) => [field, quantizeAxis(normalized[field], quantum)]),
    ),
  };
}

function sameDigitalInput(left, right) {
  return left.buttons === right.buttons && left.dpad === right.dpad;
}

function axisDistance(left, right) {
  return Math.max(...AXIS_FIELDS.map((field) => Math.abs(left[field] - right[field])));
}

function directionSign(value, threshold) {
  if (value <= 128 - threshold) return -1;
  if (value >= 128 + threshold) return 1;
  return 0;
}

function directionAxisValue(sign) {
  return sign < 0 ? 0 : sign > 0 ? 255 : 128;
}

function directionStep(step, threshold) {
  return {
    ...step,
    leftX: directionAxisValue(directionSign(step.leftX, threshold)),
    leftY: directionAxisValue(directionSign(step.leftY, threshold)),
    rightX: directionAxisValue(directionSign(step.rightX, threshold)),
    rightY: directionAxisValue(directionSign(step.rightY, threshold)),
  };
}

function rightStickDirectionStep(step, threshold) {
  const horizontal = directionSign(step.rightX, threshold);
  const vertical = directionSign(step.rightY, threshold);
  const horizontalDistance = Math.abs(step.rightX - 128);
  const verticalDistance = Math.abs(step.rightY - 128);

  if (horizontalDistance < threshold && verticalDistance < threshold) {
    return { ...step, rightX: 128, rightY: 128 };
  }

  if (horizontalDistance >= verticalDistance) {
    return { ...step, rightX: directionAxisValue(horizontal), rightY: 128 };
  }

  return { ...step, rightX: 128, rightY: directionAxisValue(vertical) };
}

function sameDirection(left, right) {
  return AXIS_FIELDS.every((field) => left[field] === right[field]);
}

/**
 * Reduce noise from analog recordings while preserving all digital transitions
 * and every explicit wait boundary. Durations are accumulated, so the total
 * playback time remains unchanged.
 */
export function optimizeMacroSteps(
  steps,
  {
    axisQuantum = DEFAULT_AXIS_QUANTUM,
    axisChangeThreshold = DEFAULT_AXIS_CHANGE_THRESHOLD,
  } = {},
) {
  const normalizedSteps = normalizeMacro({ steps }).steps;
  const threshold = Math.max(0, Math.round(Number(axisChangeThreshold) || 0));
  const optimized = [];

  for (const sourceStep of normalizedSteps) {
    const step = quantizeMacroStep(sourceStep, axisQuantum);
    const previous = optimized.at(-1);
    const canMerge =
      previous &&
      previous.waitMs === 0 &&
      step.waitMs === 0 &&
      sameDigitalInput(previous, step) &&
      axisDistance(previous, step) <= threshold;

    if (canMerge) {
      previous.durationMs += step.durationMs;
    } else {
      optimized.push(step);
    }
  }

  return optimized;
}

/**
 * 将右摇杆转换成固定力度的单轴方向。
 *
 * 右摇杆是视角控制时，原始模拟量容易产生右上、左下等斜向误差。
 * 这里先判断横向和纵向偏移量，再只保留偏移更大的一个轴：
 * - 横向更大：只输出左/右；
 * - 纵向更大：只输出上/下；
 * - 两者相等：按约定优先横向；
 * - 两个轴都在死区内：输出中立。
 */
export function normalizeRightStickPulseStep(
  step,
  { directionThreshold = DEFAULT_DIRECTION_THRESHOLD } = {},
) {
  const normalized = quantizeMacroStep(step);
  const threshold = Math.max(0, Math.round(Number(directionThreshold) || 0));
  return rightStickDirectionStep(normalized, threshold);
}

/**
 * 将摇杆的连续模拟量轨迹归纳为固定方向。
 *
 * 例如左摇杆从 144,80 逐渐移动到 255,0，都会归纳成右上方向 255,0；
 * 只要方向、按钮和十字键没有变化，就合并为一个连续保持动作。
 * 这是比 optimizeMacroSteps 更激进的模式，适合需要“持续推住摇杆”的宏。
 */
export function summarizeMacroDirections(
  steps,
  { directionThreshold = DEFAULT_DIRECTION_THRESHOLD } = {},
) {
  const normalizedSteps = normalizeMacro({ steps }).steps;
  const threshold = Math.max(0, Math.round(Number(directionThreshold) || 0));
  const summarized = [];

  for (const sourceStep of normalizedSteps) {
    const step = directionStep(sourceStep, threshold);
    const previous = summarized.at(-1);
    const canMerge =
      previous &&
      previous.waitMs === 0 &&
      step.waitMs === 0 &&
      sameDigitalInput(previous, step) &&
      sameDirection(previous, step);

    if (canMerge) {
      previous.durationMs += step.durationMs;
    } else {
      summarized.push(step);
    }
  }

  return summarized;
}
