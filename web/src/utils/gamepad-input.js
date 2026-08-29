// 从手动输入模块复用三个工具：
// 1. controlsForReport：把底层报告反向转换成页面上的控制名称；
// 2. controllerReportCommand：把报告转换成发送给 ESP32 的 R 指令；
// 3. normalizeControllerReport：校正按钮、十字键和摇杆数据的范围。
import {
  controlsForReport,
  controllerReportCommand,
  normalizeControllerReport,
} from "./manual-input.js";

// 浏览器 Gamepad API 的 standard 布局中，前四个按钮按“物理位置”排列：
// buttons[0] = 下，buttons[1] = 右，buttons[2] = 左，buttons[3] = 上。
//
// 因此这里不是按字母名称映射，而是按手柄上的实际位置映射到 Switch：
// 下 -> B，右 -> A，左 -> Y，上 -> X。
// 这样 Xbox 的 A/B/X/Y 和 PS5 的 叉/圆圈/方形/三角形都能得到相同的 Switch 结果。
//
// 后面的编号也遵循 standard 布局：
// buttons[4..7]  = LB、RB、LT、RT，对应 Switch L、R、ZL、ZR；
// buttons[8..11] = Back、Start、左摇杆按下、右摇杆按下。
const STANDARD_BUTTON_CONTROLS = Object.freeze([
  "B", // buttons[0]：实体手柄下方按键 -> Switch B
  "A", // buttons[1]：实体手柄右侧按键 -> Switch A
  "Y", // buttons[2]：实体手柄左侧按键 -> Switch Y
  "X", // buttons[3]：实体手柄上方按键 -> Switch X
  "L", // buttons[4]：左肩键
  "R", // buttons[5]：右肩键
  "ZL", // buttons[6]：左扳机
  "ZR", // buttons[7]：右扳机
  "MINUS", // buttons[8]：减号/Back
  "PLUS", // buttons[9]：加号/Start
  "L_STICK_PRESS", // buttons[10]：按下左摇杆
  "R_STICK_PRESS", // buttons[11]：按下右摇杆
]);

// standard 布局的十字键从 buttons[12] 开始：
// buttons[12] = 上，buttons[13] = 下，buttons[14] = 左，buttons[15] = 右。
// 数组中的顺序要和读取时的 index + 12 保持一致。
const STANDARD_DPAD_CONTROLS = Object.freeze([
  "DPAD_UP", // buttons[12]
  "DPAD_DOWN", // buttons[13]
  "DPAD_LEFT", // buttons[14]
  "DPAD_RIGHT", // buttons[15]
]);

// Xbox Elite 2 的识别信息和按键布局。
// Xbox 手柄如果被浏览器识别为 standard，直接使用这套索引即可。
export const XBOX_ELITE_2_MAPPING = Object.freeze({
  type: "xbox", // 程序内部使用的手柄类型标识
  label: "Xbox Elite 2", // 页面显示名称
  name: "Xbox Elite 2 / 按位置映射", // 状态栏显示名称
  buttons: STANDARD_BUTTON_CONTROLS, // 采用标准按钮索引
  dpad: STANDARD_DPAD_CONTROLS, // 采用标准十字键索引
  axes: [0, 1, 2, 3], // 左摇杆 X/Y、右摇杆 X/Y 的轴编号
});

// PS5 DualSense 的识别信息和按键布局。
// DualSense 在浏览器中通常也会暴露为 standard 布局，
// 所以它和 Xbox 的物理位置映射数组相同，但单独保留类型名称，方便自动识别和显示。
export const PS5_DUALSENSE_MAPPING = Object.freeze({
  type: "ps5", // 程序内部使用的手柄类型标识
  label: "PS5 DualSense", // 页面显示名称
  name: "PS5 DualSense / 按位置映射", // 状态栏显示名称
  buttons: STANDARD_BUTTON_CONTROLS, // 三角/方形/叉/圆圈按物理位置映射
  dpad: STANDARD_DPAD_CONTROLS, // 采用标准十字键索引
  axes: [0, 1, 2, 3], // 左摇杆 X/Y、右摇杆 X/Y 的轴编号
});

