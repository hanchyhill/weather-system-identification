<script setup>
import { RotateCcw } from 'lucide-vue-next'
import {
  NButton,
  NTooltip
} from 'naive-ui'

import { useWeatherViewContext } from '../context/weatherViewContext'

const {
  canvasRef,
  fcHour,
  formatNumber,
  handleMouseLeave,
  handleMouseMove,
  hoverJetLine,
  hoverLine,
  hoverVortexCenter,
  hoverVortexTrack,
  initTime,
  level,
  mouseGeo,
  resetView,
  shellRef,
  zoomTransform
} = useWeatherViewContext()
</script>

<template>
  <section class="map-workspace">
    <div class="toolbar">
      <div>
        <strong>{{ initTime }}</strong>
        <span>+{{ fcHour }} h</span>
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

    <div ref="shellRef" class="canvas-shell">
      <canvas
        ref="canvasRef"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
      />

      <div v-if="mouseGeo" class="coordinate-readout">
        {{ formatNumber(mouseGeo.lon, 3) }}E,
        {{ formatNumber(mouseGeo.lat, 3) }}N
        <span>k={{ formatNumber(zoomTransform.k, 2) }}</span>
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
