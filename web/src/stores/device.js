import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { parseDeviceLine } from "../utils/protocol.js";
import { MockSerialTransport, SerialTransport } from "../utils/serial-transport.js";
import { buildMacroUploadCommands, normalizeMacro } from "../utils/macro-editor.js";
import { BUILTIN_MACROS } from "../utils/builtin-macros.js";
import { buildTaskUploadCommands, normalizeTaskPlan } from "../utils/task-plan.js";
import { buildManualReport } from "../utils/manual-input.js";
import { buildTriggerUploadCommands } from "../utils/library-manager.js";
import { MACRO_SLOT_COUNT } from "../utils/slot-config.js";

const expectedBuiltins = BUILTIN_MACROS.map(({ name, macro }) => ({
  name,
  steps: macro.steps.length,
  duration_ms: macro.steps.reduce((total, step) => total + step.durationMs + step.waitMs, 0),
  loop_gap_ms: macro.loopGapMs,
}));
const emptySlot = (slot) => ({ slot, occupied: false, source: "empty", name: `槽位 ${slot + 1}`, confirmed: false });
const initialSlot = (slot) => expectedBuiltins[slot]
  ? { ...emptySlot(slot), ...expectedBuiltins[slot], occupied: true, source: "builtin", has_builtin: true, has_stored: false, confirmed: false }
  : emptySlot(slot);

