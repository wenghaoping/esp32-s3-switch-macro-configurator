<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { controlForKey, DEFAULT_KEY_BINDINGS, keyLabel } from "../utils/manual-input.js";

const props = defineProps({
  compact: Boolean,
  disabled: Boolean,
  editorLayout: Boolean,
  selectable: Boolean,
  modelValue: { type: Array, default: () => [] },
  externalControls: { type: Array, default: () => [] },
});
const emit = defineEmits(["change", "update:modelValue"]);
const active = ref(new Set(props.modelValue));
const displayedActive = computed(() => new Set([...active.value, ...props.externalControls]));
const pressedKeys = new Map();

const shouldersLeft = [["ZL","ZL"],["L","L"]];
const shouldersRight = [["R","R"],["ZR","ZR"]];
const dpad = [["↑","DPAD_UP"],["←","DPAD_LEFT"],["→","DPAD_RIGHT"],["↓","DPAD_DOWN"]];
const face = [["X","X"],["Y","Y"],["A","A"],["B","B"]];
const leftStick = [["↑","LEFT_STICK_UP"],["←","LEFT_STICK_LEFT"],["→","LEFT_STICK_RIGHT"],["↓","LEFT_STICK_DOWN"]];
const rightStick = [["↑","RIGHT_STICK_UP"],["←","RIGHT_STICK_LEFT"],["→","RIGHT_STICK_RIGHT"],["↓","RIGHT_STICK_DOWN"]];
const utility = [["−","MINUS"],["+","PLUS"],["L3","L_STICK_PRESS"],["R3","R_STICK_PRESS"],["截图","CAPTURE"],["主页","HOME"]];

watch(() => props.modelValue, (value) => {
  if (props.selectable) active.value = new Set(value);
}, { deep: true });

function binding(control) { return keyLabel(DEFAULT_KEY_BINDINGS[control]); }
function notify() {
  const value = [...active.value];
  emit("change", value);
  emit("update:modelValue", value);
}
function toggle(control) {
  if (props.disabled) return;
  if (active.value.has(control)) active.value.delete(control); else active.value.add(control);
  active.value = new Set(active.value);
  notify();
}
function press(control) {
  if (props.disabled) return;
  if (props.selectable) { toggle(control); return; }
  active.value.add(control);
  active.value = new Set(active.value);
  notify();
}
function release(control) {
  if (props.selectable) return;
  active.value.delete(control);
  active.value = new Set(active.value);
  notify();
}
function clear() {
  if (props.selectable || active.value.size === 0) return;
  active.value.clear();
  active.value = new Set();
  notify();
}
function keydown(event) {
  if (props.selectable || props.disabled || event.repeat || ["INPUT","SELECT","TEXTAREA"].includes(event.target?.tagName)) return;
  const control = controlForKey(DEFAULT_KEY_BINDINGS, event.code);
  if (!control) return;
  event.preventDefault();
  pressedKeys.set(event.code, control);
  press(control);
}
function keyup(event) {
  if (props.selectable) return;
  const control = pressedKeys.get(event.code);
  if (!control) return;
  event.preventDefault();
  pressedKeys.delete(event.code);
  if (![...pressedKeys.values()].includes(control)) release(control);
}
onMounted(() => { window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup); });
onBeforeUnmount(() => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); clear(); });
defineExpose({ clear });
</script>

<template>
  <section class="switch-controller" :class="{ compact, selectable, 'editor-layout': editorLayout }" @pointerleave="clear">
    <div class="shoulder-strip">
      <div class="shoulder-pair">
        <button v-for="item in shouldersLeft" :key="item[1]" class="pad-key shoulder-key" :class="{ pressed: displayedActive.has(item[1]) }" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button>
      </div>
      <div class="shoulder-pair">
        <button v-for="item in shouldersRight" :key="item[1]" class="pad-key shoulder-key" :class="{ pressed: displayedActive.has(item[1]) }" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button>
      </div>
    </div>

    <div class="controller-shell">
      <div class="pad-cluster"><b>移动 / 十字键</b><div class="control-diamond"><button v-for="(item,index) in dpad" :key="item[1]" class="pad-key round-key" :class="[`position-${index}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>＋</i></div></div>
      <div v-if="editorLayout" class="pad-cluster inline-stick"><b>左摇杆</b><div class="control-diamond stick-diamond"><button v-for="(item,index) in leftStick" :key="item[1]" class="pad-key round-key" :class="[`position-${index}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>L</i></div></div>
      <div class="controller-center">
        <span class="switch-logo">功能键</span>
        <div class="utility-grid"><button v-for="item in utility" :key="item[1]" class="pad-key utility-key" :class="{ pressed:displayedActive.has(item[1]) }" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button></div>
      </div>
      <div v-if="editorLayout" class="pad-cluster inline-stick"><b>右摇杆</b><div class="control-diamond stick-diamond"><button v-for="(item,index) in rightStick" :key="item[1]" class="pad-key round-key" :class="[`position-${index}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>R</i></div></div>
      <div class="pad-cluster"><b>动作 / ABXY</b><div class="control-diamond face-diamond"><button v-for="(item,index) in face" :key="item[1]" class="pad-key round-key face-key" :class="[`position-${index}`,`face-${item[0].toLowerCase()}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>●</i></div></div>
    </div>
    <div v-if="!editorLayout" class="stick-bank">
      <div class="pad-cluster"><b>左摇杆</b><div class="control-diamond stick-diamond"><button v-for="(item,index) in leftStick" :key="item[1]" class="pad-key round-key" :class="[`position-${index}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>L</i></div></div>
      <div class="pad-cluster"><b>右摇杆</b><div class="control-diamond stick-diamond"><button v-for="(item,index) in rightStick" :key="item[1]" class="pad-key round-key" :class="[`position-${index}`,{ pressed:displayedActive.has(item[1]) }]" :disabled="disabled" @pointerdown.prevent="press(item[1])" @pointerup.prevent="release(item[1])" @pointercancel="release(item[1])"><span>{{ item[0] }}</span><kbd>{{ binding(item[1]) }}</kbd></button><i>R</i></div></div>
    </div>
    <p class="controller-help">{{ selectable ? '点击图中的 Switch 按键来设置这个动作；黄色表示已选中。' : '按住图中按钮或使用键盘；支持组合输入，松开后立即释放。' }}</p>
  </section>
</template>
