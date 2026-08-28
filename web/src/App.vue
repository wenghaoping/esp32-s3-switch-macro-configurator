<script setup>
import { useDeviceStore } from "./stores/device.js";
const device = useDeviceStore();
</script>

<template>
  <div class="app-shell">
    <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div>
    <header class="topbar">
      <RouterLink class="brand" to="/"><b>S3</b><span><strong>ESP32-S3 Configurator</strong><small>板载宏控制台</small></span></RouterLink>
      <nav aria-label="主导航">
        <RouterLink to="/">首页</RouterLink><RouterLink to="/control">控制</RouterLink>
        <RouterLink to="/scripts">宏设置</RouterLink><RouterLink to="/recorder">录制</RouterLink>
        <RouterLink to="/device">设备</RouterLink>
      </nav>
      <button class="connection-pill" :data-state="device.ready ? 'online' : 'offline'" @click="device.connected ? device.disconnect() : device.connect()">
        <i></i>{{ device.connecting ? '连接中…' : device.ready ? '设备可用' : device.connected ? '协议异常 · 点击断开' : '连接设备' }}
      </button>
    </header>
    <Transition name="toast"><div v-if="device.notification" class="operation-notice" :data-tone="device.notification.tone" role="status">{{ device.notification.tone === 'success' ? '✓' : '!' }} {{ device.notification.message }}</div></Transition>
    <p v-if="device.error" class="global-error" role="alert">{{ device.error }}</p>
    <main><RouterView /></main>
    <footer><span>SPECIALLY EDITED BY MMWENG</span><span>任务在板上运行，网页只负责配置与控制。</span></footer>
  </div>
</template>
