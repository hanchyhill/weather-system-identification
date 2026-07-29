<script setup>
import { Eraser, Pencil } from 'lucide-vue-next'
import { NPopover, NTooltip } from 'naive-ui'
import { computed, ref } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'

const props = defineProps({
  viewContext: {
    type: Object,
    default: null
  },
  selectionHandler: {
    type: Function,
    default: null
  },
  exitHandler: {
    type: Function,
    default: null
  }
})

// 多图模式会在不同子图之间切换 viewContext，不能在 setup 时解构为固定的第一张图。
const fallbackViewContext = props.viewContext || useWeatherViewContext()
const viewContext = computed(() => props.viewContext || fallbackViewContext)
const DRAW_TOOLS = computed(() => viewContext.value.DRAW_TOOLS)
const drawMode = computed(() => viewContext.value.drawMode.value)
const activeDrawTool = computed(() => viewContext.value.activeDrawTool.value)
const hasDrawings = computed(() => viewContext.value.hasDrawings.value)
const draftPointCount = computed(() => viewContext.value.draftPointCount.value)

const show = ref(false)

const geomTools = computed(() => DRAW_TOOLS.value.filter((tool) => tool.group === 'geom'))
const lineTools = computed(() => DRAW_TOOLS.value.filter((tool) => tool.group === 'line'))
const labelTools = computed(() => DRAW_TOOLS.value.filter((tool) => tool.group === 'label'))

// 线类型：预览小图（swatch）的样式，直观区分槽线/切变线/辐合线等。
function swatchStyle(tool) {
  if (tool.kind === 'box') {
    return { border: `2px solid ${tool.color}`, borderRadius: tool.render === 'ellipse' ? '50%' : '3px' }
  }
  return {}
}

function toggle() {
  show.value = !show.value
  if (!show.value) exitDrawMode()
}

function pick(tool) {
  if (props.selectionHandler) props.selectionHandler(tool.key)
  else viewContext.value.setDrawTool(tool.key)
}

function pickErase() {
  if (props.selectionHandler) props.selectionHandler('erase')
  else viewContext.value.setDrawTool('erase')
}

function exitDrawMode() {
  if (props.exitHandler) props.exitHandler()
  else viewContext.value.exitDrawMode()
}

function finishCurrentLine() {
  viewContext.value.finishCurrentLine()
}

function undoDrawing() {
  viewContext.value.undoDrawing()
}

function clearDrawings() {
  viewContext.value.clearDrawings()
}
</script>

