<script setup>defineProps({ eyebrow: String, title: String, description: String });</script>
<template><header class="page-title"><p class="eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1><p>{{ description }}</p><slot /></header></template>
