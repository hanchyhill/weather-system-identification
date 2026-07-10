<script setup>
import MultiMapValidPanel from './MultiMapValidPanel.vue'

const props = defineProps({
  panel: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <MultiMapValidPanel v-if="panel.valid" :panel="panel" />
  <article v-else class="multi-map-invalid-panel">
    <header>
      <strong>{{ panel.title }}</strong>
      <span>该时效无效</span>
    </header>
    <div>
      <span>该时效无效</span>
    </div>
  </article>
</template>