<template>
  <n-popover trigger="manual" :show="show" placement="right-start" style="width: 260px;">
    <template #trigger>
      <n-tooltip trigger="hover" placement="right">
        <template #trigger>
          <button
            type="button"
            class="draw-fab"
            :class="{ 'draw-fab-active': drawMode }"
            aria-label="绘图工具"
            @click="toggle"
          >
            <Pencil :size="20" />
          </button>
        </template>
        绘图工具
      </n-tooltip>
    </template>

    <div class="dtp">
      <div class="dtp-header">
        <strong>常用图形绘制</strong>
        <span v-if="drawMode" class="dtp-badge">绘图中 · 平移已锁定</span>
        <span v-else class="dtp-hint">选择图形后进入绘图模式</span>
      </div>

      <div class="dtp-group">
        <div class="dtp-group-title">几何图形</div>
        <div class="dtp-glyph-grid">
          <button
            v-for="tool in geomTools"
            :key="tool.key"
            type="button"
            class="dtp-shape-btn"
            :class="{ 'dtp-tool-active': activeDrawTool === tool.key }"
            :title="tool.label"
            @click="pick(tool)"
          >
            <span class="dtp-swatch" :style="swatchStyle(tool)"></span>
          </button>
        </div>
      </div>

      <div class="dtp-group">
        <div class="dtp-group-title">线类型</div>
        <div class="dtp-glyph-grid">
          <button
            v-for="tool in lineTools"
            :key="tool.key"
            type="button"
            class="dtp-line-btn"
            :class="{ 'dtp-tool-active': activeDrawTool === tool.key }"
            :title="tool.label"
            @click="pick(tool)"
          >
            <svg class="dtp-line-svg" viewBox="0 0 44 18" aria-hidden="true">
              <!-- 槽线：棕色平滑曲线 -->
              <template v-if="tool.render === 'trough'">
                <path d="M2 11 Q13 1 23 9 T42 6" :stroke="tool.color" stroke-width="2" fill="none" stroke-linecap="round" />
              </template>
              <!-- 切变线：红色双横线 -->
              <template v-else-if="tool.render === 'shear'">
                <path d="M2 6 Q22 2 42 6" :stroke="tool.color" stroke-width="1.6" fill="none" />
                <path d="M2 12 Q22 8 42 12" :stroke="tool.color" stroke-width="1.6" fill="none" />
              </template>
              <!-- 辐合线：黑色虚线 + 交叉短线组成的星号 -->
              <template v-else-if="tool.render === 'convergence'">
                <line x1="2" y1="9" x2="42" y2="9" :stroke="tool.color" stroke-width="1.6" stroke-dasharray="7 5" />
                <g :stroke="tool.color" stroke-width="1.2" stroke-linecap="round">
                  <line x1="7.5" y1="9" x2="14.5" y2="9" />
                  <line x1="9.25" y1="5.97" x2="12.75" y2="12.03" />
                  <line x1="12.75" y1="5.97" x2="9.25" y2="12.03" />
                  <line x1="29.5" y1="9" x2="36.5" y2="9" />
                  <line x1="31.25" y1="5.97" x2="34.75" y2="12.03" />
                  <line x1="34.75" y1="5.97" x2="31.25" y2="12.03" />
                </g>
              </template>
              <!-- 箭头线：曲线 + 末端箭头 -->
              <template v-else-if="tool.render === 'arrow'">
                <path d="M2 13 Q18 2 36 8" :stroke="tool.color" stroke-width="2" fill="none" stroke-linecap="round" />
                <polyline points="30,3 39,8 31,13" :stroke="tool.color" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </template>
              <!-- 粗箭头线：镂空块状箭头，仅轮廓 -->
              <template v-else-if="tool.render === 'block-arrow'">
                <polygon
                  points="2,6 27,6 27,3 41,9 27,15 27,12 2,12"
                  :stroke="tool.color"
                  stroke-width="1.6"
                  fill="none"
                  stroke-linejoin="round"
                />
              </template>
              <!-- 冷锋：蓝线 + 三角（在线上方） -->
              <template v-else-if="tool.render === 'cold'">
                <line x1="2" y1="13" x2="42" y2="13" :stroke="tool.color" stroke-width="1.8" />
                <polygon points="7,13 12,5 17,13" :fill="tool.color" />
                <polygon points="24,13 29,5 34,13" :fill="tool.color" />
              </template>
              <!-- 暖锋：红线 + 半圆（在线上方） -->
              <template v-else-if="tool.render === 'warm'">
                <line x1="2" y1="13" x2="42" y2="13" :stroke="tool.color" stroke-width="1.8" />
                <path d="M7 13 A5 5 0 0 1 17 13 Z" :fill="tool.color" />
                <path d="M24 13 A5 5 0 0 1 34 13 Z" :fill="tool.color" />
              </template>
              <template v-else>
                <line x1="2" y1="9" x2="42" y2="9" :stroke="tool.color" stroke-width="2.4" />
              </template>
            </svg>
          </button>
        </div>
      </div>

      <div class="dtp-group">
        <div class="dtp-group-title">标注类</div>
        <div class="dtp-glyph-grid">
          <button
            v-for="tool in labelTools"
            :key="tool.key"
            type="button"
            class="dtp-glyph-btn"
            :class="{ 'dtp-tool-active': activeDrawTool === tool.key }"
            :title="tool.label"
            :style="{ color: tool.color }"
            @click="pick(tool)"
          >{{ tool.text }}</button>
        </div>
      </div>

      <button
        type="button"
        class="dtp-erase-btn"
        :class="{ 'dtp-erase-btn-active': activeDrawTool === 'erase' }"
        @click="pickErase()"
      >
        <Eraser :size="15" />
        <span>{{ activeDrawTool === 'erase' ? '删除中 · 点击图形删除' : '删除图形' }}</span>
      </button>

      <div class="dtp-tip">
        线类型：单击加点，<strong>双击 / 回车 / 右键</strong>结束该条线；几何图形：按住拖拽画框；标注类：单击落点。删除：选「删除图形」后移到目标上会<strong>高亮</strong>，单击即删。<strong>Esc</strong> 退出绘图。
      </div>

      <div class="dtp-actions">
        <button
          type="button"
          class="dtp-btn"
          :disabled="draftPointCount < 2"
          @click="finishCurrentLine()"
        >完成当前线</button>
        <button type="button" class="dtp-btn" :disabled="!hasDrawings" @click="undoDrawing()">撤销</button>
        <button type="button" class="dtp-btn" :disabled="!hasDrawings" @click="clearDrawings()">清空</button>
        <button type="button" class="dtp-btn dtp-btn-primary" @click="toggle()">退出</button>
      </div>
    </div>
  </n-popover>
