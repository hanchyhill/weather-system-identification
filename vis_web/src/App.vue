<script setup>
import { NConfigProvider } from 'naive-ui'
import { provide } from 'vue'

import ControlRail from './components/ControlRail.vue'
import MapWorkspace from './components/MapWorkspace.vue'
import { useWeatherView } from './composables/useWeatherView'
import { WEATHER_VIEW_CONTEXT_KEY } from './context/weatherViewContext'

provide(WEATHER_VIEW_CONTEXT_KEY, useWeatherView())
</script>

<template>
  <n-config-provider>
    <main class="app-shell">
      <ControlRail />
      <MapWorkspace />
    </main>
  </n-config-provider>
</template>