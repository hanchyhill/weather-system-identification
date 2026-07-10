<script setup>
import { RotateCcw } from 'lucide-vue-next'
import {
  NButton,
  NTooltip
} from 'naive-ui'

import { useWeatherViewContext } from '../context/weatherViewContext'
import DrawingToolbar from './DrawingToolbar.vue'
import ElementSelector from './ElementSelector.vue'
import ForecastSlider from './ForecastSlider.vue'
import MultiMapSelector from './MultiMapSelector.vue'
import MultiTimeSelector from './MultiTimeSelector.vue'

const props = defineProps({
  compact: Boolean,
  panelTitle: {
    type: String,
    default: ''
  },
  showPanelTitle: {
    type: Boolean,
    default: true
  },
  viewContext: {
    type: Object,
    default: null
  }
})

const viewContext = props.viewContext || useWeatherViewContext()

const {
  canvasRef,
  drawMode,
  fcHour,
  forecastValidTimeBjtLabel,
  formatNumber,
  handleCanvasClick,
  handleCanvasContextMenu,
  handleCanvasDblClick,
  handleCanvasPointerDown,
  handleCanvasPointerUp,
  handleMouseLeave,
  handleMouseMove,
  hoverJetLine,
  hoverLine,
  hoverVortexCenter,
  hoverVortexTrack,
  initTime,
  level,
  mouseGeo,
  preloading,
  resetView,
  shellRef,
  zoomTransform
} = viewContext
</script>

<template>
  <section class="map-workspace" :class="{ 'map-workspace-compact': compact }">
    <div class="toolbar">
      <div>
        <template v-if="compact">
          <strong v-if="showPanelTitle && panelTitle">{{ panelTitle }}</strong>
          <span>+{{ fcHour }} h</span>
          <strong>{{ forecastValidTimeBjtLabel }}</strong>
        </template>
        <template v-else>
          <strong>{{ initTime }}</strong>
          <span>+{{ fcHour }} h</span>
        </template>
        <span>{{ level === 'surface' ? '地面' : `${level} hPa` }}</span>
      </div>
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button size="small" tertiary circle @click="resetView">
            <RotateCcw :size="16" />
          </n-button>
        </template>
        重置视图
      </n-tooltip>
    </div>

    <ForecastSlider v-if="!compact" />

    <div ref="shellRef" class="canvas-shell">
      <canvas
        ref="canvasRef"
        :style="{ cursor: drawMode ? 'crosshair' : '' }"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
        @mousedown="handleCanvasPointerDown"
        @mouseup="handleCanvasPointerUp"
        @click="handleCanvasClick"
        @dblclick="handleCanvasDblClick"
        @contextmenu="handleCanvasContextMenu"
      />

      <div v-if="!compact" class="multi-time-selector-anchor">
        <MultiTimeSelector />
      </div>

      <div v-if="!compact" class="drawing-toolbar-anchor">
        <DrawingToolbar />
      </div>

      <div v-if="!compact" class="element-selector-anchor">
        <ElementSelector />
      </div>

      <div v-if="!compact" class="multi-map-selector-anchor">
        <MultiMapSelector />
      </div>

      <div v-if="mouseGeo" class="coordinate-readout">
        {{ formatNumber(mouseGeo.lon, 3) }}E,
        {{ formatNumber(mouseGeo.lat, 3) }}N
        <span>k={{ formatNumber(zoomTransform.k, 2) }}</span>
      </div>

      <div v-if="preloading" class="preload-indicator">
        <span class="preload-spinner" />
        <span>预加载中…</span>
      </div>

      <div v-if="hoverVortexCenter" class="line-tooltip">
        <strong>涡旋中心 L</strong>
        <span>{{ hoverVortexCenter.level }} hPa +{{ hoverVortexCenter.fc_hour }} h</span>
        <span>{{ formatNumber(hoverVortexCenter.lon, 2) }}E, {{ formatNumber(hoverVortexCenter.lat, 2) }}N</span>
        <span>涡度 {{ formatNumber(hoverVortexCenter.vort, 7) }} s^-1</span>
        <span>最大风 {{ formatNumber(hoverVortexCenter.vmax, 1) }} m/s</span>
        <span v-if="hoverVortexCenter.warm">暖心: 是</span>
        <span v-if="hoverVortexCenter.is_surface_center === 1">地面校正: 是</span>
      </div>

      <div v-else-if="hoverVortexTrack" class="line-tooltip">
        <strong>涡旋轨迹 {{ hoverVortexTrack.track.seq_number }}</strong>
        <span>{{ hoverVortexTrack.track.GZ_number }}</span>
        <span>+{{ hoverVortexTrack.point.fc_hour }} h</span>
        <span>{{ formatNumber(hoverVortexTrack.point.lon, 2) }}E, {{ formatNumber(hoverVortexTrack.point.lat, 2) }}N</span>
        <span>最大风 {{ formatNumber(hoverVortexTrack.track.max_wind, 1) }} m/s</span>
        <span>暖心轨迹: {{ hoverVortexTrack.track.warm ? '是' : '否' }}</span>
      </div>

      <div v-else-if="hoverJetLine" class="line-tooltip">
        <strong>急流轴 {{ hoverJetLine.line_id }}</strong>
        <span>{{ level }} hPa +{{ fcHour }} h</span>
        <span>长度 {{ formatNumber(hoverJetLine.attributes?.length, 2) }}</span>
        <span>平均风速 {{ formatNumber(hoverJetLine.attributes?.avg_wind_speed, 1) }} m/s</span>
        <span>最大风速 {{ formatNumber(hoverJetLine.attributes?.max_wind_speed, 1) }} m/s</span>
      </div>

      <div v-else-if="hoverLine" class="line-tooltip">
        <strong>{{ hoverLine.label || hoverLine.shear_type }}</strong>
        <span>ID {{ hoverLine.line_id }}</span>
        <span>长度 {{ formatNumber(hoverLine.attributes?.length, 2) }}</span>
        <span>涡度 {{ formatNumber(hoverLine.attributes?.avg_vorticity, 2) }}</span>
        <span>风速 {{ formatNumber(hoverLine.attributes?.avg_wind_speed, 2) }} m/s</span>
      </div>
    </div>
  </section>
</template>