// 对未知但符合 standard 布局的手柄提供一个通用兜底方案。
// 这样即使设备名称没有包含 Xbox 或 Sony，也不会完全无法使用。
export const GENERIC_STANDARD_MAPPING = Object.freeze({
  type: "generic", // 程序内部使用的通用类型标识
  label: "标准手柄", // 页面显示名称
  name: "标准手柄 / 按位置映射", // 状态栏显示名称
  buttons: STANDARD_BUTTON_CONTROLS, // 使用 standard 的按钮索引
  dpad: STANDARD_DPAD_CONTROLS, // 使用 standard 的十字键索引
  axes: [0, 1, 2, 3], // 使用 standard 的四个摇杆轴
});

// 手柄没有输入时要发送的安全报告。
// buttons = 0 表示没有按键；dpad = 15 表示十字键中立；
// 四个轴 = 128 表示摇杆位于中心。
// Object.freeze 用来防止运行时意外修改这组全局常量。
export const NEUTRAL_GAMEPAD_REPORT = Object.freeze({
  buttons: 0,
  dpad: 15,
  leftX: 128,
  leftY: 128,
  rightX: 128,
  rightY: 128,
});

// 把浏览器返回的摇杆浮点数转换成 ESP32 使用的 0~255 整数。
// 浏览器轴值通常是 -1.0~1.0：
// -1 表示最左/最上，0 表示中心，1 表示最右/最下。
// ESP32 报告使用 0~255：0 表示负方向，128 表示中心，255 表示正方向。
function axisToByte(value, deadzone = 0.16) {
  // 将异常值转换成 0，避免 NaN 参与后续计算。
  const numeric = Number(value) || 0;

  // magnitude 只表示偏离中心的距离，不带方向。
  const magnitude = Math.abs(numeric);

  // 摇杆中心附近的机械漂移直接视为中立，避免产生无意义输入。
  if (magnitude <= deadzone) return 128;

  // 去掉死区后，把剩余范围重新拉伸到完整的 0~1。
  const scaled = (magnitude - deadzone) / (1 - deadzone);

  // 恢复原始方向，并将 -1~1 映射到 0~255，最后限制在合法范围内。
  return Math.max(0, Math.min(255, Math.round(127.5 + Math.sign(numeric) * scaled * 127.5)));
}

// 统一判断一个 GamepadButton 是否处于按下状态。
// 有些浏览器只正确填写 pressed，有些浏览器还会通过 value 提供模拟量，
// 因此两个条件满足任意一个都认为按下。
function pressed(button, threshold = 0.5) {
  return Boolean(button?.pressed || Number(button?.value) >= threshold);
}

// 根据浏览器提供的设备名称、厂商名称或 USB 标识判断手柄类型。
// Gamepad API 没有统一的 vendor 字段，所以主要依赖 gamepad.id 中的文本。
export function identifyGamepadType(gamepad) {
  // 统一转成小写，兼容不同浏览器返回的大小写差异。
  const identity = String(gamepad?.id || "").toLowerCase();

  // DualSense/DualShock 常见名称、Sony 文本以及 Sony USB 标识。
  // “wireless controller” 是部分 macOS/蓝牙环境下 DualSense 的简化名称。
  if (
    /dualsense|dualshock|playstation|sony|054c|0ce6|0df2|wireless controller/.test(identity)
  ) {
    return "ps5";
  }

  // Xbox 常见名称、Microsoft 文本、Xbox USB 厂商标识和 Elite 文本。
  if (/xbox|microsoft|045e|elite/.test(identity)) {
    return "xbox";
  }

  // 未知设备统一按 standard 手柄兜底。
  return "generic";
}

// 根据识别出的类型返回对应的映射配置。
export function mappingForGamepad(gamepad) {
  // 先识别类型，再选择不可变的映射对象。
  const type = identifyGamepadType(gamepad);

  // PS5 使用 DualSense 映射配置。
  if (type === "ps5") return PS5_DUALSENSE_MAPPING;

  // Xbox 使用 Elite 2 映射配置。
  if (type === "xbox") return XBOX_ELITE_2_MAPPING;

  // 其他手柄使用 standard 通用配置。
  return GENERIC_STANDARD_MAPPING;
}

