<script setup>
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { NButton, NButtonGroup, NTooltip } from 'naive-ui'
import { computed, reactive, watch } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'
import ForecastSlider from './ForecastSlider.vue'
import MultiMapPanel from './MultiMapPanel.vue'

const {
  canShiftMultiForecastBackward,
  canShiftMultiForecastForward,
  closeMultiMap,
  multiInitInterval,
  multiInitIntervalOptions,
  multiInitPanelCount,
  multiInitPanelCountOptions,
  multiMapMode,
  multiMapModeOptions,
  multiMapPanels,
  multiForecastInterval,
  multiForecastIntervalOptions,
  multiForecastPanelCount,
  multiForecastPanelCountOptions,
  setMultiInitInterval,
  setMultiInitPanelCount,
  setMultiForecastInterval,
  setMultiForecastPanelCount,
  shiftMultiForecastPage
} = useWeatherViewContext()

const modeLabel = computed(() => (
  multiMapModeOptions.find((option) => option.value === multiMapMode.value)?.label || '多图模式'
))
const isForecastMode = computed(() => multiMapMode.value === 'forecast')
const isInitMode = computed(() => multiMapMode.value === 'init')
const gridStyle = computed(() => {
  const count = multiMapPanels.value.length
  const columns = count === 8 ? 4 : count === 6 || count === 9 ? 3 : 2
  return {
    '--multi-map-columns': columns,
    '--multi-map-rows': Math.ceil(count / columns),
    '--multi-map-panel-count': count
  }
})

const syncState = reactive({
  cursor: null,
  zoom: null
})

function resetSyncState() {
  syncState.cursor = null
  syncState.zoom = null
}

function close() {
  resetSyncState()
  closeMultiMap()
}

watch(multiMapMode, (mode) => {
  if (mode) resetSyncState()
})
</script>

<template>
  <section class="multi-map-workspace">
    <header class="multi-map-header">
      <div class="multi-map-heading">
        <strong>{{ modeLabel }}</strong>
        <div v-if="isInitMode" class="multi-map-controls">
          <div class="multi-map-control-group">
            <span>起报间隔</span>
            <n-button-group size="small">
              <n-button
                v-for="option in multiInitIntervalOptions"
                :key="option.value"
                :type="multiInitInterval === option.value ? 'primary' : 'default'"
                @click="setMultiInitInterval(option.value)"
              >
                {{ option.label }}
              </n-button>
            </n-button-group>
          </div>
          <div class="multi-map-control-group">
            <span>子图数量</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiInitPanelCountOptions"
                :key="count"
                :type="multiInitPanelCount === count ? 'primary' : 'default'"
                @click="setMultiInitPanelCount(count)"
              >
                {{ count }} 图
              </n-button>
            </n-button-group>
          </div>
        </div>
        <div v-if="isForecastMode" class="multi-forecast-controls">
          <n-button-group size="small">
            <n-button
              v-for="option in multiForecastIntervalOptions"
              :key="option.value"
              :type="multiForecastInterval === option.value ? 'primary' : 'default'"
              @click="setMultiForecastInterval(option.value)"
            >
              {{ option.label }}
            </n-button>
          </n-button-group>
          <n-button-group size="small">
            <n-button
              v-for="count in multiForecastPanelCountOptions"
              :key="count"
              :type="multiForecastPanelCount === count ? 'primary' : 'default'"
              @click="setMultiForecastPanelCount(count)"
            >
              {{ count }} 图
            </n-button>
          </n-button-group>
          <n-button-group size="small">
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button secondary :disabled="!canShiftMultiForecastBackward" @click="shiftMultiForecastPage(-1)">
                  <ChevronLeft :size="16" />
                </n-button>
              </template>
              向前切换一组时效
            </n-tooltip>
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button secondary :disabled="!canShiftMultiForecastForward" @click="shiftMultiForecastPage(1)">
                  <ChevronRight :size="16" />
                </n-button>
              </template>
              向后切换一组时效
            </n-tooltip>
          </n-button-group>
        </div>
      </div>
      <n-button size="small" secondary @click="close">
        <template #icon><X :size="15" /></template>
        退出多图
      </n-button>
    </header>

    <ForecastSlider />

    <div class="multi-map-grid" :style="gridStyle">
      <MultiMapPanel
        v-for="panel in multiMapPanels"
        :key="panel.id"
        :panel="{ ...panel, syncId: panel.id, syncState }"
      />
    </div>
  </section>
</template>
