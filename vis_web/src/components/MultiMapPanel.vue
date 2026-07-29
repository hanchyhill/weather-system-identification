<script setup>
import MultiMapValidPanel from './MultiMapValidPanel.vue'

const props = defineProps({
  panel: {
    type: Object,
    required: true
  },
  active: Boolean
})

const emit = defineEmits(['activate', 'ready'])

function activate() {
  emit('activate')
}

function ready(viewContext) {
  emit('ready', viewContext)
}
</script>

<template>
  <div class="multi-map-panel" :class="{ 'multi-map-panel-active': active }" @pointerdown="activate">
    <MultiMapValidPanel v-if="panel.valid" :panel="panel" @ready="ready" />
    <article v-else class="multi-map-invalid-panel">
      <header>
        <strong>{{ panel.title }}</strong>
        <span>该时效无效</span>
      </header>
      <div>
        <span>该时效无效</span>
      </div>
    </article>
  </div>
</template>