// 读取手柄的按钮和十字键，并转换成项目内部使用的控制名称数组。
function buttonControls(gamepad, mapping) {
  // 用来收集当前这一帧被按下的控制名称。
  const controls = [];

  // 读取普通按钮；index 会对应 buttons[0]、buttons[1]……。
  mapping.buttons.forEach((control, index) => {
    if (pressed(gamepad.buttons?.[index])) controls.push(control);
  });

  // 读取十字键；standard 布局的十字键从 buttons[12] 开始。
  mapping.dpad.forEach((control, index) => {
    if (pressed(gamepad.buttons?.[index + 12])) controls.push(control);
  });

  // 返回例如 ["B", "L", "DPAD_UP"] 的控制名称数组。
  return controls;
}

/**
 * 将浏览器 Gamepad 对象转换成项目内部的控制器报告。
 *
 * @param {Gamepad} gamepad 浏览器 Gamepad API 返回的手柄对象。
 * @param {object} options 可选配置。
 * @param {number} options.deadzone 摇杆死区，默认 0.16。
 * @param {object} options.mapping 手动指定映射；不传时自动识别。
 * @returns {{report: object, controls: string[]}} 报告和页面控制名称。
 */
export function gamepadToReport(gamepad, {
  // 过滤摇杆中心附近的漂移。
  deadzone = 0.16,

  // 不指定时，根据手柄 id 自动选择 Xbox、PS5 或通用映射。
  mapping,
} = {}) {
  // mapping 为 null/undefined 时自动选择；显式传入的映射优先级更高。
  const resolvedMapping = mapping ?? mappingForGamepad(gamepad);

  // 取出四个摇杆在 Gamepad.axes 数组中的位置。
  const [leftX, leftY, rightX, rightY] = resolvedMapping.axes;

  // 先读取这一帧的按钮和十字键状态。
  const controls = buttonControls(gamepad, resolvedMapping);

  // 生成项目内部的标准化控制器报告。
  const report = normalizeControllerReport({
    // 将控制名称转换成 Switch 报告中的 bit mask。
    // bit 位置必须与 manual-input.js 中的 BUTTON_BITS 保持一致。
    buttons: controls.reduce((value, control) => {
      const bit = {
        Y: 0, // Switch Y
        B: 1, // Switch B
        A: 2, // Switch A
        X: 3, // Switch X
        L: 4, // Switch L
        R: 5, // Switch R
        ZL: 6, // Switch ZL
        ZR: 7, // Switch ZR
        MINUS: 8, // Switch Minus
        PLUS: 9, // Switch Plus
        L_STICK_PRESS: 10, // 左摇杆按下
        R_STICK_PRESS: 11, // 右摇杆按下
        HOME: 12, // Home
        CAPTURE: 13, // Capture
      }[control];

      // 未在 bit 表中的控制不会影响按钮掩码。
      return bit === undefined ? value : value | (1 << bit);
    }, 0),

    // 按“上右下左”的组合优先级，把十字键控制名称转换成 0~7/15。
    // 斜方向的数值与 manual-input.js 的 dpadValue 保持一致。
    dpad: controls.includes("DPAD_UP") && controls.includes("DPAD_RIGHT") ? 1
      : controls.includes("DPAD_RIGHT") && controls.includes("DPAD_DOWN") ? 3
        : controls.includes("DPAD_DOWN") && controls.includes("DPAD_LEFT") ? 5
          : controls.includes("DPAD_LEFT") && controls.includes("DPAD_UP") ? 7
            : controls.includes("DPAD_UP") ? 0
              : controls.includes("DPAD_RIGHT") ? 2
                : controls.includes("DPAD_DOWN") ? 4
                  : controls.includes("DPAD_LEFT") ? 6 : 15,

    // 将四个浮点摇杆轴转换成 ESP32 需要的 0~255。
    leftX: axisToByte(gamepad.axes?.[leftX], deadzone),
    leftY: axisToByte(gamepad.axes?.[leftY], deadzone),
    rightX: axisToByte(gamepad.axes?.[rightX], deadzone),
    rightY: axisToByte(gamepad.axes?.[rightY], deadzone),
  });

  // report 用于发送给 ESP32；controls 用于高亮网页上的虚拟手柄。
  return { report, controls: controlsForReport(report) };
}

