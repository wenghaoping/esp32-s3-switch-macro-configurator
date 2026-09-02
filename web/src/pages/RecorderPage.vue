<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
import VirtualGamepad from "../components/VirtualGamepad.vue";
import { MacroRecorder, RECORDER_MODES } from "../utils/macro-recorder.js";
import { createInputProbe, describeInputProbe, stopInputProbe, updateInputProbe } from "../utils/input-probe.js";
import { GamepadInputSource, describeGamepad, identifyGamepadType, NEUTRAL_GAMEPAD_REPORT } from "../utils/gamepad-input.js";
import { buildManualReport, controlsForReport, normalizeControllerReport } from "../utils/manual-input.js";
const device = useDeviceStore(); const router = useRouter(); const recorder = new MacroRecorder();
const name = ref(""); const targetSlot = ref(null); const recording = ref(false); const recordingMode = ref(RECORDER_MODES.PRECISE); const steps = ref([]); const active = ref([]); const virtualControls = ref([]); const gamepadState = ref({ connected: false, gamepad: null, report: NEUTRAL_GAMEPAD_REPORT, controls: [] }); const gamepadDevices = ref([]); const selectedGamepadIndex = ref(null); const gamepadStarted = ref(false); const passthrough = ref(false); const elapsed = ref(0); const message = ref(""); const probe = ref(createInputProbe()); const clock = ref(performance.now()); let recordingTimer = null; let probeTimer = null; let appendMode = false; let gamepadSource = null;
const allSlots = computed(() => device.slots);
const firstEmptySlot = computed(() => allSlots.value.find((slot) => !slot.occupied)?.slot ?? 0);
const autoSelectedSlot = ref(null);
watch(firstEmptySlot, (slot) => { if (targetSlot.value === null || targetSlot.value === autoSelectedSlot.value) { targetSlot.value = slot; autoSelectedSlot.value = slot; } }, { immediate: true });
const probeDisplay = computed(() => describeInputProbe(probe.value, clock.value));
const gamepadDisplay = computed(() => describeGamepad(gamepadState.value.gamepad));
const gamepadHint = computed(() => gamepadState.value.connected
  ? `已读取：${gamepadDisplay.value}`
  : "请插入 Xbox Elite 2 或 PS5 DualSense，然后在当前页面按一下任意按键；浏览器可能要在页面获得焦点后才显示手柄。");
const recordingModeHint = computed(() => recordingMode.value === RECORDER_MODES.RIGHT_STICK_PULSE
  ? "视角模式：右摇杆只记录单轴固定方向，斜向输入按主轴处理，持续时间决定视角变化量。"
  : "精细模式：保留右摇杆的模拟量变化，适合需要控制力度的动作。");

function hasControl(prefix) {
  return virtualControls.value.some((control) => control.startsWith(prefix));
}

function currentReport() {
  const virtual = buildManualReport(virtualControls.value);
  const gamepad = gamepadState.value.report || NEUTRAL_GAMEPAD_REPORT;
  return normalizeControllerReport({
    buttons: virtual.buttons | gamepad.buttons,
    dpad: hasControl("DPAD_") ? virtual.dpad : gamepad.dpad,
    leftX: hasControl("LEFT_STICK_") ? virtual.leftX : gamepad.leftX,
    leftY: hasControl("LEFT_STICK_") ? virtual.leftY : gamepad.leftY,
    rightX: hasControl("RIGHT_STICK_") ? virtual.rightX : gamepad.rightX,
    rightY: hasControl("RIGHT_STICK_") ? virtual.rightY : gamepad.rightY,
  });
}

function processInput(now = performance.now()) {
  const report = currentReport();
  const controls = controlsForReport(report);
  active.value = controls;
  if (recording.value) recorder.changeReport(report, now);
  else probe.value = updateInputProbe(probe.value, controls, now);
  if (device.ready && (passthrough.value || recording.value)) device.manualReport(report).catch(() => {});
}

function change(controls) {
  virtualControls.value = [...controls];
  processInput();
}

