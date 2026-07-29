<script setup>
import { onMounted } from 'vue'

import { useWeatherView } from '../composables/useWeatherView'
import { useWeatherViewContext } from '../context/weatherViewContext'
import MapWorkspace from './MapWorkspace.vue'

const props = defineProps({
  panel: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['ready'])

const rootViewContext = useWeatherViewContext()
const viewContext = useWeatherView({
  ...props.panel,
  compact: true,
  systemControls: rootViewContext
})

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
