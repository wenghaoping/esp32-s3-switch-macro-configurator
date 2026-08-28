export const BUTTON_BITS = Object.freeze({
  Y: 0,
  B: 1,
  A: 2,
  X: 3,
  L: 4,
  R: 5,
  ZL: 6,
  ZR: 7,
  MINUS: 8,
  PLUS: 9,
  L_STICK_PRESS: 10,
  R_STICK_PRESS: 11,
  HOME: 12,
  CAPTURE: 13,
});

export const DPAD_CONTROLS = Object.freeze([
  "DPAD_UP",
  "DPAD_RIGHT",
  "DPAD_DOWN",
  "DPAD_LEFT",
]);

export const LEFT_STICK_CONTROLS = Object.freeze([
  "LEFT_STICK_UP",
  "LEFT_STICK_RIGHT",
  "LEFT_STICK_DOWN",
  "LEFT_STICK_LEFT",
]);

export const RIGHT_STICK_CONTROLS = Object.freeze([
  "RIGHT_STICK_UP",
  "RIGHT_STICK_RIGHT",
  "RIGHT_STICK_DOWN",
  "RIGHT_STICK_LEFT",
]);

export const ALL_CONTROLS = Object.freeze([
  ...Object.keys(BUTTON_BITS),
  ...DPAD_CONTROLS,
  ...LEFT_STICK_CONTROLS,
  ...RIGHT_STICK_CONTROLS,
]);

const VALID_CONTROLS = new Set(ALL_CONTROLS);

export const CONTROL_LABELS = Object.freeze({
  Y: "Y",
  B: "B",
  A: "A",
  X: "X",
  L: "L",
  R: "R",
  ZL: "ZL",
  ZR: "ZR",
  MINUS: "Minus",
  PLUS: "Plus",
  L_STICK_PRESS: "L3",
  R_STICK_PRESS: "R3",
  HOME: "Home",
  CAPTURE: "Capture",
  DPAD_UP: "D-pad Up",
  DPAD_RIGHT: "D-pad Right",
  DPAD_DOWN: "D-pad Down",
  DPAD_LEFT: "D-pad Left",
  LEFT_STICK_UP: "Left Stick Up",
  LEFT_STICK_RIGHT: "Left Stick Right",
  LEFT_STICK_DOWN: "Left Stick Down",
  LEFT_STICK_LEFT: "Left Stick Left",
  RIGHT_STICK_UP: "Right Stick Up",
  RIGHT_STICK_RIGHT: "Right Stick Right",
  RIGHT_STICK_DOWN: "Right Stick Down",
  RIGHT_STICK_LEFT: "Right Stick Left",
});

// Physical-key codes are layout-independent. IJKL mirrors the Switch face
// diamond, arrows drive the D-pad, WASD drives the left stick and the numpad
// drives the right stick.
export const DEFAULT_KEY_BINDINGS = Object.freeze({
  Y: "KeyJ",
  B: "KeyK",
  A: "KeyL",
  X: "KeyI",
  ZL: "KeyQ",
  L: "KeyE",
  R: "KeyU",
  ZR: "KeyO",
  MINUS: "Minus",
  PLUS: "Equal",
  L_STICK_PRESS: "KeyZ",
  R_STICK_PRESS: "KeyX",
  HOME: "KeyH",
  CAPTURE: "KeyC",
  DPAD_UP: "ArrowUp",
  DPAD_RIGHT: "ArrowRight",
  DPAD_DOWN: "ArrowDown",
  DPAD_LEFT: "ArrowLeft",
  LEFT_STICK_UP: "KeyW",
  LEFT_STICK_RIGHT: "KeyD",
  LEFT_STICK_DOWN: "KeyS",
  LEFT_STICK_LEFT: "KeyA",
  RIGHT_STICK_UP: "Numpad8",
  RIGHT_STICK_RIGHT: "Numpad6",
  RIGHT_STICK_DOWN: "Numpad5",
  RIGHT_STICK_LEFT: "Numpad4",
});

export const KEYBOARD_BINDINGS = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_KEY_BINDINGS).map(([control, code]) => [code, control]),
  ),
);

export function normalizeKeyBindings(bindings = {}) {
  const normalized = {};
  for (const control of ALL_CONTROLS) {
    const code = bindings[control];
    normalized[control] = typeof code === "string" && code ? code : DEFAULT_KEY_BINDINGS[control];
  }
  return normalized;
}

export function controlForKey(bindings, code) {
  return Object.entries(normalizeKeyBindings(bindings)).find(([, value]) => value === code)?.[0] || null;
}

export function bindingConflict(bindings, control, code) {
  return Object.entries(normalizeKeyBindings(bindings)).find(
    ([otherControl, otherCode]) => otherControl !== control && otherCode === code,
  )?.[0] || null;
}

export function keyLabel(code) {
  const labels = {
    ArrowUp: "↑",
    ArrowRight: "→",
    ArrowDown: "↓",
    ArrowLeft: "←",
    Minus: "-",
    Equal: "=",
  };
  if (labels[code]) {
    return labels[code];
  }
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
  }
  return code;
}

