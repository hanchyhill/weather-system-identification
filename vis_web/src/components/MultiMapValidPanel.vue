<script setup>
import { onMounted } from 'vue'

import { useWeatherView } from '../composables/useWeatherView'
import MapWorkspace from './MapWorkspace.vue'

const props = defineProps({
  panel: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['ready'])

const viewContext = useWeatherView({ ...props.panel, compact: true })

onMounted(() => emit('ready', viewContext))
</script>

<template>
  <MapWorkspace
    :view-context="viewContext"
    compact
    :panel-title="panel.title"
    :show-panel-title="panel.showPanelTitle"
  />
</template>
