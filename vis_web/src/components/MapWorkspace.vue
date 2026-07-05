<script setup>
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-vue-next'
import {
  NButton,
  NButtonGroup,
  NTooltip
} from 'naive-ui'
import VueSlider from 'vue-slider-component'
import 'vue-slider-component/theme/default.css'

import { useWeatherViewContext } from '../context/weatherViewContext'

const {
  canvasRef,
  changeFcHour,
  fcHour,
  fcHourIndex,
  forecastValidTimeLabel,
  formatNumber,
  getSliderTooltip,
  handleMouseLeave,
  handleMouseMove,
  hoverJetLine,
  hoverLine,
  hoverVortexCenter,
  hoverVortexTrack,
  initTime,
  level,
  markSlider,
  mouseGeo,
  preloading,
  resetView,
  scrollForecastSlider,
  shellRef,
  sliderIndexCount,
  sliderOpts,
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

    <div class="forecast-slider-row">
      <div class="forecast-slider-actions">
        <span>预报时效</span>
        <n-button-group size="small">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button secondary @click="changeFcHour('index', -1)" @contextmenu.prevent="changeFcHour('hour', -24)">
                <ChevronLeft :size="16" />
              </n-button>
            </template>
            左键减 1 档，右键减 24 小时
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button secondary @click="changeFcHour('index', 1)" @contextmenu.prevent="changeFcHour('hour', 24)">
                <ChevronRight :size="16" />
              </n-button>
            </template>
            左键加 1 档，右键加 24 小时
          </n-tooltip>
        </n-button-group>
      </div>
      <div class="forecast-slider-container" @wheel="scrollForecastSlider">
        <vue-slider
          v-model="fcHourIndex"
          v-bind="sliderOpts"
          :tooltip-formatter="getSliderTooltip"
          :marks="markSlider"
          :min="0"
          :max="sliderIndexCount - 1"
        />
      </div>
      <div class="forecast-slider-readout">
        <strong>+{{ fcHour }} h</strong>
        <span>{{ forecastValidTimeLabel }} UTC</span>
      </div>
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