export function dpadValue(activeControls) {
  const active = new Set(activeControls);
  const up = active.has("DPAD_UP");
  const right = active.has("DPAD_RIGHT");
  const down = active.has("DPAD_DOWN");
  const left = active.has("DPAD_LEFT");

  const vertical = up === down ? 0 : up ? -1 : 1;
  const horizontal = left === right ? 0 : left ? -1 : 1;
  const values = new Map([
    ["0,-1", 0],
    ["1,-1", 1],
    ["1,0", 2],
    ["1,1", 3],
    ["0,1", 4],
    ["-1,1", 5],
    ["-1,0", 6],
    ["-1,-1", 7],
    ["0,0", 15],
  ]);
  return values.get(`${horizontal},${vertical}`) ?? 15;
}

function stickAxes(active, controls) {
  const [upControl, rightControl, downControl, leftControl] = controls;
  const up = active.has(upControl);
  const right = active.has(rightControl);
  const down = active.has(downControl);
  const left = active.has(leftControl);
  const vertical = up === down ? 0 : up ? -1 : 1;
  const horizontal = left === right ? 0 : right ? 1 : -1;
  return {
    x: horizontal < 0 ? 0 : horizontal > 0 ? 255 : 128,
    y: vertical < 0 ? 0 : vertical > 0 ? 255 : 128,
  };
}

export function buildManualReport(activeControls) {
  const active = new Set(activeControls);
  let buttons = 0;
  for (const [control, bit] of Object.entries(BUTTON_BITS)) {
    if (active.has(control)) {
      buttons |= 1 << bit;
    }
  }

  const leftStick = stickAxes(active, LEFT_STICK_CONTROLS);
  const rightStick = stickAxes(active, RIGHT_STICK_CONTROLS);
  const report = {
    buttons,
    dpad: dpadValue(active),
    leftX: leftStick.x,
    leftY: leftStick.y,
    rightX: rightStick.x,
    rightY: rightStick.y,
  };
  return {
    ...report,
    command: `R ${report.buttons} ${report.dpad} ${report.leftX} ${report.leftY} ${report.rightX} ${report.rightY}`,
  };
}

export function controlsForReport(report = {}) {
  const controls = [];
  const buttons = Number(report.buttons) || 0;
  for (const [control, bit] of Object.entries(BUTTON_BITS)) {
    if ((buttons & (1 << bit)) !== 0) controls.push(control);
  }
  const dpad = Number(report.dpad);
  if ([0, 1, 7].includes(dpad)) controls.push("DPAD_UP");
  if ([1, 2, 3].includes(dpad)) controls.push("DPAD_RIGHT");
  if ([3, 4, 5].includes(dpad)) controls.push("DPAD_DOWN");
  if ([5, 6, 7].includes(dpad)) controls.push("DPAD_LEFT");
  const addStick = (x, y, prefix) => {
    if (Number(y) < 128) controls.push(`${prefix}_UP`);
    if (Number(x) > 128) controls.push(`${prefix}_RIGHT`);
    if (Number(y) > 128) controls.push(`${prefix}_DOWN`);
    if (Number(x) < 128) controls.push(`${prefix}_LEFT`);
  };
  addStick(report.leftX, report.leftY, "LEFT_STICK");
  addStick(report.rightX, report.rightY, "RIGHT_STICK");
  return controls;
}

export function applyControlsToStep(step, controls) {
  const report = buildManualReport(controls);
  return {
    ...step,
    buttons: report.buttons,
    dpad: report.dpad,
    leftX: report.leftX,
    leftY: report.leftY,
    rightX: report.rightX,
    rightY: report.rightY,
  };
}

export class ManualInputState {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.sourceControls = new Map();
    this.controlCounts = new Map();
  }

  press(source, control) {
    if (!source || !VALID_CONTROLS.has(control)) {
      return false;
    }

    const previousControl = this.sourceControls.get(source);
    if (previousControl === control) {
      return false;
    }

    let activeSetChanged = false;
    if (previousControl) {
      activeSetChanged = this.decrement(previousControl) || activeSetChanged;
    }

    this.sourceControls.set(source, control);
    const previousCount = this.controlCounts.get(control) || 0;
    this.controlCounts.set(control, previousCount + 1);
    activeSetChanged = previousCount === 0 || activeSetChanged;
    if (activeSetChanged) {
      this.notify();
    }
    return activeSetChanged;
  }

  release(source) {
    const control = this.sourceControls.get(source);
    if (!control) {
      return false;
    }
    this.sourceControls.delete(source);
    const activeSetChanged = this.decrement(control);
    if (activeSetChanged) {
      this.notify();
    }
    return activeSetChanged;
  }

  clear() {
    if (this.sourceControls.size === 0 && this.controlCounts.size === 0) {
      return false;
    }
    const activeSetChanged = this.controlCounts.size > 0;
    this.sourceControls.clear();
    this.controlCounts.clear();
    if (activeSetChanged) {
      this.notify();
    }
    return activeSetChanged;
  }

  activeControls() {
    return new Set(this.controlCounts.keys());
  }

  isPressed(control) {
    return this.controlCounts.has(control);
  }

  hasSource(source) {
    return this.sourceControls.has(source);
  }

  decrement(control) {
    const nextCount = (this.controlCounts.get(control) || 0) - 1;
    if (nextCount <= 0) {
      this.controlCounts.delete(control);
      return true;
    }
    this.controlCounts.set(control, nextCount);
    return false;
  }

  notify() {
    this.onChange(this.activeControls());
  }
}
