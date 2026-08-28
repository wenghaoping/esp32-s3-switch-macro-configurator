<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
import VirtualGamepad from "../components/VirtualGamepad.vue";
import { MacroRecorder } from "../utils/macro-recorder.js";
import { createInputProbe, describeInputProbe, stopInputProbe, updateInputProbe } from "../utils/input-probe.js";
const device = useDeviceStore(); const router = useRouter(); const recorder = new MacroRecorder();
const name = ref(""); const targetSlot = ref(null); const recording = ref(false); const steps = ref([]); const active = ref([]); const elapsed = ref(0); const message = ref(""); const probe = ref(createInputProbe()); const clock = ref(performance.now()); let recordingTimer = null; let probeTimer = null; let appendMode = false;
const allSlots = computed(() => device.slots);
const firstEmptySlot = computed(() => allSlots.value.find((slot) => !slot.occupied)?.slot ?? 0);
const autoSelectedSlot = ref(null);
watch(firstEmptySlot, (slot) => { if (targetSlot.value === null || targetSlot.value === autoSelectedSlot.value) { targetSlot.value = slot; autoSelectedSlot.value = slot; } }, { immediate: true });
const probeDisplay = computed(() => describeInputProbe(probe.value, clock.value));
function start(append = false) { appendMode = append; active.value = []; recorder.start([], performance.now()); recording.value = true; elapsed.value = 0; message.value = "录制中：按住虚拟手柄按钮进行操作。"; recordingTimer = window.setInterval(() => elapsed.value = recorder.elapsedMs(performance.now()), 100); }
function change(controls) { const now = performance.now(); active.value = controls; if (recording.value) recorder.change(controls, now); else probe.value = updateInputProbe(probe.value, controls, now); if (device.ready) device.manual(controls).catch(() => {}); }
function stopProbeTimer() { const now = performance.now(); clock.value = now; probe.value = stopInputProbe(probe.value, now); }
function stop() { const recorded = recorder.stop(performance.now()); clearInterval(recordingTimer); recordingTimer = null; recording.value = false; steps.value = appendMode ? [...steps.value, ...recorded] : recorded; message.value = recorded.length ? `录制完成，共生成 ${recorded.length} 个动作。` : "没有录制到有效输入。"; }
function cancel() { recorder.cancel(); clearInterval(recordingTimer); recordingTimer = null; recording.value = false; message.value = "本次录制已取消。"; }
async function save() { if (!name.value.trim()) { message.value = "请先输入宏名称。"; return; } if (!steps.value.length) { message.value = "请先录制至少一个动作。"; return; } try { await device.saveMacro(targetSlot.value, name.value, { steps: steps.value, loopGapMs: 0, repeat: true }); message.value = "已写入 Flash，现在可以在宏设置中加入宏循环。"; } catch (error) { message.value = error.message; } }
function edit() { sessionStorage.setItem("splatoon-recorder-draft", JSON.stringify({ name: name.value, steps: steps.value })); router.push(`/scripts/${targetSlot.value}/edit`); }
const buttonVisuals = [[0,"Y","Y 按键"],[1,"B","B 按键"],[2,"A","A 按键"],[3,"X","X 按键"],[4,"L","L 肩键"],[5,"R","R 肩键"],[6,"ZL","ZL 肩键"],[7,"ZR","ZR 肩键"],[8,"−","减号键"],[9,"+","加号键"],[10,"L3","按下左摇杆"],[11,"R3","按下右摇杆"],[12,"⌂","主页键"],[13,"▣","截图键"]];
const directionVisuals = [["上","↑"],["右上","↗"],["右","→"],["右下","↘"],["下","↓"],["左下","↙"],["左","←"],["左上","↖"]];
function directionForAxes(x,y) { const vertical=y<128?"上":y>128?"下":""; const horizontal=x<128?"左":x>128?"右":""; const name=`${horizontal}${vertical}`; const normalized={"右上":"右上","左上":"左上","右下":"右下","左下":"左下"}[name]||name; return directionVisuals.find(([label])=>label===normalized); }
function visualTokens(step) { const tokens=[]; buttonVisuals.forEach(([bit,symbol,label])=>{if(step.buttons&(1<<bit))tokens.push({symbol,label});}); if(step.dpad!==15){const [label,symbol]=directionVisuals[step.dpad];tokens.push({symbol,label:`十字键${label}`});} const stick=(x,y,label)=>{if(x===128&&y===128)return;const direction=directionForAxes(x,y);if(direction)tokens.push({symbol:direction[1],label:`${label}${direction[0]}`});}; stick(step.leftX,step.leftY,"左摇杆");stick(step.rightX,step.rightY,"右摇杆");return tokens.length?tokens:[{symbol:"○",label:"松开全部按键"}]; }
function timingSummary(step) { return `保持 ${step.durationMs} 毫秒 → 松开后等待 ${step.waitMs || 0} 毫秒`; }
onMounted(() => { probeTimer = window.setInterval(() => { clock.value = performance.now(); }, 50); });
onBeforeUnmount(() => { clearInterval(recordingTimer); clearInterval(probeTimer); });
</script>
<template>
  <PageTitle class="recorder-page-title" eyebrow="MACRO RECORDER / 宏录制" title="看着手柄录，不用猜字段。" description="录制的是 Switch 样式虚拟手柄和键盘输入，不会读取外接实体手柄。新宏写入 Flash 后才能加入宏循环。" />
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
    <VirtualGamepad compact :disabled="false" @change="change" />
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
