<script setup>
import { NConfigProvider } from 'naive-ui'
import { provide } from 'vue'

import ControlRail from './components/ControlRail.vue'
import MapWorkspace from './components/MapWorkspace.vue'
import MultiMapWorkspace from './components/MultiMapWorkspace.vue'
import { useWeatherView } from './composables/useWeatherView'
import { WEATHER_VIEW_CONTEXT_KEY } from './context/weatherViewContext'

const weatherView = useWeatherView()

provide(WEATHER_VIEW_CONTEXT_KEY, weatherView)
</script>

<template>
  <n-config-provider>
    <main class="app-shell">
      <ControlRail />
      <MultiMapWorkspace v-show="weatherView.multiMapMode.value" />
      <MapWorkspace v-show="!weatherView.multiMapMode.value" />
    </main>
  </n-config-provider>
</template>
