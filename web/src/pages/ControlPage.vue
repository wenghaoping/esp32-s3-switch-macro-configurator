<script setup>
import { computed } from "vue";
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
import VirtualGamepad from "../components/VirtualGamepad.vue";
import { describeCurrentAction } from "../utils/action-description.js";
const device = useDeviceStore();
const sourceLabel = (source) => ({ builtin: "C++ 内置", stored: "Flash 保存", empty: "空槽位" }[source] || source);
const currentAction = computed(() => describeCurrentAction(device.status));
</script>
<template>
  <PageTitle eyebrow="CONTROL CENTER / 控制中心" title="运行状态，一眼看清。" description="单独启动宏会持续运行；需要按次数依次运行多个宏时，请使用宏循环。" />
  <section class="control-layout">
    <article class="mission-card">
      <div class="section-head">
<div>
<span class="tag">CURRENT / 当前运行</span>
<h2>{{ device.activeName }}</h2>
<p>{{ sourceLabel(device.status.running_source || device.status.source) }}</p>
</div>
<span class="status-badge" :data-state="device.running ? 'running' : 'idle'">{{ device.running ? '运行中' : '待命' }}</span>
</div>
      <div class="facts">
<div>
<span>动作进度</span>
<strong>{{ device.status.step || 0 }} / {{ device.status.steps || 0 }}</strong>
</div>
<div>
<span>宏轮次</span>
<strong>{{ device.status.cycle || 0 }}</strong>
</div>
<div>
<span>单轮时长</span>
<strong>{{ Math.round((device.status.cycle_ms || 0)/1000) }} 秒</strong>
</div>
<div class="current-action-fact">
<span>当前动作</span>
<strong>{{ currentAction.title }}</strong>
<small>{{ currentAction.timing }}</small>
</div>
</div>
      <progress :max="device.status.steps || 1" :value="device.status.step || 0">
</progress>
      <div v-if="device.status.task_active" class="task-live">
<b>{{ device.status.task_name }}</b>
<p>大循环第 {{ (device.status.task_cycle || 0)+1 }} 轮 · 第 {{ device.status.task_entry }}/{{ device.status.task_entries }} 项</p>
<p>当前宏第 {{ device.status.task_iteration }}/{{ device.status.task_target_iterations }} 次<span v-if="device.status.next_name"> · 下一项：{{ device.status.next_name }}</span>
</p>
</div>
      <div class="action-row">
<button v-if="!device.connected" class="primary" @click="device.connect()">连接设备</button>
<button class="danger" :disabled="!device.ready || !device.running" @click="device.stop()">立即停止</button>
<button class="primary" :disabled="!device.ready || !device.taskPlan" @click="device.runTask()">运行宏循环</button>
</div>
    </article>
    <article class="task-summary">
<span class="tag">MACRO LOOP / 宏循环</span>
<h2>{{ device.taskPlan?.name || '尚未配置宏循环' }}</h2>
<template v-if="device.taskPlan">
<ol>
<li v-for="(entry,index) in device.taskPlan.entries" :key="index">
<b>{{ device.slots[entry.slot]?.name }}</b>
<span>完整运行 {{ entry.repeatCount }} 次</span>
</li>
</ol>
<p>{{ device.taskPlan.repeat ? '全部执行完后回到第一项，持续循环' : '全部宏执行一次后停止' }}</p>
</template>
<RouterLink v-else to="/scripts" class="secondary button-link">去宏设置中配置</RouterLink>
</article>
  </section>
  <section>
<div class="section-head">
<div>
<p class="eyebrow">BOARD MACROS / 快捷运行</p>
<h2>宏槽位</h2>
</div>
<span class="muted">点击后持续循环，直到停止</span>
</div>
<div class="slot-grid">
<article v-for="slot in device.slots" :key="slot.slot" class="slot-card" :class="{ empty: !slot.occupied }">
<span>槽位 {{ slot.slot+1 }}</span>
<h3>{{ slot.occupied ? slot.name : '空槽位' }}</h3>
<p>{{ sourceLabel(slot.source) }}<template v-if="slot.occupied"> · {{ slot.steps }} 步</template>
</p>
<button :disabled="!device.ready || !slot.occupied || !slot.confirmed" @click="device.runSlot(slot.slot)">持续运行</button>
</article>
</div>
</section>
  <section class="manual-section">
<div class="section-head">
<div>
<p class="eyebrow">MANUAL OVERRIDE / 手动接管</p>
<h2>需要补一刀？自己来。</h2>
</div>
<span class="muted">手动输入只临时接管，不会停止宏</span>
</div>
<VirtualGamepad :disabled="!device.ready" @change="device.manual" />
</section>
  <section class="wiring-card">
<div>
<p class="eyebrow">GEAR CHECK / 双链路</p>
<h2>两根线，各干一件事。</h2>
</div>
<div>
<b>① 原生 USB → Switch 底座</b>
<p>负责模拟有线手柄。</p>
</div>
<div>
<b>② USB-UART → 电脑</b>
<p>网页配置、发令并读取状态。</p>
</div>
</section>
</template>
