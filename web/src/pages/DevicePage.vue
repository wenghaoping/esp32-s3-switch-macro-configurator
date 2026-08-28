<script setup>
import { computed, ref, watch } from "vue";
import { useDeviceStore } from "../stores/device.js";
import PageTitle from "../components/PageTitle.vue";
import { cloneTriggerConfig, defaultTriggerConfig, LIBRARY_FORMAT, LIBRARY_VERSION, normalizeLibraryDocument, SAFE_TRIGGER_PINS, serializeTriggerConfig, TASK_TRIGGER_SLOT } from "../utils/library-manager.js";
const device = useDeviceStore(); const triggers = ref(defaultTriggerConfig()); const message = ref("");
watch(() => device.triggerConfig, (value) => { if (value) triggers.value = cloneTriggerConfig(value); }, { immediate: true });
const availableSlots = computed(() => device.slots.filter((slot) => slot.occupied && slot.confirmed));
async function saveTriggers() { try { await device.saveTriggers(triggers.value); message.value = "GPIO 配置已写入开发板。"; } catch (error) { message.value = error.message; } }
function restoreDefaults() { triggers.value = defaultTriggerConfig(); message.value = "已载入默认绑定，点击保存后写入开发板。"; device.notify(message.value); }
async function exportConfig() { if (!device.ready) { message.value="请先连接并等待固件响应。"; device.notify(message.value, "error"); return; } try { const slots=[]; for (const slot of device.slots) { if (slot.source === "stored") { const loaded=await device.loadMacro(slot.slot); slots.push({ slot:slot.slot+1, source:"stored", name:slot.name, macro:{ steps:loaded.steps, loopGapMs:loaded.loopGapMs } }); } else { slots.push({ slot:slot.slot+1, source:slot.source, name:slot.name }); } } const documentData={ format:LIBRARY_FORMAT, version:LIBRARY_VERSION, slots, triggers:serializeTriggerConfig(triggers.value), taskPlan:device.taskPlan }; const url=URL.createObjectURL(new Blob([JSON.stringify(documentData,null,2)],{type:"application/json"})); const link=document.createElement("a"); link.href=url; link.download="splatoon-farmers-backup-v2.json"; link.click(); URL.revokeObjectURL(url); message.value="已导出完整 2.0 配置备份。"; device.notify(message.value); } catch(error) { message.value=error.message||"备份导出失败。"; device.notify(message.value, "error"); } }
async function importConfig(event) { const file=event.target.files?.[0]; if(!file)return; try { if (!device.ready) throw new Error("请先连接并等待固件响应。"); const data=normalizeLibraryDocument(JSON.parse(await file.text())); await device.stop(); for (const slot of data.slots) { if (slot.source === "stored") await device.saveMacro(slot.slot,slot.name,slot.macro); else if (slot.source === "builtin") await device.restoreMacro(slot.slot); else await device.deleteMacro(slot.slot); } if(data.taskPlan) await device.saveTask(data.taskPlan); else await device.deleteTask(); await device.saveTriggers(data.triggers); await device.refreshAll(); message.value="2.0 配置备份已完整恢复。"; device.notify(message.value); } catch(error) { message.value=error.message||"备份导入失败。"; device.notify(message.value, "error"); } event.target.value=""; }
</script>
<template>
  <PageTitle eyebrow="DEVICE & GPIO / 设备设置" title="接线、离线触发和备份。" description="这里不负责运行宏，只管理硬件连接和持久化配置。" />
  <section class="wiring-card large">
<div>
<p class="eyebrow">GEAR CHECK / 双链路</p>
<h2>两根线，各干一件事。</h2>
<p>两条线需要同时连接，网页控制和 Switch 手柄输出才会同时工作。</p>
</div>
<div>
<b>① 原生 USB → Switch 底座</b>
<p>GPIO19 / GPIO20，由 ESP32-S3 模拟 Nintendo Switch 有线手柄。</p>
</div>
<div>
<b>② USB-UART → 电脑</b>
<p>115200 波特率，网页通过它保存宏、发送命令并读取状态。</p>
</div>
<figure class="board-port-guide">
  <div class="board-photo-wrap">
    <img src="/images/esp32-s3-board-ports.jpg" alt="ESP32-S3 开发板实物，两个 USB-C 接口位于右侧">
    <div class="port-label switch-port"><strong>连接电脑</strong><span>USB-UART · 网页串口</span></div>
    <div class="port-label computer-port"><strong>连接 Switch</strong><span>原生 USB · 手柄输出</span></div>
  </div>
  <figcaption>接口朝右时：上方 USB-UART 接电脑，下方原生 USB 接 Switch。两根线需要同时连接。</figcaption>
</figure>
</section>
  <section class="device-card">
<div class="section-head">
<div>
<p class="eyebrow">OFFLINE TRIGGERS / 离线按钮</p>
<h2>GPIO 触发配置</h2>
</div>
<button class="secondary" @click="restoreDefaults">恢复默认绑定</button>
</div>
<p class="muted">GPIO 使用内部上拉，外部按钮只连接 GPIO 与 GND。每个启动引脚可运行一个宏，或启动已保存的宏循环。</p>
<div class="trigger-grid">
<article v-for="entry in triggers.entries" :key="entry.index">
<b>触发 {{ entry.index+1 }}</b>
<label class="field">
<span>GPIO</span>
<select v-model.number="entry.pin">
<option v-for="pin in SAFE_TRIGGER_PINS" :key="pin" :value="pin">GPIO{{ pin }}</option>
</select>
</label>
<label class="field">
<span>触发目标</span>
<select v-model.number="entry.slot">
<option v-for="slot in availableSlots" :key="slot.slot" :value="slot.slot">槽位 {{ slot.slot+1 }} · {{ slot.name }}</option>
<option :value="TASK_TRIGGER_SLOT" :disabled="!device.taskPlan">宏循环 · {{ device.taskPlan?.name || '请先在宏设置中保存' }}</option>
</select>
</label>
<label class="switch">
<input v-model="entry.enabled" type="checkbox">
<span>启用</span>
</label>
</article>
</div>
<label class="field narrow">
<span>停止 GPIO</span>
<select v-model.number="triggers.stop_pin">
<option v-for="pin in SAFE_TRIGGER_PINS" :key="pin" :value="pin">GPIO{{ pin }}</option>
</select>
</label>
<div class="action-row">
<button class="primary" :disabled="!device.ready" @click="saveTriggers">保存 GPIO 配置</button>
</div>
</section>
  <section class="device-card">
<div class="section-head">
<div>
<p class="eyebrow">BACKUP / 完整备份</p>
<h2>宏、任务和 GPIO</h2>
</div>
</div>
<p>2.0 配置备份包含 8 个槽位、Flash 宏动作、当前保存的一套宏循环和 GPIO。只接受全新的 2.0 JSON，不兼容旧备份。</p>
<div class="action-row">
<button class="secondary" :disabled="!device.ready" @click="exportConfig">导出完整配置</button>
<label class="secondary file-button">导入 2.0 配置<input type="file" accept=".json,application/json" @change="importConfig">
</label>
</div>
<p class="form-message">{{ message }}</p>
</section>
</template>
