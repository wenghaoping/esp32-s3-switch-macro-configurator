import { DEVICE_BAUD_RATE, parseDeviceLine } from "./protocol.js";
import {
  macroChecksum,
  normalizeMacro,
  validateMacro,
} from "./macro-editor.js";
import { BUILTIN_MACROS } from "./builtin-macros.js";
import {
  defaultTriggerConfig,
  triggerConfigChecksum,
  validateTriggerConfig,
} from "./library-manager.js";
import { normalizeTaskPlan, taskPlanChecksum } from "./task-plan.js";

export class SerialLineDecoder {
  constructor() {
    this.decoder = new TextDecoder();
    this.buffered = "";
  }

  push(bytes) {
    this.buffered += this.decoder.decode(bytes, { stream: true });
    return this.takeCompleteLines();
  }

  finish() {
    this.buffered += this.decoder.decode();
    const lines = this.takeCompleteLines();
    if (this.buffered.trim()) lines.push(this.buffered);
    this.buffered = "";
    return lines;
  }

  takeCompleteLines() {
    const parts = this.buffered.split(/\r?\n/);
    this.buffered = parts.pop() ?? "";
    return parts.filter((line) => line.trim());
  }
}

export class SerialTransport {
  constructor({ onLine, onDisconnect }) {
    this.onLine = onLine;
    this.onDisconnect = onDisconnect;
    this.port = null;
    this.reader = null;
    this.readTask = null;
    this.writeChain = Promise.resolve();
    this.responseWaiters = [];
    this.connected = false;
    this.intentionalClose = false;
  }

  static isSupported() {
    return "serial" in navigator;
  }

  async connect() {
    if (!SerialTransport.isSupported()) {
      throw new Error("当前浏览器不支持 Web Serial，请使用桌面版 Chrome 或 Edge。");
    }

    this.port = await navigator.serial.requestPort();
    await this.openPort();
  }

  async connectPort(port) {
    if (!SerialTransport.isSupported()) {
      throw new Error("当前浏览器不支持 Web Serial，请使用桌面版 Chrome 或 Edge。");
    }
    if (!port) {
      throw new Error("没有可重新连接的已授权串口。");
    }
    this.port = port;
    await this.openPort();
  }

  async openPort() {
    await this.port.open({ baudRate: DEVICE_BAUD_RATE, bufferSize: 255 });
    try {
      await this.port.setSignals({
        dataTerminalReady: false,
        requestToSend: false,
      });
    } catch {
      // Some USB-UART drivers do not expose modem control lines. The data
      // channel still works, and avoiding a hard failure is safer here.
    }
    this.intentionalClose = false;
    this.connected = true;
    this.readTask = this.readLoop();
  }