function handleGamepad(state) {
  gamepadState.value = state;
  if (state.gamepad) selectedGamepadIndex.value = state.gamepad.index;
  processInput();
  if (!state.connected && recording.value) message.value = "实体手柄已断开，已自动释放按键；请重新连接后继续。";
}

function startGamepad() {
  if (gamepadStarted.value) return;
  if (!("getGamepads" in navigator)) {
    message.value = "当前浏览器不支持 Gamepad API，请使用桌面版 Chrome 或 Edge。";
    return;
  }
  gamepadSource = new GamepadInputSource({
    onChange: handleGamepad,
    onDevices: (devices) => { gamepadDevices.value = devices.map((gamepad) => ({ index: gamepad.index, id: gamepad.id, mapping: gamepad.mapping, connected: gamepad.connected, type: identifyGamepadType(gamepad) })); },
  });
  gamepadSource.start();
  gamepadStarted.value = true;
}

function selectGamepad() {
  gamepadSource?.select(selectedGamepadIndex.value);
}

function scanGamepads() {
  startGamepad();
  gamepadSource?.poll();
  message.value = "已重新扫描实体手柄；请在当前页面按一下 Xbox 或 PS5 手柄按键。";
}

async function togglePassthrough() {
  if (!device.ready) {
    passthrough.value = false;
    message.value = "请先连接并准备好 ESP32，再开启实体手柄直通。";
    return;
  }
  if (passthrough.value) {
    await device.stop().catch(() => {});
    processInput();
    return;
  }
  await device.manualReport(NEUTRAL_GAMEPAD_REPORT).catch(() => {});
}

function start(append = false) { appendMode = append; recorder.setMode(recordingMode.value); const now = performance.now(); recorder.start(currentReport(), now); recording.value = true; elapsed.value = 0; message.value = recordingMode.value === RECORDER_MODES.RIGHT_STICK_PULSE ? "录制中：右摇杆使用固定单轴视角脉冲。" : "录制中：可使用 Xbox Elite 2、PS5 DualSense 或网页手柄操作。"; recordingTimer = window.setInterval(() => elapsed.value = recorder.elapsedMs(performance.now()), 100); processInput(now); }
function stop() { const recorded = recorder.stop(performance.now()); clearInterval(recordingTimer); recordingTimer = null; recording.value = false; steps.value = appendMode ? [...steps.value, ...recorded] : recorded; if (device.ready) device.manualReport(NEUTRAL_GAMEPAD_REPORT).catch(() => {}); message.value = recorded.length ? `录制完成，共生成 ${recorded.length} 个动作。` : "没有录制到有效输入。"; }
function cancel() { recorder.cancel(); clearInterval(recordingTimer); recordingTimer = null; recording.value = false; if (device.ready) device.manualReport(NEUTRAL_GAMEPAD_REPORT).catch(() => {}); message.value = "本次录制已取消。"; }
function stopProbeTimer() { const now = performance.now(); clock.value = now; probe.value = stopInputProbe(probe.value, now); }
async function save() { if (!name.value.trim()) { message.value = "请先输入宏名称。"; return; } if (!steps.value.length) { message.value = "请先录制至少一个动作。"; return; } try { await device.saveMacro(targetSlot.value, name.value, { steps: steps.value, loopGapMs: 0, repeat: true }); message.value = "已写入 Flash，现在可以在宏设置中加入宏循环。"; } catch (error) { message.value = error.message; } }
function edit() { sessionStorage.setItem("splatoon-recorder-draft", JSON.stringify({ name: name.value, steps: steps.value })); router.push(`/scripts/${targetSlot.value}/edit`); }
const buttonVisuals = [[0,"Y","Y 按键"],[1,"B","B 按键"],[2,"A","A 按键"],[3,"X","X 按键"],[4,"L","L 肩键"],[5,"R","R 肩键"],[6,"ZL","ZL 肩键"],[7,"ZR","ZR 肩键"],[8,"−","减号键"],[9,"+","加号键"],[10,"L3","按下左摇杆"],[11,"R3","按下右摇杆"],[12,"⌂","主页键"],[13,"▣","截图键"]];
const directionVisuals = [["上","↑"],["右上","↗"],["右","→"],["右下","↘"],["下","↓"],["左下","↙"],["左","←"],["左上","↖"]];
function directionForAxes(x,y) { const vertical=y<128?"上":y>128?"下":""; const horizontal=x<128?"左":x>128?"右":""; const name=`${horizontal}${vertical}`; const normalized={"右上":"右上","左上":"左上","右下":"右下","左下":"左下"}[name]||name; return directionVisuals.find(([label])=>label===normalized); }
function visualTokens(step) { const tokens=[]; buttonVisuals.forEach(([bit,symbol,label])=>{if(step.buttons&(1<<bit))tokens.push({symbol,label});}); if(step.dpad!==15){const [label,symbol]=directionVisuals[step.dpad];tokens.push({symbol,label:`十字键${label}`});} const stick=(x,y,label)=>{if(x===128&&y===128)return;const direction=directionForAxes(x,y);if(direction)tokens.push({symbol:direction[1],label:`${label}${direction[0]}`});}; stick(step.leftX,step.leftY,"左摇杆");stick(step.rightX,step.rightY,"右摇杆");return tokens.length?tokens:[{symbol:"○",label:"松开全部按键"}]; }
function timingSummary(step) { return `保持 ${step.durationMs} 毫秒 → 松开后等待 ${step.waitMs || 0} 毫秒`; }
onMounted(() => { probeTimer = window.setInterval(() => { clock.value = performance.now(); }, 50); startGamepad(); });
onBeforeUnmount(() => { clearInterval(recordingTimer); clearInterval(probeTimer); gamepadSource?.stop(); });
</script>
<template>
  <PageTitle class="recorder-page-title" eyebrow="MACRO RECORDER / 宏录制" title="看着手柄录，不用猜字段。" description="支持网页手柄、键盘、Xbox Elite 2 和 PS5 DualSense；实体手柄输入会映射到下方 Switch 手柄示例。新宏写入 Flash 后才能加入宏循环。" />
  <section class="recorder-flow">
