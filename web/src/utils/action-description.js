const BUTTONS = [
  "Y", "B", "A", "X", "L", "R", "ZL", "ZR",
  "-", "+", "L3", "R3", "Home", "Capture",
];

const DPAD = [
  "十字键上 ↑", "十字键右上 ↗", "十字键右 →", "十字键右下 ↘",
  "十字键下 ↓", "十字键左下 ↙", "十字键左 ←", "十字键左上 ↖",
];

const CONTROL_NAMES = {
  Y: "Y", B: "B", A: "A", X: "X", L: "L", R: "R", ZL: "ZL", ZR: "ZR",
  MINUS: "减号键 -", PLUS: "加号键 +", L_STICK_PRESS: "L3", R_STICK_PRESS: "R3",
  HOME: "主页键", CAPTURE: "截图键",
  DPAD_UP: "十字键上 ↑", DPAD_RIGHT: "十字键右 →",
  DPAD_DOWN: "十字键下 ↓", DPAD_LEFT: "十字键左 ←",
  LEFT_STICK_UP: "左摇杆上 ↑", LEFT_STICK_RIGHT: "左摇杆右 →",
  LEFT_STICK_DOWN: "左摇杆下 ↓", LEFT_STICK_LEFT: "左摇杆左 ←",
  RIGHT_STICK_UP: "右摇杆上 ↑", RIGHT_STICK_RIGHT: "右摇杆右 →",
  RIGHT_STICK_DOWN: "右摇杆下 ↓", RIGHT_STICK_LEFT: "右摇杆左 ←",
};

function axisDirection(x, y, name) {
  const horizontal = x < 96 ? "左" : x > 160 ? "右" : "";
  const vertical = y < 96 ? "上" : y > 160 ? "下" : "";
  return horizontal || vertical ? `${name}${vertical}${horizontal}` : "";
}

export function formatMs(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds >= 1000 && milliseconds % 1000 === 0) {
    return `${milliseconds / 1000} 秒`;
  }
  return `${milliseconds} 毫秒`;
}

export function describeControls(controls = []) {
  const names = controls.map((control) => CONTROL_NAMES[control]).filter(Boolean);
  return names.join(" + ") || "未按下任何按键";
}

function reportActions(report = {}) {
  const actions = [];
  const buttons = Number(report.buttons) || 0;
  BUTTONS.forEach((name, bit) => {
    if (buttons & (1 << bit)) actions.push(name);
  });
  const dpad = Number(report.dpad);
  if (dpad >= 0 && dpad < DPAD.length) actions.push(DPAD[dpad]);
  const left = axisDirection(Number(report.leftX), Number(report.leftY), "左摇杆");
  const right = axisDirection(Number(report.rightX), Number(report.rightY), "右摇杆");
  if (left) actions.push(left);
  if (right) actions.push(right);
  return actions;
}

export function describeMacroStep(step = {}) {
  const actions = reportActions(step);
  return {
    title: actions.join(" + ") || "不操作手柄",
    timing: `按住 ${formatMs(step.durationMs)} → 松开全部按键 → 等待 ${formatMs(step.waitMs)}`,
  };
}

export function describeCurrentAction(status = {}) {
  if (status.state !== "running" && !status.task_active) {
    return { title: "尚未运行", timing: "启动宏后显示实时动作" };
  }
  if (status.task_waiting) {
    return {
      title: "已松开全部按键",
      timing: `宏之间等待剩余 ${formatMs(status.task_wait_remaining_ms)}`,
    };
  }
  if (status.phase === "step-wait") {
    return {
      title: "已松开全部按键",
      timing: `动作后等待 ${formatMs(status.current_wait_ms)} · 剩余 ${formatMs(status.current_phase_remaining_ms)}`,
    };
  }
  if (status.phase === "gap") {
    return {
      title: "一轮宏已完成",
      timing: `下一轮前等待剩余 ${formatMs(status.current_phase_remaining_ms)}`,
    };
  }

  const actions = reportActions({
    buttons: status.current_buttons,
    dpad: status.current_dpad,
    leftX: status.current_left_x,
    leftY: status.current_left_y,
    rightX: status.current_right_x,
    rightY: status.current_right_y,
  });

  return {
    title: actions.join(" + ") || "不操作手柄",
    timing: `保持 ${formatMs(status.current_hold_ms)} · 剩余 ${formatMs(status.current_phase_remaining_ms)}`,
  };
}
