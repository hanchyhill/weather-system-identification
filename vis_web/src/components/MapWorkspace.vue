<script setup>
import { Camera, Crop, Monitor, PanelLeftClose, PanelLeftOpen, RotateCcw } from 'lucide-vue-next'
import {
  NButton,
  NPopover,
  NTooltip
} from 'naive-ui'
import { ref } from 'vue'

import { useScreenshot } from '../composables/useScreenshot'
import { useWeatherViewContext } from '../context/weatherViewContext'
import DrawingToolbar from './DrawingToolbar.vue'
import ElementSelector from './ElementSelector.vue'
import ForecastSlider from './ForecastSlider.vue'
import MapViewSelector from './MapViewSelector.vue'
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
  showControlRail,
  zoomTransform
} = viewContext

// 截图工具：范围/剪贴板/下载逻辑封装在 useScreenshot 中，按面板独立运行。
const showScreenshotMenu = ref(false)

// 切换左侧「天气系统识别」控制面板的显隐（仅主视图存在该状态）
function toggleControlRail() {
  if (showControlRail) showControlRail.value = !showControlRail.value
}
const {
  selecting: screenshotSelecting,
  toast: screenshotToast,
  marqueeStyle: screenshotMarqueeStyle,
  captureFull,
  startRegion,
  onOverlayPointerDown: onScreenshotPointerDown
} = useScreenshot({
  canvasRef,
  shellRef,
  getMeta: () => ({ initTime: initTime.value, fcHour: fcHour.value, level: level.value })
})

function captureFullView() {
  showScreenshotMenu.value = false
  captureFull()
}

function captureRegionView() {
  showScreenshotMenu.value = false
  startRegion()
}
</script>

<template>
  <section class="map-workspace" :class="{ 'map-workspace-compact': compact }">
    <div class="toolbar">
      <div>
        <template v-if="compact">
          <strong v-if="showPanelTitle && panelTitle" class="panel-title" :title="panelTitle">{{ panelTitle }}</strong>
          <span>+{{ fcHour }} h</span>
          <strong>{{ forecastValidTimeBjtLabel }}</strong>
        </template>
        <template v-else>
          <strong>{{ initTime }}</strong>
          <span>+{{ fcHour }} h</span>
        </template>
        <span>{{ level === 'surface' ? '地面' : `${level} hPa` }}</span>
      </div>
      <div class="toolbar-actions">
        <n-popover
          v-if="!compact"
          trigger="manual"
          :show="showScreenshotMenu"
          placement="bottom-end"
          :show-arrow="false"
          @clickoutside="showScreenshotMenu = false"
        >
          <template #trigger>
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button
                  size="small"
                  tertiary
                  circle
                  :type="screenshotSelecting ? 'primary' : 'default'"
                  @click="showScreenshotMenu = !showScreenshotMenu"
                >
                  <Camera :size="16" />
                </n-button>
              </template>
              截图
            </n-tooltip>
          </template>
          <div class="screenshot-menu">
            <button type="button" class="screenshot-menu-item" @click="captureFullView">
              <Monitor :size="15" />
              <span>整个可视区域</span>
            </button>
            <button type="button" class="screenshot-menu-item" @click="captureRegionView">
              <Crop :size="15" />
              <span>框选指定区域</span>
            </button>
          </div>
        </n-popover>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button size="small" tertiary circle @click="resetView">
              <RotateCcw :size="16" />
            </n-button>
          </template>
          重置视图
        </n-tooltip>
      </div>
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

      <div v-if="!compact" class="element-selector-anchor">
        <ElementSelector />
      </div>

      <div v-if="!compact" class="multi-map-selector-anchor">
        <MultiMapSelector />
      </div>

      <div v-if="!compact" class="drawing-toolbar-anchor">
        <DrawingToolbar />
      </div>

      <div v-if="!compact" class="map-view-selector-anchor">
        <MapViewSelector />
      </div>

      <div v-if="!compact" class="panel-toggle-anchor">
        <n-tooltip trigger="hover" placement="right">
          <template #trigger>
            <button
              type="button"
              class="panel-toggle-fab"
              :class="{ 'panel-toggle-fab-active': !showControlRail }"
              :aria-label="showControlRail ? '隐藏识别面板' : '显示识别面板'"
              @click="toggleControlRail"
            >
              <PanelLeftClose v-if="showControlRail" :size="20" />
              <PanelLeftOpen v-else :size="20" />
            </button>
          </template>
          {{ showControlRail ? '隐藏天气系统识别面板' : '显示天气系统识别面板' }}
        </n-tooltip>
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

      <div
        v-if="screenshotSelecting"
        class="screenshot-overlay"
        @pointerdown="onScreenshotPointerDown"
        @contextmenu.prevent
      >
        <div class="screenshot-marquee" :style="screenshotMarqueeStyle" />
        <div class="screenshot-hint">拖拽框选截图区域，按 Esc 取消</div>
      </div>

      <div v-if="screenshotToast" class="screenshot-toast">{{ screenshotToast }}</div>
    </div>
  </section>
</template>

<style scoped>
.toolbar-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
}

.screenshot-menu {
  display: grid;
  gap: 4px;
  min-width: 168px;
}

.screenshot-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  color: #384456;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.screenshot-menu-item:hover {
  border-color: #1f7a8c;
  background: rgba(31, 122, 140, 0.08);
  color: #16414a;
}

.screenshot-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  cursor: crosshair;
  background: rgba(15, 23, 42, 0.12);
  user-select: none;
  touch-action: none;
}

.screenshot-marquee {
  position: absolute;
  border: 1.5px dashed #1f7a8c;
  background: rgba(31, 122, 140, 0.12);
  box-shadow: 0 0 0 100vmax rgba(15, 23, 42, 0.28);
  pointer-events: none;
}

.screenshot-hint {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #f8fafc;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}

.screenshot-toast {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 21;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(31, 122, 140, 0.94);
  color: #fff;
  font-size: 13px;
  white-space: nowrap;
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.16);
  pointer-events: none;
}
</style>
