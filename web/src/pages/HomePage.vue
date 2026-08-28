<script setup>
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
const device = useDeviceStore();
const cards = [
  ["/control","控制中心","运行单个宏或已保存的宏循环，查看实时进度并手动补操作。","立即控制"],
  ["/scripts","宏设置","查看十二个板载槽位，编辑完整宏并配置一套最多五项的宏循环。","管理宏与循环"],
  ["/recorder","宏录制","使用中文虚拟手柄录制动作，预览后写入 Flash。","开始录制"],
  ["/device","设备与 GPIO","检查双 USB 接线、离线触发和宏库备份。","设备设置"],
];
</script>
<template>
  <PageTitle eyebrow="MISSION HUB / 首页" title="选一个目标，直接开始。" description="控制、宏设置、录制和设备设置已经拆分，不需要在一个长页面里寻找功能。">
    <div class="hero-actions">
<button v-if="!device.connected" class="primary" @click="device.connect()">连接 ESP32-S3</button>
<RouterLink v-else class="primary button-link" to="/control">进入控制中心</RouterLink>
</div>
  </PageTitle>
  <section class="status-strip">
    <div>
<span>设备</span>
<strong>{{ device.ready ? '已连接 · 可用' : device.connected ? 'USB 已连接 · 固件未响应' : '未连接' }}</strong>
</div>
    <div>
<span>当前宏</span>
<strong>{{ device.activeName }}</strong>
</div>
    <div>
<span>宏循环</span>
<strong>{{ device.taskPlan?.name || '尚未配置' }}</strong>
</div>
    <div>
<span>运行状态</span>
<strong>{{ device.running ? '运行中' : '待命' }}</strong>
</div>
  </section>
  <section class="entry-grid">
<RouterLink v-for="card in cards" :key="card[0]" :to="card[0]" class="entry-card">
<span class="card-no">0{{ cards.indexOf(card)+1 }}</span>
<h2>{{ card[1] }}</h2>
<p>{{ card[2] }}</p>
<b>{{ card[3] }} →</b>
</RouterLink>
</section>
  <section v-if="!device.connected" class="guide-card">
<p class="eyebrow">FIRST RUN / 初次使用</p>
<h2>三步开始</h2>
<ol>
<li>
<b>连接两根线</b>
<span>原生 USB 接 Switch，USB-UART 接电脑。</span>
</li>
<li>
<b>连接设备</b>
<span>使用桌面版 Chrome 或 Edge 选择开发板串口。</span>
</li>
<li>
<b>选择宏</b>
<span>单独持续运行，或配置一套最多五项的宏循环。</span>
</li>
</ol>
</section>
</template>