// 比较两份控制器报告是否完全相同。
// 只有报告发生变化时才需要通知页面和 ESP32，避免重复发送相同数据。
export function reportsEqual(left, right) {
  // 需要比较的字段覆盖按钮、十字键和四个摇杆轴。
  return ["buttons", "dpad", "leftX", "leftY", "rightX", "rightY"]
    .every((key) => left?.[key] === right?.[key]);
}

// 生成给用户看的手柄描述文本。
export function describeGamepad(gamepad) {
  // 没有手柄时显示明确的未连接状态。
  if (!gamepad) return "未连接实体手柄";

  // 根据设备 id 选择 Xbox、PS5 或通用名称。
  const mapping = mappingForGamepad(gamepad);

  // mapping = standard 说明浏览器已经完成标准化按钮布局；
  // 空字符串或其他值表示浏览器返回的是自定义布局。
  const layout = gamepad.mapping === "standard" ? "标准布局" : "自定义布局";

  // 同时显示项目识别结果、系统设备名和布局类型，方便排查兼容性问题。
  return `${mapping.name} · ${gamepad.id || "未知手柄"} · ${layout}`;
}

/**
 * GamepadInputSource 负责手柄输入的生命周期和轮询。
 *
 * 浏览器不会为每一次摇杆变化都可靠地触发独立事件，
 * 因此这里使用 requestAnimationFrame 周期性读取 navigator.getGamepads()。
 */