  send(command) {
    const write = async () => {
      if (!this.connected || !this.port?.writable) {
        throw new Error("串口尚未连接");
      }
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(`${command}\n`));
      } finally {
        writer.releaseLock();
      }
    };
    const result = this.writeChain.then(write, write);
    this.writeChain = result.catch(() => {});
    return result;
  }

  async sendAndWait(command, {
    timeoutMs = 2500,
    predicate = (message) => message?.type === "ack" || message?.type === "error",
  } = {}) {
    const waiter = this.createResponseWaiter(predicate, timeoutMs);
    try {
      await this.send(command);
      return await waiter.promise;
    } catch (error) {
      waiter.cancel(error);
      throw error;
    }
  }

  createResponseWaiter(predicate, timeoutMs) {
    let settled = false;
    let resolvePromise;
    let rejectPromise;
    const waiter = {
      predicate,
      promise: new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      }),
      cancel: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(waiter.timer);
        this.responseWaiters = this.responseWaiters.filter((item) => item !== waiter);
        rejectPromise(error);
      },
      resolve: (message) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(waiter.timer);
        this.responseWaiters = this.responseWaiters.filter((item) => item !== waiter);
        resolvePromise(message);
      },
      timer: null,
    };
    waiter.timer = window.setTimeout(() => {
      waiter.cancel(new Error("Timed out waiting for the board response."));
    }, timeoutMs);
    this.responseWaiters.push(waiter);
    return waiter;
  }

  dispatchLine(line) {
    const message = parseDeviceLine(line);
    for (const waiter of [...this.responseWaiters]) {
      if (waiter.predicate(message, line)) {
        waiter.resolve(message);
        break;
      }
    }
    this.onLine(line);
  }

  async disconnect() {
    if (!this.port) {
      return;
    }
    this.intentionalClose = true;
    this.connected = false;

    for (const waiter of [...this.responseWaiters]) {
      waiter.cancel(new Error("Serial port disconnected."));
    }

    await this.writeChain.catch(() => {});
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // The physical port may already be gone.
      }
    }
    if (this.readTask) {
      try {
        await this.readTask;
      } catch {
        // readLoop reports unexpected failures through onDisconnect.
      }
    }
    try {
      await this.port.close();
    } finally {
      this.port = null;
      this.readTask = null;
      this.intentionalClose = false;
    }
  }

  async readLoop() {
    const lineDecoder = new SerialLineDecoder();
    try {
      while (this.connected && this.port?.readable) {
        this.reader = this.port.readable.getReader();
        try {
          while (this.connected) {
            const { value, done } = await this.reader.read();
            if (done) {
              break;
            }
            for (const line of lineDecoder.push(value)) this.dispatchLine(line);
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (error) {
      if (!this.intentionalClose && this.connected) {
        this.connected = false;
        this.onDisconnect(error);
      }
      return;
    }

    for (const line of lineDecoder.finish()) this.dispatchLine(line);

    if (!this.intentionalClose && this.connected) {
      this.connected = false;
      this.onDisconnect(new Error("串口数据流已经断开"));
    }
  }
}

export class MockSerialTransport {
  constructor({ onLine, onDisconnect }) {
    this.onLine = onLine;
    this.onDisconnect = onDisconnect;
    this.connected = false;
    this.state = "idle";
    this.phase = "idle";
    this.step = 0;
    this.cycle = 0;
    this.lastReport = null;
    this.macro = structuredClone(BUILTIN_MACROS[0].macro);
    this.source = "builtin";
    this.stagedMacro = null;
    this.builtinMacros = BUILTIN_MACROS.map(({ macro }) => structuredClone(macro));
    this.slots = Array.from({ length: 8 }, (_, slot) => this.builtinMacros[slot] ? {
      slot,
      occupied: true,
      source: "builtin",
      has_builtin: true,
      has_stored: false,
      name: BUILTIN_MACROS[slot].name,
      steps: this.builtinMacros[slot].steps.length,
      duration_ms: this.builtinMacros[slot].steps.reduce((total, step) => total + step.durationMs + step.waitMs, 0),
      loop_gap_ms: this.builtinMacros[slot].loopGapMs,
      repeat: this.builtinMacros[slot].repeat,
    } : { slot, occupied: false, source: "empty", has_builtin: false, has_stored: false });
    this.slotMacros = Array.from({ length: 8 }, (_, slot) => this.builtinMacros[slot] ? structuredClone(this.builtinMacros[slot]) : null);
    this.activeSlot = 0;
    this.triggerConfig = { type: "trigger_config", ok: true, ...defaultTriggerConfig() };
    this.stagedTriggerConfig = null;
    this.taskPlan = null;
    this.stagedTaskPlan = null;
  }

  static isSupported() {
    return true;
  }

  async connect() {
    this.connected = true;
  }

  async send(command) {
    if (!this.connected) {
      throw new Error("模拟串口尚未连接");
    }
    // Keep the mock aligned with the firmware: inspecting list/status is safe
    // while a board macro runs, but configuration commands must never stop it.
    const macroConfigurationCommand = command === "MACRO_DEFAULT" ||
      /^(MACRO_RESTORE|MACRO_BEGIN|MACRO_LOAD|MACRO_DELETE|MACRO_RENAME|MACRO_NAME|MACRO_STEP|MACRO_COMMIT)(?:\s|$)/.test(command);
    if (this.state === "running" && macroConfigurationCommand) {
      this.stagedMacro = null;
      this.emitError("macro-running");
      return;
    }
    if (command === "START") {
      this.state = "running";
      this.phase = "steps";
      this.step = 1;
      this.emit("status");
    } else if (command.startsWith("MACRO_START ")) {
      const slot = Number(command.split(" ")[1]);
      if (!Number.isInteger(slot) || !this.slots[slot]?.occupied) {
        this.emitError("macro-slot-empty");
        return;
      }
      this.activeSlot = slot;
      this.source = this.slots[slot].source;
      this.macro = structuredClone(this.slotMacros[slot]);
      this.state = "running";
      this.phase = "steps";
      this.step = 1;
      this.emit("status");
    } else if (command === "STOP") {
      this.state = "idle";
      this.phase = "idle";
      this.step = 0;
      this.emit("status");
    } else if (command === "HELLO" || command === "INFO") {
      this.emit("info");
    } else if (command === "STATUS") {
      this.emit("status");
    } else if (command === "MACRO_GET") {
      if (this.state === "running") {
        this.emitError("macro-running");
        return;
      }
      this.emitMacro();
    } else if (command === "MACRO_LIST") {
      this.emitMacroList();
    } else if (command === "TRIGGER_GET") {
      this.onLine(JSON.stringify(this.triggerConfig));
    } else if (command === "TASK_GET") {
      this.emitTaskPlan();
    } else if (command === "TASK_BEGIN 5") {
      this.stagedTaskPlan = { name: "", repeat: true, entries: [] };
      this.onLine("OK");
    } else if (command.startsWith("TASK_META ")) {
      const [, encodedName, countText, repeatText] = command.split(" ");
      const count = Number(countText);
      if (!this.stagedTaskPlan || count < 1 || count > 5) {
        this.emitError("task-meta-invalid"); return;
      }
      this.stagedTaskPlan.name = decodeURIComponent(encodedName);
      this.stagedTaskPlan.repeat = repeatText === "1";
      this.stagedTaskPlan.entries = Array.from({ length: count });
      this.onLine("OK");
    } else if (command.startsWith("TASK_ENTRY ")) {
      const [index, slot, repeatCount, gapMs] = command.split(" ").slice(1).map(Number);
      if (!this.stagedTaskPlan || !this.slots[slot]?.occupied || index < 0 || index >= this.stagedTaskPlan.entries.length) {
        this.emitError("task-entry-invalid"); return;
      }
      this.stagedTaskPlan.entries[index] = { slot, repeatCount, gapMs };
      this.onLine("OK");
    } else if (command.startsWith("TASK_COMMIT ")) {
      const checksum = Number(command.split(" ")[1]);
      const candidate = this.stagedTaskPlan && normalizeTaskPlan(this.stagedTaskPlan);
      if (!candidate || candidate.entries.some((entry) => !entry) || taskPlanChecksum(candidate) !== checksum) {
        this.emitError("task-commit-invalid"); return;
      }
      this.taskPlan = candidate;
      this.stagedTaskPlan = null;
      this.emitTaskPlan();
    } else if (command === "TASK_DELETE") {
      this.taskPlan = null;
      this.emitTaskPlan();
    } else if (command === "TASK_START") {
      if (!this.taskPlan) { this.emitError("task-plan-invalid"); return; }
      this.activeSlot = this.taskPlan.entries[0].slot;
      this.source = this.slots[this.activeSlot].source;
      this.macro = structuredClone(this.slotMacros[this.activeSlot]);
      this.state = "running";
      this.phase = "steps";
      this.step = 1;
      this.emit("status");
    } else if (command === "TRIGGER_DEFAULT") {
      this.triggerConfig = { type: "trigger_config", ok: true, ...defaultTriggerConfig() };
      this.onLine(JSON.stringify(this.triggerConfig));
    } else if (command === "TRIGGER_BEGIN 8") {
      this.stagedTriggerConfig = structuredClone(this.triggerConfig);
      this.onLine("OK");
    } else if (command.startsWith("TRIGGER_STOP_PIN ")) {
      const target = this.stagedTriggerConfig ?? this.triggerConfig;
      target.stop_pin = Number(command.split(" ")[1]);
      this.onLine("OK");
    } else if (command.startsWith("TRIGGER_ENTRY ")) {
      const [index, enabled, pin, slot] = command.split(" ").slice(1).map(Number);
      const target = this.stagedTriggerConfig ?? this.triggerConfig;
      if (target.entries[index]) {
        target.entries[index] = { index, pin, slot, enabled: enabled === 1 };
        this.onLine("OK");
      } else {
        this.emitError("trigger-config-invalid");
      }
    } else if (command.startsWith("TRIGGER_COMMIT ")) {
      const checksum = Number(command.split(" ")[1]);
      const candidate = this.stagedTriggerConfig;
      if (!candidate || triggerConfigChecksum(candidate) !== checksum ||
          validateTriggerConfig(candidate, this.slots, this.taskPlan).length > 0) {
        this.stagedTriggerConfig = null;
        this.emitError("trigger-checksum-invalid");
        return;
      }
      this.triggerConfig = { type: "trigger_config", ok: true, ...candidate };
      this.stagedTriggerConfig = null;
      this.onLine(JSON.stringify(this.triggerConfig));
    } else if (command === "MACRO_DEFAULT") {
      this.source = "default";
      this.activeSlot = -1;
      this.stagedMacro = null;
      this.macro = {
        steps: [
          {
            durationMs: 100,
            waitMs: 0,
            buttons: 0,
            dpad: 15,
            leftX: 128,
            leftY: 128,
            rightX: 128,
            rightY: 128,
          },
        ],
        loopGapMs: 0,
        repeat: true,
      };
      this.emitMacro();
      this.emitMacroList();
      this.emit("status");
    } else if (command.startsWith("MACRO_BEGIN ")) {
      const values = command.split(" ").slice(1).map(Number);
      const [slot, count, loopGapMs, repeat] = values;
      if (!Number.isInteger(slot) || slot < 0 || slot > 7 || !Number.isInteger(count) || count < 1 || count > 512) {
        this.emitError("macro-begin-invalid");
        return;
      }
      this.stagedMacro = {
        slot,
        name: "",
        steps: Array.from({ length: count }),
        loopGapMs,
        repeat: repeat === 1,
      };
      this.onLine("OK");
    } else if (command.startsWith("MACRO_NAME ")) {
      if (!this.stagedMacro) {
        this.emitError("macro-name-invalid");
        return;
      }
      try {
        this.stagedMacro.name = decodeURIComponent(command.slice(11));
      } catch {
        this.emitError("macro-name-invalid");
        return;
      }
      this.onLine("OK");
    } else if (command.startsWith("MACRO_STEP ")) {
      const values = command.split(" ").slice(1).map(Number);
      const [index, durationMs, waitMs, buttons, dpad, leftX, leftY, rightX, rightY] = values;
      if (!this.stagedMacro || !Number.isInteger(index) || index < 0 || index >= this.stagedMacro.steps.length) {
        this.emitError("macro-step-invalid");
        return;
      }
      this.stagedMacro.steps[index] = {
        durationMs,
        waitMs,
        buttons,
        dpad,
        leftX,
        leftY,
        rightX,
        rightY,
      };
      this.onLine("OK");
    } else if (command.startsWith("MACRO_COMMIT ")) {
      const checksum = Number(command.split(" ")[1]);
      const candidate = normalizeMacro(this.stagedMacro ?? {});
      if (
        !this.stagedMacro ||
        this.stagedMacro.steps.some((step) => !step) ||
        validateMacro(candidate).length > 0 ||
        macroChecksum(candidate) !== checksum
      ) {
        this.emitError("macro-checksum-invalid");
        return;
      }
      this.macro = candidate;
      this.activeSlot = this.stagedMacro.slot;
      this.slots[this.activeSlot] = {
        slot: this.activeSlot,
        occupied: true,
        source: "stored",
        has_builtin: Boolean(this.builtinMacros[this.activeSlot]),
        has_stored: true,
        name: this.stagedMacro.name || `Macro ${this.activeSlot + 1}`,
        steps: candidate.steps.length,
        duration_ms: candidate.steps.reduce((total, step) => total + step.durationMs + step.waitMs, 0),
        loop_gap_ms: candidate.loopGapMs,
        repeat: candidate.repeat,
      };
      this.slotMacros[this.activeSlot] = candidate;
      this.source = "stored";
      this.stagedMacro = null;
      this.emitMacro();
      this.emitMacroList();
      this.emit("status");
    } else if (command.startsWith("MACRO_LOAD ")) {
      const slot = Number(command.slice(11));
      const info = this.slots[slot];
      if (!Number.isInteger(slot) || !info?.occupied) {
        this.emitError("macro-slot-empty");
        return;
      }
      this.activeSlot = slot;
      this.source = info.source;
      this.macro = structuredClone(this.slotMacros[slot]);
      this.emitMacro();
      this.emitMacroList();
      this.emit("status");
    } else if (command.startsWith("MACRO_DELETE ")) {
      const slot = Number(command.slice(13));
      if (!Number.isInteger(slot) || slot < 0 || slot > 7) {
        this.emitError("macro-delete-failed");
        return;
      }
      const hasBuiltin = this.slots[slot]?.has_builtin === true;
      this.slots[slot] = hasBuiltin ? {
        ...this.slots[slot], source: "builtin", has_stored: false,
        name: BUILTIN_MACROS[slot].name,
      } : { slot, occupied: false, source: "empty", has_builtin: false, has_stored: false };
      if (hasBuiltin) {
        this.slotMacros[slot] = structuredClone(this.builtinMacros[slot]);
      } else {
        this.slotMacros[slot] = null;
      }
      if (this.activeSlot === slot) {
        this.activeSlot = hasBuiltin ? slot : 0;
        this.source = "builtin";
        this.macro = structuredClone(this.slotMacros[this.activeSlot]);
        this.emitMacro();
      }
      this.emitMacroList();
      this.emit("status");
    } else if (command.startsWith("MACRO_RESTORE ")) {
      const slot = Number(command.slice(14));
      if (!Number.isInteger(slot) || slot < 0 || !this.builtinMacros[slot]) {
        this.emitError("macro-no-builtin");
        return;
      }
      this.slots[slot] = {
        ...this.slots[slot], occupied: true, source: "builtin",
        has_builtin: true, has_stored: false,
        name: BUILTIN_MACROS[slot].name,
      };
      this.slotMacros[slot] = structuredClone(this.builtinMacros[slot]);
      if (this.activeSlot === slot) {
        this.source = "builtin";
        this.macro = structuredClone(this.slotMacros[slot]);
        this.emitMacro();
      }
      this.emitMacroList();
    } else if (command === "PING") {
      this.onLine("PONG");
    } else if (/^R \d+ \d+ \d+ \d+ \d+ \d+$/.test(command)) {
      this.lastReport = command;
      this.onLine("OK");
    } else {
      this.onLine("ERR");
    }
  }

  async sendAndWait(command, {
    predicate = (message) => message?.type === "ack" || message?.type === "error",
  } = {}) {
    let response = null;
    const previousOnLine = this.onLine;
    this.onLine = (line) => {
      const message = parseDeviceLine(line);
      if (response === null && predicate(message, line)) {
        response = message;
      }
      previousOnLine(line);
    };
    try {
      await this.send(command);
    } finally {
      this.onLine = previousOnLine;
    }
    if (response === null) {
      throw new Error("Timed out waiting for the board response.");
    }
    return response;
  }

  async disconnect() {
    this.connected = false;
  }

  emit(type) {
    this.onLine(
      JSON.stringify({
        type,
        ok: true,
        firmware: "SplatoonFarmers/mock",
        routine: "material-farm",
        embedded: true,
        state: this.state,
        phase: this.phase,
        step: this.step,
        steps: this.macro.steps.length,
        progress_step: this.step,
        progress_total: this.macro.steps.length,
        cycle: this.cycle,
        duration_ms: this.macro.steps.reduce(
          (total, step) => total + step.durationMs + step.waitMs,
          0,
        ),
        loop_gap_ms: this.macro.loopGapMs,
        cycle_ms:
          this.macro.steps.reduce(
            (total, step) => total + step.durationMs + step.waitMs,
            0,
          ) + this.macro.loopGapMs,
        current_buttons: this.macro.steps[Math.max(0, this.step - 1)]?.buttons || 0,
        current_dpad: this.macro.steps[Math.max(0, this.step - 1)]?.dpad ?? 15,
        current_left_x: this.macro.steps[Math.max(0, this.step - 1)]?.leftX ?? 128,
        current_left_y: this.macro.steps[Math.max(0, this.step - 1)]?.leftY ?? 128,
        current_right_x: this.macro.steps[Math.max(0, this.step - 1)]?.rightX ?? 128,
        current_right_y: this.macro.steps[Math.max(0, this.step - 1)]?.rightY ?? 128,
        current_hold_ms: this.macro.steps[Math.max(0, this.step - 1)]?.durationMs || 0,
        current_wait_ms: this.macro.steps[Math.max(0, this.step - 1)]?.waitMs || 0,
        current_phase_elapsed_ms: 0,
        current_phase_remaining_ms: this.macro.steps[Math.max(0, this.step - 1)]?.durationMs || 0,
        repeat: this.macro.repeat,
        source: this.source,
        slot: this.activeSlot,
        name: this.activeSlot >= 0 ? this.slots[this.activeSlot]?.name : "Default material farm",
        running_name: this.state === "running" ? this.slots[this.activeSlot]?.name : "",
        running_source: this.state === "running" ? this.source : "empty",
        task_active: this.state === "running" && Boolean(this.taskPlan),
        task_name: this.taskPlan?.name || "",
        task_entry: this.taskPlan && this.state === "running" ? 1 : 0,
        task_entries: this.taskPlan?.entries.length || 0,
        task_iteration: this.taskPlan && this.state === "running" ? 1 : 0,
        task_target_iterations: this.taskPlan?.entries[0]?.repeatCount || 0,
        task_cycle: 0,
        task_repeat: this.taskPlan?.repeat || false,
        next_name: this.taskPlan?.entries[1] ? this.slots[this.taskPlan.entries[1].slot]?.name : "",
      }),
    );
  }

  emitMacro() {
    this.onLine(
      JSON.stringify({
        type: "macro",
        ok: true,
        source: this.source,
        slot: this.activeSlot,
        name: this.activeSlot >= 0 ? this.slots[this.activeSlot]?.name : "Default material farm",
        steps: this.macro.steps.map((step) => ({
          duration_ms: step.durationMs,
          wait_ms: step.waitMs,
          buttons: step.buttons,
          dpad: step.dpad,
          left_x: step.leftX,
          left_y: step.leftY,
          right_x: step.rightX,
          right_y: step.rightY,
        })),
        loop_gap_ms: this.macro.loopGapMs,
        repeat: this.macro.repeat,
        checksum: macroChecksum(this.macro),
      }),
    );
  }

  emitError(message) {
    this.onLine(JSON.stringify({ type: "error", ok: false, message }));
  }

  emitMacroList() {
    this.onLine(JSON.stringify({
      type: "macro_list",
      ok: true,
      active_slot: this.activeSlot,
      slots: this.slots,
    }));
  }

  emitTaskPlan() {
    this.onLine(JSON.stringify({
      type: "task_plan",
      ok: true,
      available: Boolean(this.taskPlan),
      ...(this.taskPlan || {}),
    }));
  }
}
