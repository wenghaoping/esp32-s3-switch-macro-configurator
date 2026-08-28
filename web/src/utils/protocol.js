export const DEVICE_BAUD_RATE = 115200;

export function parseDeviceLine(rawLine) {
  const line = rawLine.trim();
  if (!line) {
    return null;
  }
  if (line === "PONG") {
    return { type: "pong", ok: true };
  }
  if (line === "OK") {
    return { type: "ack", ok: true };
  }
  if (line === "ERR") {
    return { type: "error", ok: false, message: "设备拒绝了这条指令" };
  }
  if (!line.startsWith("{")) {
    return { type: "unknown", ok: false, raw: line };
  }

  try {
    const message = JSON.parse(line);
    if (
      typeof message !== "object" ||
      message === null ||
      typeof message.type !== "string"
    ) {
      return { type: "unknown", ok: false, raw: line };
    }
    return message;
  } catch {
    return { type: "unknown", ok: false, raw: line };
  }
}

export function formatDuration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(millis).padStart(3, "0")}`;
}