<div class="flow-steps">
<span :class="{active:!recording&&!steps.length}">1 命名</span>
<span :class="{active:recording}">2 录制</span>
<span :class="{active:!recording&&steps.length}">3 预览并保存</span>
</div>
<div class="recorder-meta">
<label class="field">
<span>宏名称</span>
<input v-model.trim="name" maxlength="32" placeholder="例如：补充路线">
</label>
<label class="field">
<span>保存到槽位（默认第一个空槽位）</span>
<select v-model.number="targetSlot">
<option v-for="slot in allSlots" :key="slot.slot" :value="slot.slot">槽位 {{ slot.slot+1 }} · {{ slot.occupied ? slot.name : '空槽位' }}</option>
</select>
</label>
<label class="field">
<span>手柄录制模式</span>
<select v-model="recordingMode" :disabled="recording">
<option :value="RECORDER_MODES.PRECISE">精细模拟量</option>
<option :value="RECORDER_MODES.RIGHT_STICK_PULSE">视角固定脉冲</option>
</select>
</label>
<div class="record-clock">
<span>{{ recording ? '正在录制' : '录制时长' }}</span>
<strong>{{ (elapsed/1000).toFixed(1) }} 秒</strong>
</div>
</div>
    <div class="action-row recorder-actions">
<button v-if="!recording" class="record" @click="start(false)">● 开始录制</button>
<button v-if="recording" class="danger" @click="stop">■ 停止并保留</button>
<button v-if="recording" class="secondary" @click="cancel">取消</button>
<button v-if="!recording&&steps.length" class="secondary" @click="start(true)">追加录制</button>
<aside v-if="!recording" class="input-probe"><span>LIVE INPUT / 免录制按键测试</span><strong>{{ probeDisplay.title }}</strong><small>{{ probeDisplay.timing }}</small><button class="mini-button" :disabled="!probe.signature || probe.stopped" @click="stopProbeTimer">{{ probe.stopped ? '计时已停止' : '停止计时' }}</button></aside>
</div>
    <section class="gamepad-panel">
      <div>
        <span class="eyebrow">EXTERNAL GAMEPAD / 实体手柄</span>
        <strong>{{ gamepadHint }}</strong>
        <small>Xbox 与 PS5 都按实体位置映射：上/左/下/右分别对应 Switch X/Y/B/A；肩键、扳机、十字键和双摇杆保持对应。</small>
        <small class="gamepad-detection-tip"><b>检测提示：</b>连接或唤醒实体手柄后，请在当前页面按一下任意按键，浏览器才会开始检测手柄。</small>
        <small class="recording-mode-hint">{{ recordingModeHint }}</small>
      </div>
      <div class="gamepad-panel-actions">
        <button class="secondary" @click="scanGamepads">{{ gamepadStarted ? '重新扫描手柄' : '扫描实体手柄' }}</button>
        <select class="gamepad-select" v-model="selectedGamepadIndex" aria-label="选择实体手柄" @change="selectGamepad">
          <option :value="null">自动选择第一个手柄</option>
          <option v-for="gamepad in gamepadDevices" :key="gamepad.index" :value="gamepad.index">{{ gamepad.type === 'ps5' ? 'PS5 DualSense' : gamepad.type === 'xbox' ? 'Xbox Elite 2' : '标准手柄' }} · {{ gamepad.id || `手柄 ${gamepad.index}` }}</option>
        </select>
        <label class="switch gamepad-passthrough">
          <input v-model="passthrough" type="checkbox" :disabled="!device.ready" @change="togglePassthrough">
          <span>{{ passthrough ? '✓ 实体手柄直通 Switch 已开启' : '实体手柄直通 Switch' }}</span>
        </label>
      </div>
    </section>
    <section class="recording-mode-guide" aria-label="录制模式说明">
      <div class="recording-mode-guide-title">
        <span class="eyebrow">RECORDING MODES / 录制模式</span>
        <strong>根据动作类型选择记录方式</strong>
      </div>
      <div class="recording-mode-options">
        <article :class="{ active: recordingMode === RECORDER_MODES.PRECISE }">
          <div><span class="mode-dot precise"></span><strong>精细模拟量</strong><em>保留力度</em></div>
          <p>保留摇杆的主要力度和连续变化，适合视角微调或需要控制摇杆力度的动作；步骤可能较多。</p>
        </article>
        <article :class="{ active: recordingMode === RECORDER_MODES.RIGHT_STICK_PULSE }">
          <div><span class="mode-dot pulse"></span><strong>视角固定脉冲</strong><em>固定方向</em></div>
          <p>右摇杆只记录上、下、左、右满幅方向，靠保持毫秒数控制视角，并自动规避右上、左下等斜向误差。</p>
        </article>
      </div>
    </section>
    <VirtualGamepad compact :disabled="false" :external-controls="gamepadState.controls" @change="change" />
    <p class="form-message">{{ message }}</p>
  </section>
  <section v-if="steps.length" class="record-preview">
<div class="section-head">
<div>
<p class="eyebrow">ACTION PREVIEW / 动作预览</p>
<h2>{{ steps.length }} 个动作</h2>
</div>
<button class="danger-text" @click="steps=[]">清空重录</button>
</div>
<ol>
<li v-for="(step,index) in steps" :key="index">
<b>{{ index+1 }}</b>
<div><div class="action-visuals"><span v-for="token in visualTokens(step)" :key="token.label" class="action-token"><i>{{ token.symbol }}</i><em>{{ token.label }}</em></span></div><p>{{ timingSummary(step) }}</p></div>
</li>
</ol>
<div class="action-row">
<button class="primary" :disabled="!device.ready" @click="save">写入 Flash</button>
<button class="secondary" @click="edit">进入详细编辑</button>
</div>
</section>
</template>