export class GamepadInputSource {
  constructor({
    // 每当当前手柄报告改变时调用，页面可用它更新高亮或录制宏。
    onChange = () => {},

    // 当手柄列表发生增删时调用，页面可用它刷新下拉选择器。
    onDevices = () => {},

    // 事件目标通常是 window；测试环境可以注入一个假的事件对象。
    eventTarget = globalThis.window,

    // 读取当前连接的全部手柄；测试环境可以注入模拟数据。
    getGamepads = () => globalThis.navigator?.getGamepads?.() || [],

    // 使用 requestAnimationFrame，测试环境可以注入自己的调度函数。
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),

    // 停止轮询时取消未执行的动画帧。
    cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
  } = {}) {
    // 保存页面传入的回调和浏览器能力。
    this.onChange = onChange;
    this.onDevices = onDevices;
    this.eventTarget = eventTarget;
    this.getGamepads = getGamepads;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;

    // running 表示是否正在轮询。
    this.running = false;

    // frame 保存当前 requestAnimationFrame 的句柄。
    this.frame = null;

    // selectedIndex 保存用户选择的手柄 index；null 表示自动选择。
    this.selectedIndex = null;

    // lastReport 用来过滤连续的重复报告。
    this.lastReport = null;

    // lastDevicesSignature 用来判断手柄列表是否发生变化。
    this.lastDevicesSignature = "";

    // 浏览器通知有新手柄接入时，立即轮询一次。
    this.handleConnected = () => this.poll();

    // 手柄断开时，如果断开的是当前选中的手柄，先发送安全的中立报告。
    this.handleDisconnected = (event) => {
      if (event.gamepad?.index === this.selectedIndex) this.emitNeutral();
      this.poll();
    };
  }

  // 开始监听手柄事件并启动 requestAnimationFrame 轮询。
  start() {
    // 避免重复注册事件和启动多个轮询循环。
    if (this.running) return;

    // 标记为运行状态。
    this.running = true;

    // 监听手柄连接和断开事件。
    this.eventTarget?.addEventListener?.("gamepadconnected", this.handleConnected);
    this.eventTarget?.addEventListener?.("gamepaddisconnected", this.handleDisconnected);

    // 启动第一帧，后续帧会由 schedule 递归安排。
    this.schedule();
  }

  // 停止轮询、移除事件监听，并释放当前手柄输入。
  stop() {
    // 已经停止时不重复执行清理。
    if (!this.running) return;

    // 先停止后续动画帧。
    this.running = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;

    // 移除连接/断开事件监听，避免页面销毁后仍然回调。
    this.eventTarget?.removeEventListener?.("gamepadconnected", this.handleConnected);
    this.eventTarget?.removeEventListener?.("gamepaddisconnected", this.handleDisconnected);

    // 停止时发送一次中立报告，防止按键卡在按下状态。
    this.emitNeutral();

    // 通知页面当前没有可用手柄。
    this.onDevices([]);
  }

  // 选择指定 index 的手柄；传入空值后恢复自动选择第一个手柄。
  select(index) {
    // select 的值可能来自 HTML select，因此可能是空字符串。
    this.selectedIndex = index === "" || index === null ? null : Number(index);

    // 切换设备后强制下一次报告发送，避免沿用旧设备的 lastReport。
    this.lastReport = null;
    this.poll();
  }

  // 安排下一次动画帧。
  schedule() {
    // running 变成 false 后不再安排新的帧。
    if (this.running) this.frame = this.requestFrame(() => {
      // 当前帧已经开始执行，因此清空句柄。
      this.frame = null;

      // 读取一次手柄状态。
      this.poll();

      // 继续安排下一帧。
      this.schedule();
    });
  }

  // 读取全部手柄、选择目标手柄并在报告变化时通知页面。
  poll() {
    // getGamepads 可能返回带空洞的数组，所以先展开并过滤空对象。
    const devices = [...(this.getGamepads() || [])]
      .filter((gamepad) => Boolean(gamepad && gamepad.connected !== false));

    // 设备签名只使用 index 和 id；手柄输入变化不会触发设备列表回调。
    const signature = devices.map((gamepad) => `${gamepad.index}:${gamepad.id}`).join("|");

    // 设备列表有变化时刷新页面中的手柄选择器。
    if (signature !== this.lastDevicesSignature) {
      this.lastDevicesSignature = signature;
      this.onDevices(devices);
    }

    // 没有手柄时释放全部输入并结束本次轮询。
    if (!devices.length) {
      this.emitNeutral();
      return;
    }

    // 优先使用用户选中的手柄；选中设备不存在时退回第一个可用手柄。
    const gamepad = devices.find((candidate) => candidate.index === this.selectedIndex) || devices[0];

    // 自动选择或原手柄断开后，更新当前选中的 index。
    if (this.selectedIndex === null || !devices.some((candidate) => candidate.index === this.selectedIndex)) {
      this.selectedIndex = gamepad.index;
    }

    // 根据设备类型自动取得 Xbox、PS5 或通用的按键映射。
    const next = gamepadToReport(gamepad, { mapping: mappingForGamepad(gamepad) });

    // 只有输入确实变化时才通知页面，减少重复渲染和重复串口发送。
    if (!reportsEqual(this.lastReport, next.report)) {
      // 保存本次报告，作为下一次比较的基准。
      this.lastReport = next.report;

      // 同时把原始手柄对象、标准报告、页面控制名称和串口命令传出去。
      this.onChange({
        connected: true,
        gamepad,
        report: next.report,
        controls: next.controls,
        command: controllerReportCommand(next.report),
      });
    }
  }

  // 发送安全的中立报告，统一处理断开、停止和没有手柄三种情况。
  emitNeutral() {
    // 如果已经是中立状态，不重复通知页面。
    if (reportsEqual(this.lastReport, NEUTRAL_GAMEPAD_REPORT)) return;

    // 保存中立报告，阻止下一次重复发送。
    this.lastReport = NEUTRAL_GAMEPAD_REPORT;

    // connected = false 让页面知道当前不是有效的实体手柄输入。
    this.onChange({
      connected: false,
      gamepad: null,
      report: NEUTRAL_GAMEPAD_REPORT,
      controls: [],
      command: controllerReportCommand(NEUTRAL_GAMEPAD_REPORT),
    });
  }
}