</template>

<style scoped>
.draw-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(21, 31, 46, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.12);
  backdrop-filter: blur(8px);
  color: #1f7a8c;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.draw-fab:hover,
.draw-fab-active {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.dtp {
  display: grid;
  gap: 12px;
}

.dtp-header {
  display: grid;
  gap: 3px;
}

.dtp-header strong {
  color: #172033;
  font-size: 14px;
}

.dtp-badge {
  justify-self: start;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(31, 122, 140, 0.14);
  color: #1f7a8c;
  font-size: 11px;
  font-weight: 600;
}

.dtp-hint {
  color: #667487;
  font-size: 12px;
}

.dtp-group {
  display: grid;
  gap: 6px;
}

.dtp-group-title {
  color: #526173;
  font-size: 12px;
  font-weight: 600;
}

.dtp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.dtp-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  color: #384456;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dtp-tool:hover {
  border-color: #1f7a8c;
}

.dtp-tool-active {
  border-color: #1f7a8c;
  background: rgba(31, 122, 140, 0.1);
  color: #16414a;
  font-weight: 600;
}

.dtp-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 14px;
  flex: none;
}

.dtp-swatch-typhoon {
  font-size: 15px;
  line-height: 1;
}

.dtp-glyph-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dtp-glyph-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  font-size: 19px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dtp-glyph-btn:hover {
  border-color: #1f7a8c;
}

.dtp-shape-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 36px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dtp-shape-btn:hover {
  border-color: #1f7a8c;
}

.dtp-shape-btn .dtp-swatch {
  width: 26px;
  height: 18px;
}

.dtp-line-svg {
  width: 44px;
  height: 18px;
  flex: none;
}

.dtp-line-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 34px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dtp-line-btn:hover {
  border-color: #1f7a8c;
}

.dtp-erase-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #ef4444;
  border-radius: 8px;
  background: #fff;
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.dtp-erase-btn:hover {
  background: rgba(239, 68, 68, 0.08);
}

.dtp-erase-btn-active {
  background: #ef4444;
  color: #fff;
}

.dtp-erase-btn-active:hover {
  background: #dc2626;
}

.dtp-tip {
  color: #7a8698;
  font-size: 11px;
  line-height: 1.5;
}

.dtp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dtp-btn {
  flex: 1 1 auto;
  padding: 5px 8px;
  border: 1px solid #d7dee7;
  border-radius: 7px;
  background: #fff;
  color: #384456;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.dtp-btn:hover:not(:disabled) {
  border-color: #1f7a8c;
  color: #1f7a8c;
}

.dtp-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dtp-btn-primary {
  background: #1f7a8c;
  border-color: #1f7a8c;
  color: #fff;
}

.dtp-btn-primary:hover:not(:disabled) {
  background: #186576;
  color: #fff;
}

.dtp-btn-erase {
  background: #ef4444;
  border-color: #ef4444;
  color: #fff;
}

.dtp-btn-erase:hover:not(:disabled) {
  background: #dc2626;
  color: #fff;
}
</style>