export const useDeviceStore = defineStore("device", () => {
  const transport = shallowRef(null);
  const connected = ref(false);
  const ready = ref(false);
  const connecting = ref(false);
  const error = ref("");
  const notification = ref(null);
  const status = ref({ state: "idle", name: "", source: "empty", step: 0, steps: 0 });
  const slots = ref(Array.from({ length: MACRO_SLOT_COUNT }, (_, slot) => initialSlot(slot)));
  const taskPlan = ref(null);
  const triggerConfig = ref(null);
  let pollTimer = null;
  let notificationTimer = null;
  let handshakeActive = false;

  const running = computed(() => status.value.state === "running" || Boolean(status.value.task_active));
  const activeName = computed(() => status.value.running_name || status.value.name || "暂无宏");
  const isStatusActive = () => status.value.state === "running" || Boolean(status.value.task_active);

  function notify(message, tone = "success") {
    clearTimeout(notificationTimer);
    notification.value = { message, tone };
    notificationTimer = window.setTimeout(() => { notification.value = null; }, 3600);
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function startPolling(initialDelay) {
    stopPolling();
    // Firmware pushes every important state transition by itself. Poll only
    // while something is running so an idle board produces no UART traffic.
    if (!connected.value || !isStatusActive()) return;
    const delay = initialDelay ?? 500;
    pollTimer = window.setTimeout(async () => {
      pollTimer = null;
      if (!connected.value || !isStatusActive()) return;
      await send("STATUS").catch(() => {});
      startPolling();
    }, delay);
  }

  function handleLine(rawLine) {
    const message = parseDeviceLine(rawLine);
    if (!message) return;
    if (message.ok === false) {
      if (!handshakeActive) error.value = translateError(message.message);
      return;
    }
    if (message.type === "info" || message.type === "status") {
      status.value = { ...status.value, ...message };
      if (isStatusActive()) {
        if (!pollTimer) startPolling(500);
      } else {
        stopPolling();
      }
    }
    if (message.type === "macro_list") slots.value = message.slots.map((slot, index) => ({ ...emptySlot(index), ...slot, confirmed: true }));
    if (message.type === "task_plan") taskPlan.value = message.available ? normalizeTaskPlan(message) : null;
    if (message.type === "trigger_config") triggerConfig.value = message;
  }

  function handleDisconnect(reason) {
    connected.value = false;
    ready.value = false;
    connecting.value = false;
    stopPolling();
    error.value = reason?.message || "设备连接已断开。";
  }

  function createTransport() {
    if (!transport.value) {
      const Transport = new URLSearchParams(window.location.search).get("mock") === "1"
        ? MockSerialTransport
        : SerialTransport;
      transport.value = new Transport({ onLine: handleLine, onDisconnect: handleDisconnect });
    }
    return transport.value;
  }

  async function connect({ authorizedOnly = false } = {}) {
    if (connected.value || connecting.value) return;
    connecting.value = true;
    ready.value = false;
    error.value = "";
    try {
      const serial = createTransport();
      if (authorizedOnly && navigator.serial?.getPorts) {
        const [port] = await navigator.serial.getPorts();
        if (!port) throw new Error("没有找到已授权设备，请使用“连接设备”。");
        await serial.connectPort(port);
      } else {
        await serial.connect();
      }
      connected.value = true;
      await refreshAll({ retryHandshake: true });
      ready.value = true;
      startPolling();
      notify("设备已连接，状态已同步。");
    } catch (reason) {
      error.value = reason?.message || "无法连接设备。";
      notify(error.value, "error");
    } finally {
      connecting.value = false;
    }
  }

  async function disconnect() {
    stopPolling();
    await transport.value?.disconnect();
    connected.value = false;
    ready.value = false;
    notify("已断开电脑与开发板的串口连接。");
  }

  async function send(command) {
    if (!connected.value || !transport.value) throw new Error("请先连接设备。");
    error.value = "";
    return transport.value.send(command);
  }

  async function sendAndWait(command, predicate, timeoutMs = 8000) {
    if (!connected.value || !transport.value) throw new Error("请先连接设备。");
    let message;
    try {
      message = await transport.value.sendAndWait(command, { predicate, timeoutMs });
    } catch (reason) {
      if (/timed out|timeout/i.test(reason?.message || "")) {
        const errorMessage = `等待设备响应超时（${command.split(" ")[0]}）。请确认已烧录当前固件，并且电脑连接的是上方 USB-UART 接口。`;
        notify(errorMessage, "error");
        throw new Error(errorMessage);
      }
      notify(reason?.message || "设备操作失败。", "error");
      throw reason;
    }
    if (message?.ok === false || message?.type === "error") {
      const translated = translateError(message.message);
      if (message.message === "设备拒绝了这条指令") {
        const errorMessage = `设备拒绝命令 ${command.split(" ")[0]}：${translated}`;
        notify(errorMessage, "error");
        throw new Error(errorMessage);
      }
      notify(translated, "error");
      throw new Error(translated);
    }
    return message;
  }

  async function waitForHello(retryHandshake) {
    const attempts = retryHandshake ? 5 : 1;
    let lastError;
    handshakeActive = true;
    try {
      if (retryHandshake) await new Promise((resolve) => window.setTimeout(resolve, 350));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          // Ignore boot-time ERR lines and wait specifically for the firmware
          // information packet. Opening some USB-UART bridges resets the S3.
          return await sendAndWait("HELLO", (message) => message?.type === "info", retryHandshake ? 1600 : 8000);
        } catch (reason) {
          lastError = reason;
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 300));
          }
        }
      }
    } finally {
      handshakeActive = false;
    }
    throw lastError || new Error("设备握手失败。");
  }

  async function refreshAll({ retryHandshake = false } = {}) {
    ready.value = false;
    const info = await waitForHello(retryHandshake);
    const firmware = String(info.firmware || "");
    if (!firmware.startsWith("SplatoonFarmers/2.") && firmware !== "SplatoonFarmers/mock") {
      throw new Error(`固件版本不匹配：${info.firmware || "未识别设备"}。请烧录当前 2.0 固件。`);
    }
    const commands = [
      ["MACRO_LIST", "macro_list", "读取宏槽位"],
      ["TASK_GET", "task_plan", "读取宏循环"],
      ["TRIGGER_GET", "trigger_config", "读取 GPIO 配置"],
    ];
    for (const [command, type, label] of commands) {
      try {
        await sendAndWait(command, (message) => [type, "error"].includes(message?.type));
      } catch (reason) {
        throw new Error(`${label}失败：${reason.message}。请确认烧录的是当前 2.0 固件。`);
      }
    }
    error.value = "";
    ready.value = true;
  }

  async function runSlot(slot) {
    await sendAndWait(`MACRO_START ${slot}`, (message) => ["status", "error"].includes(message?.type));
    notify(`已开始运行：${slots.value[slot]?.name || `槽位 ${slot + 1}`}。`);
  }
  async function runTask() {
    await sendAndWait("TASK_START", (message) => ["status", "error"].includes(message?.type));
    notify(`已开始宏循环：${taskPlan.value?.name || "当前方案"}。`);
  }
  async function stop() {
    await sendAndWait("STOP", (message) => ["status", "error"].includes(message?.type));
    notify("已停止当前宏并释放全部按键。");
  }
  async function manual(controls) { await send(buildManualReport(controls).command); }

  async function loadMacro(slot) {
    return sendAndWait(`MACRO_LOAD ${slot}`, (message) => ["macro", "error"].includes(message?.type));
  }

  async function saveMacro(slot, name, macro) {
    const normalized = { ...normalizeMacro(macro), repeat: true };
    const commands = buildMacroUploadCommands(normalized, { slot, name });
    stopPolling();
    try {
      for (const command of commands.slice(0, -1)) {
        await sendAndWait(command, (message) => ["ack", "error"].includes(message?.type), 12000);
      }
      await sendAndWait(commands.at(-1), (message) => ["macro", "error"].includes(message?.type), 30000);
      await sendAndWait("MACRO_LIST", (message) => ["macro_list", "error"].includes(message?.type), 12000);
      notify(`宏“${name}”已保存到开发板。`);
    } finally {
      startPolling();
    }
  }

  async function restoreMacro(slot) {
    await sendAndWait(`MACRO_RESTORE ${slot}`, (message) => ["macro_list", "error"].includes(message?.type));
    notify(`槽位 ${slot + 1} 已恢复为内置宏。`);
  }
  async function deleteMacro(slot) {
    await sendAndWait(`MACRO_DELETE ${slot}`, (message) => ["macro_list", "error"].includes(message?.type));
    notify(`槽位 ${slot + 1} 的宏已删除。`);
  }

  async function saveTask(plan) {
    await send("MACRO_LIST");
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const commands = buildTaskUploadCommands(plan, slots.value);
    for (const command of commands.slice(0, -1)) {
      await sendAndWait(command, (message) => ["ack", "error"].includes(message?.type));
    }
    const saved = await sendAndWait(commands.at(-1), (message) => ["task_plan", "error"].includes(message?.type));
    taskPlan.value = normalizeTaskPlan(saved);
    notify(`宏循环“${taskPlan.value.name}”已保存到开发板。`);
  }

  async function deleteTask() {
    await sendAndWait("TASK_DELETE", (message) => ["task_plan", "error"].includes(message?.type));
    taskPlan.value = null;
    notify("宏循环已删除。");
  }

  async function saveTriggers(config) {
    const commands = buildTriggerUploadCommands(config, slots.value, taskPlan.value);
    for (const command of commands.slice(0, -1)) {
      await sendAndWait(command, (message) => ["ack", "error"].includes(message?.type));
    }
    const saved = await sendAndWait(commands.at(-1), (message) => ["trigger_config", "error"].includes(message?.type));
    triggerConfig.value = saved;
    notify("GPIO 触发配置已保存到开发板。");
  }

  return {
    connected, ready, connecting, error, notification, status, slots, taskPlan, triggerConfig,
    running, activeName, connect, disconnect, send, refreshAll, runSlot,
    runTask, stop, manual, loadMacro, saveMacro, restoreMacro, deleteMacro,
    saveTask, deleteTask, saveTriggers, notify,
  };
});

function translateError(code = "") {
  const messages = {
    "task-plan-invalid": "宏循环不存在，或引用了空宏槽位。",
    "task-entry-invalid": "任务项无效，请检查宏、次数和等待时间。",
    "task-commit-invalid": "宏循环校验或保存失败。",
    "macro-slot-empty": "选择的宏槽位为空。",
    "macro-running": "宏正在运行，请先停止。",
  };
  if (code === "设备拒绝了这条指令") return "设备返回 ERR：当前网页与固件协议不一致，请重新烧录当前 2.0 固件。";
  return messages[code] || code || "设备拒绝了这条指令。";
}
