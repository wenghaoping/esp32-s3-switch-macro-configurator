<script setup>
import { computed, ref, watch } from "vue";
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
import { createDefaultTaskPlan, describeTaskPlan, MAX_TASK_ENTRIES, normalizeTaskPlan, validateTaskPlan } from "../utils/task-plan.js";
const device = useDeviceStore();
const draft = ref(createDefaultTaskPlan(device.slots));
const message = ref(""); const saving = ref(false);
const sourceLabel = (slot) => !slot.confirmed && slot.source === "builtin" ? "新版固件内置 · 待设备确认" : ({ builtin: "C++ 内置", stored: "Flash 保存", empty: "空槽位" }[slot.source] || slot.source);
const referenced = computed(() => new Set(draft.value.entries.map((entry) => entry.slot)));
const description = computed(() => describeTaskPlan(draft.value, device.slots));
watch(() => device.taskPlan, (value) => { if (value) draft.value = normalizeTaskPlan(value); }, { immediate: true });
function addEntry() { const slot = device.slots.find((item) => item.occupied && item.confirmed)?.slot; if (slot !== undefined && draft.value.entries.length < MAX_TASK_ENTRIES) draft.value.entries.push({ slot, repeatCount: 1, gapMs: 0 }); }
function removeEntry(index) { draft.value.entries.splice(index, 1); }
function moveEntry(index, offset) { const target = index + offset; if (target < 0 || target >= draft.value.entries.length) return; const [entry] = draft.value.entries.splice(index, 1); draft.value.entries.splice(target, 0, entry); }
async function save() { const errors = validateTaskPlan(draft.value, device.slots); if (errors.length) { message.value = errors[0]; return; } saving.value = true; message.value = "正在写入开发板…"; try { await device.saveTask(draft.value); message.value = "宏循环已保存到 ESP32。"; } catch (error) { message.value = error.message; } finally { saving.value = false; } }
async function removeTask() { if (!confirm("确定删除当前宏循环吗？")) return; await device.deleteTask(); draft.value = createDefaultTaskPlan(device.slots); }
</script>
<template>
  <PageTitle eyebrow="MACRO SETTINGS / 宏设置" title="宏和循环，各自清楚。" description="宏负责一轮完整动作；宏循环负责多个宏的顺序、次数以及是否从头循环。" />
  <section>
<div class="section-head">
<div>
<p class="eyebrow">BOARD LIBRARY / 十二个槽位</p>
<h2>板载宏</h2>
</div>
<span class="muted">Flash 保存版本优先于同槽位的 C++ 内置版本</span>
</div>
<div class="slot-grid manager-slots">
<article v-for="slot in device.slots" :key="slot.slot" class="slot-card" :class="{ empty: !slot.occupied, referenced: referenced.has(slot.slot) }">
<div class="slot-top">
<span>槽位 {{ slot.slot+1 }}</span>
<i v-if="referenced.has(slot.slot)">宏循环引用中</i>
</div>
<h3>{{ slot.occupied ? slot.name : '空槽位' }}</h3>
<p>{{ sourceLabel(slot) }}</p>
<dl v-if="slot.occupied">
<div>
<dt>动作</dt>
<dd>{{ slot.steps }} 个</dd>
</div>
<div>
<dt>单轮</dt>
<dd>{{ Math.round((slot.duration_ms || 0)/1000) }} 秒</dd>
</div>
<div>
<dt>整轮间隔</dt>
<dd>{{ slot.loop_gap_ms || 0 }} ms</dd>
</div>
</dl>
<div class="action-row">
<RouterLink class="secondary button-link" :to="`/scripts/${slot.slot}/edit`">{{ slot.occupied ? '载入编辑' : '新建宏' }}</RouterLink>
<button v-if="slot.has_stored && slot.has_builtin" @click="device.restoreMacro(slot.slot)">恢复内置</button>
<button v-if="slot.has_stored && !slot.has_builtin" class="danger-text" @click="device.deleteMacro(slot.slot)">删除</button>
</div>
</article>
</div>
</section>
  <section class="task-editor">
<div class="section-head">
<div>
<p class="eyebrow">MACRO LOOP / 板载宏循环</p>
<h2>按顺序运行多个宏</h2>
<p class="muted">开发板目前保存一套宏循环，最多包含 5 项。保存后到控制页点击“运行宏循环”。</p>
</div>
<label class="switch">
<input v-model="draft.repeat" type="checkbox">
<span>完成后从头大循环</span>
</label>
</div>
    <label class="field">
<span>宏循环名称</span>
<input v-model.trim="draft.name" maxlength="32" placeholder="例如：素材循环方案">
</label>
    <div class="task-list">
<article v-for="(entry,index) in draft.entries" :key="index" class="task-row">
<div class="task-order"><b>{{ index+1 }}</b><div><button :disabled="index===0" aria-label="向上移动" @click="moveEntry(index,-1)">↑</button><button :disabled="index===draft.entries.length-1" aria-label="向下移动" @click="moveEntry(index,1)">↓</button></div></div>
<label class="field">
<span>板载宏</span>
<select v-model.number="entry.slot">
<option v-for="slot in device.slots.filter(item => item.occupied && item.confirmed)" :key="slot.slot" :value="slot.slot">槽位 {{ slot.slot+1 }} · {{ slot.name }} · {{ sourceLabel(slot) }}</option>
</select>
</label>
<label class="field narrow">
<span>完整运行次数</span>
<input v-model.number="entry.repeatCount" type="number" min="1" max="10000">
</label>
<label class="field narrow">
<span>完成后等待 (ms)</span>
<input v-model.number="entry.gapMs" type="number" min="0" max="600000" step="100">
</label>
<button class="remove" @click="removeEntry(index)" aria-label="删除任务项">×</button>
</article>
</div>
    <button class="secondary" :disabled="draft.entries.length >= MAX_TASK_ENTRIES || !device.slots.some(slot => slot.occupied && slot.confirmed)" @click="addEntry">＋ 添加宏</button>
<p class="muted">最多 5 项；同一个宏可以重复选择。当前草稿必须先保存到槽位，才会出现在上方选择器。</p>
    <div class="plan-preview">
<b>执行预览</b>
<p>{{ description }}</p>
</div>
<p v-if="message" class="form-message">{{ message }}</p>
<div class="action-row">
<button class="primary" :disabled="!device.ready || saving" @click="save">{{ saving ? '保存中…' : '保存到开发板' }}</button>
<button v-if="device.taskPlan" class="danger-text" @click="removeTask">删除宏循环</button>
</div>
  </section>
</template>
