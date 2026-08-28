import { describeControls, formatMs } from "./action-description.js";

export function createInputProbe() {
  return { controls: [], signature: "", active: false, stopped: false, pressedAt: 0, releasedAt: 0, holdMs: 0, releaseMs: 0 };
}

export function updateInputProbe(probe, controls, nowMs) {
  const normalized = [...new Set(controls)].sort();
  const signature = normalized.join("|");
  if (normalized.length > 0) {
    if (!probe.active || signature !== probe.signature) {
      return { controls: normalized, signature, active: true, stopped: false, pressedAt: nowMs, releasedAt: 0, holdMs: 0, releaseMs: 0 };
    }
    return probe;
  }
  if (probe.active) {
    return { ...probe, active: false, releasedAt: nowMs, holdMs: Math.max(0, nowMs - probe.pressedAt) };
  }
  return probe;
}

export function stopInputProbe(probe, nowMs) {
  if (!probe.signature || probe.stopped) return probe;
  if (probe.active) {
    return { ...probe, active: false, stopped: true, holdMs: Math.max(0, nowMs - probe.pressedAt), releasedAt: nowMs, releaseMs: 0 };
  }
  return { ...probe, stopped: true, releaseMs: Math.max(0, nowMs - probe.releasedAt) };
}

export function describeInputProbe(probe, nowMs) {
  if (!probe.signature) {
    return { title: "等待按键测试", timing: "不用开始录制，直接按下手柄图中的按键" };
  }
  const holdMs = probe.active ? Math.max(0, nowMs - probe.pressedAt) : probe.holdMs;
  const releaseMs = probe.stopped ? probe.releaseMs : Math.max(0, nowMs - probe.releasedAt);
  return {
    title: describeControls(probe.controls),
    timing: probe.active
      ? `正在按住 · ${formatMs(Math.round(holdMs))}`
      : `共按住 ${formatMs(Math.round(holdMs))} · 松开 ${formatMs(Math.round(releaseMs))}${probe.stopped ? " · 计时已停止" : ""}`,
  };
}
