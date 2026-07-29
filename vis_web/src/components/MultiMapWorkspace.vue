<script setup>
import { Camera, ChevronLeft, ChevronRight, Pencil, Plus, Save, Settings, Trash2, X } from 'lucide-vue-next'
import { NButton, NButtonGroup, NInput, NModal, NPopover, NSelect, NTooltip } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import { useScreenshot } from '../composables/useScreenshot'
import { useWeatherViewContext } from '../context/weatherViewContext'
import { MAX_CONCURRENT } from '../utils/loadQueue'
import ElementSelector from './ElementSelector.vue'
import ForecastSlider from './ForecastSlider.vue'
import DrawingToolbar from './DrawingToolbar.vue'
import MapViewSelector from './MapViewSelector.vue'
import MultiMapPanel from './MultiMapPanel.vue'
import MultiMapSelector from './MultiMapSelector.vue'
import MultiTimeSelector from './MultiTimeSelector.vue'

const {
  canShiftMultiForecastBackward,
  canShiftMultiForecastForward,
  applyMapView,
  closeMultiMap,
  activeMultiElementConfigurationName,
  applyMultiElementConfiguration,
  createMultiElementConfiguration,
  deleteMultiElementConfiguration,
  activeMultiElementForecastConfigurationName,
  applyMultiElementForecastConfiguration,
  applyElementSelection,
  createMultiElementForecastConfiguration,
  deleteMultiElementForecastConfiguration,
  multiInitInterval,
  multiInitIntervalOptions,
  multiInitPanelCount,
  multiInitPanelCountOptions,
  multiMapMode,
  multiMapModeOptions,
  multiMapPanels,
  multiMapSyncState,
  multiForecastInterval,
  multiForecastIntervalOptions,
  multiForecastPanelCount,
  multiForecastPanelCountOptions,
  multiElementConfigurationName,
  multiElementConfigurations,
  multiElementForecastConfigurationName,
  multiElementForecastConfigurations,
  multiElementForecastRows,
  multiElementPanelCount,
  multiElementPanelCountOptions,
  renameMultiElementConfiguration,
  renameMultiElementForecastConfiguration,
  saveMultiElementConfiguration,
  saveMultiElementForecastConfiguration,
  saveMapView,
  setMultiInitInterval,
  setMultiInitPanelCount,
  setMultiElementConfigurationName,
  setMultiElementPanelCount,
  setMultiElementForecastConfigurationName,
  setMultiForecastInterval,
  setMultiForecastPanelCount,
  shiftMultiForecastPage,
  updateMultiElementPanel,
  updateMultiElementForecastPanel,
  level,
  selectedLayerTypes,
  activeElementKey: globalActiveElementKey
} = useWeatherViewContext()

const modeLabel = computed(() => (
  multiMapModeOptions.find((option) => option.value === multiMapMode.value)?.label || '多图模式'
))
const isForecastMode = computed(() => multiMapMode.value === 'forecast')
const isInitMode = computed(() => multiMapMode.value === 'init')
const isElementMode = computed(() => multiMapMode.value === 'element')
const isElementForecastMode = computed(() => multiMapMode.value === 'element_forecast')
const isInitForecastMode = computed(() => multiMapMode.value === 'init_forecast')
const isElementInitMode = computed(() => multiMapMode.value === 'element_init')
const isElementGridMode = computed(() => isElementForecastMode.value || isElementInitMode.value)
const isElementEditableMode = computed(() => isElementMode.value || isElementGridMode.value)
const comparisonColumnCount = computed(() => (
  isElementInitMode.value ? multiInitPanelCount.value : multiForecastPanelCount.value
))
const activeElementPanelIndex = ref(0)
const showElementSettings = ref(false)
const showSaveConfigurationDialog = ref(false)
const showDeleteConfigurationDialog = ref(false)
const configurationNameDraft = ref('')
const configurationPendingDeletion = ref(null)
const activeElementKey = computed(() => (
  multiMapPanels.value[activeElementPanelIndex.value]?.elementKey || globalActiveElementKey.value
))
const activeConfigurationName = computed(() => (
  isElementGridMode.value
    ? activeMultiElementForecastConfigurationName.value
    : activeMultiElementConfigurationName.value
))
const configurationName = computed({
  get: () => (isElementGridMode.value
    ? multiElementForecastConfigurationName.value
    : multiElementConfigurationName.value),
  set: (value) => {
    if (isElementGridMode.value) setMultiElementForecastConfigurationName(value)
    else setMultiElementConfigurationName(value)
  }
})
const configurations = computed(() => (
  isElementGridMode.value ? multiElementForecastConfigurations.value : multiElementConfigurations.value
))
const multiElementConfigurationOptions = computed(() => configurations.value.map((configuration) => ({
  label: configuration.name,
  value: configuration.name
})))
const settingsPanels = computed(() => {
  if (!isElementGridMode.value) return multiMapPanels.value
  return multiElementForecastRows.value.map((row, index) => ({
    ...row,
    id: `element-forecast-row-${index}`,
    title: row.label,
    selectedLayerTypes: row.layers
  }))
})
const gridStyle = computed(() => {
  const count = multiMapPanels.value.length
  if (isElementGridMode.value) {
    return {
      '--multi-map-columns': comparisonColumnCount.value,
      '--multi-map-rows': Math.ceil(count / comparisonColumnCount.value),
      '--multi-map-panel-count': count
    }
  }
  const columns = count === 8 ? 4 : count === 6 || count === 9 ? 3 : 2
  return {
    '--multi-map-columns': columns,
    '--multi-map-rows': Math.ceil(count / columns),
    '--multi-map-panel-count': count
  }
})
// 把全局可见资源并发预算平均分给子图：4 图每图 2 路，6/8/9 图每图 1 路。
// 这样各子图同步推进，不会由先挂载的子图占满全部连接。
const panelLoadConcurrency = computed(() => (
  Math.max(1, Math.floor(MAX_CONCURRENT / Math.max(1, multiMapPanels.value.length)))
))

// 所有子图使用同一同步对象；它在进入多图时继承单图视角，并在模式切换时保持第一张图的视角。
const syncState = multiMapSyncState
const panelViewContexts = new Map()
const activePanelViewContext = ref(null)

// 多图截图：分别读取各子图 canvas，按屏幕上的网格布局合成到一张大图，
// 并将各子图的标题文字额外绘制到对应表头区域（避免 canvas 与 DOM 混合栅格化的复杂性）。
const gridRef = ref(null)
const {
  toast: screenshotToast,
  exportCanvas
} = useScreenshot({
  getMeta: () => ({ initTime: multiMapPanels.value[0]?.initTime })
})

// 读取子图工具栏上实际显示的信息文本（标题、时效、有效时间、层次）。
function panelHeaderText(toolbarEl, fallback) {
  const infoEl = toolbarEl?.querySelector(':scope > div')
  if (!infoEl) return fallback
  const text = Array.from(infoEl.children)
    .map((child) => child.textContent.trim())
    .filter(Boolean)
    .join('  ')
  return text || fallback
}

function buildCompositeCanvas(gridEl) {
  const gridRect = gridEl.getBoundingClientRect()
  if (!gridRect.width || !gridRect.height) return null

  // 使用完整设备像素比，使子画布可按原生分辨率 1:1 贴入，保持与屏幕一致的清晰度。
  const scale = window.devicePixelRatio || 1
  const out = document.createElement('canvas')
  out.width = Math.round(gridRect.width * scale)
  out.height = Math.round(gridRect.height * scale)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const panelEls = gridEl.querySelectorAll('.multi-map-panel')

  // 第一遍：底色、表头、标题文字、无效占位（在 CSS 像素坐标系下绘制）。
  ctx.save()
  ctx.scale(scale, scale)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#c8d2dd'
  ctx.fillRect(0, 0, gridRect.width, gridRect.height)

  panelEls.forEach((panelEl, index) => {
    const panelRect = panelEl.getBoundingClientRect()
    const px = panelRect.left - gridRect.left
    const py = panelRect.top - gridRect.top
    const fallbackTitle = multiMapPanels.value[index]?.title || ''

    ctx.fillStyle = '#eef2f6'
    ctx.fillRect(px, py, panelRect.width, panelRect.height)

    // 表头：优先复现工具栏（有效子图），否则复用无效子图的 header。
    const headerEl = panelEl.querySelector('.toolbar')
      || panelEl.querySelector('.multi-map-invalid-panel > header')
    let contentTop = py
    if (headerEl) {
      const headerRect = headerEl.getBoundingClientRect()
      const hx = headerRect.left - gridRect.left
      const hy = headerRect.top - gridRect.top
      contentTop = hy + headerRect.height

      ctx.fillStyle = '#f7f9fb'
      ctx.fillRect(hx, hy, headerRect.width, headerRect.height)

      const title = panelHeaderText(panelEl.querySelector('.toolbar'), fallbackTitle)
      if (title) {
        ctx.fillStyle = '#172033'
        ctx.font = '600 13px Inter, "Segoe UI", Arial, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText(title, hx + 12, hy + headerRect.height / 2, Math.max(0, headerRect.width - 24))
      }

      ctx.strokeStyle = '#c8d2dd'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(hx, hy + headerRect.height - 0.5)
      ctx.lineTo(hx + headerRect.width, hy + headerRect.height - 0.5)
      ctx.stroke()
    }

    const canvasEl = panelEl.querySelector('canvas')
    if (!canvasEl || !canvasEl.width || !canvasEl.height) {
      // 无效子图占位提示。
      ctx.fillStyle = '#7a8698'
      ctx.font = '500 13px Inter, "Segoe UI", Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('该时效无效', px + panelRect.width / 2, contentTop + (panelRect.bottom - gridRect.top - contentTop) / 2)
      ctx.textAlign = 'left'
    }
  })
  ctx.restore()

  // 第二遍：将各子画布贴入合成图对应的单元格区域。子图 canvas 的原生分辨率可能低于
  // 合成图的设备像素（子图会按实际尺寸动态选择 backing store 像素比），故按目标 CSS
  // 尺寸 × scale 显式指定绘制宽高，让浏览器缩放贴合单元格，保持与屏幕一致的视觉大小。
  panelEls.forEach((panelEl) => {
    const canvasEl = panelEl.querySelector('canvas')
    if (!canvasEl || !canvasEl.width || !canvasEl.height) return
    const cr = canvasEl.getBoundingClientRect()
    const dx = Math.round((cr.left - gridRect.left) * scale)
    const dy = Math.round((cr.top - gridRect.top) * scale)
    const dw = Math.round(cr.width * scale)
    const dh = Math.round(cr.height * scale)
    ctx.drawImage(canvasEl, dx, dy, dw, dh)
  })

  return out
}

async function captureMultiMap() {
  const gridEl = gridRef.value
  if (!gridEl) return
  const composite = buildCompositeCanvas(gridEl)
  if (composite) await exportCanvas(composite, `multi-${multiMapMode.value || 'map'}`)
}

function resetSyncState() {
  syncState.cursor = null
  syncState.zoom = null
}

function close() {
  const snapshot = syncState.zoom ? { ...syncState.zoom } : null
  if (snapshot) applyMapView(snapshot)
  resetSyncState()
  closeMultiMap()
}

function activateElementPanel(index) {
  activeElementPanelIndex.value = index
  activePanelViewContext.value = panelViewContexts.get(index) || null
}

function activateElementSetting(index) {
  activateElementPanel(isElementGridMode.value ? index * comparisonColumnCount.value : index)
}

function applyElementToActivePanel(element, elementKey) {
  if (isElementMode.value) {
    updateMultiElementPanel(activeElementPanelIndex.value, element, elementKey)
  } else if (isElementGridMode.value) {
    updateMultiElementForecastPanel(activeElementPanelIndex.value, element, elementKey)
  } else {
    // 纯起报/时效对比的横轴或纵轴不包含天气要素，统一切换整组图层，
    // 才能维持各子图之间的同要素可比性。
    applyElementSelection(element, elementKey)
  }
  if (isElementEditableMode.value && activeElementPanelIndex.value === 0) syncFirstPanelTimeBase()
}

// 多时次选择器的数据可用性和切换目标都以第一张图为准。多要素模式修改第一张图后，
// 同步全局基准，保证选择器立即使用该要素对应的可用时效。
function syncFirstPanelTimeBase() {
  const firstPanel = multiMapPanels.value[0]
  if (!firstPanel) return
  if (firstPanel.initTime) initTime.value = firstPanel.initTime
  if (firstPanel.fcHour) fcHour.value = firstPanel.fcHour
  if (firstPanel.level) level.value = String(firstPanel.level)
  if (Array.isArray(firstPanel.selectedLayerTypes) && firstPanel.selectedLayerTypes.length) {
    selectedLayerTypes.value = [...firstPanel.selectedLayerTypes]
  }
}

function registerPanelViewContext(index, viewContext) {
  panelViewContexts.set(index, viewContext)
  if (index === activeElementPanelIndex.value) activePanelViewContext.value = viewContext
}

function applyMultiMapView(view) {
  syncState.zoom = { ...view, source: 'multi-map-view-selector' }
}

function saveMultiMapView(name) {
  if (!syncState.zoom) return false
  return saveMapView(name, syncState.zoom)
}

function selectMultiElementConfiguration(configuration) {
  if (isElementGridMode.value) applyMultiElementForecastConfiguration(configuration)
  else applyMultiElementConfiguration(configuration)
  activeElementPanelIndex.value = 0
  syncFirstPanelTimeBase()
}

function selectMultiElementConfigurationByName(name) {
  const configuration = configurations.value.find((item) => item.name === name)
  if (configuration) selectMultiElementConfiguration(configuration)
}

function createNewMultiElementConfiguration() {
  if (isElementGridMode.value) createMultiElementForecastConfiguration()
  else createMultiElementConfiguration()
  activeElementPanelIndex.value = 0
}

function requestSaveMultiElementConfiguration() {
  configurationNameDraft.value = configurationName.value.trim() || '配置1'
  showSaveConfigurationDialog.value = true
}

function confirmSaveMultiElementConfiguration() {
  const name = configurationNameDraft.value.trim()
  if (!name) return
  if (isElementGridMode.value) saveMultiElementForecastConfiguration(name)
  else saveMultiElementConfiguration(name)
  showSaveConfigurationDialog.value = false
}

function renameActiveMultiElementConfiguration() {
  const nextName = configurationName.value.trim()
  if (!activeConfigurationName.value || !nextName) return
  if (isElementGridMode.value) {
    renameMultiElementForecastConfiguration(activeConfigurationName.value, nextName)
  } else {
    renameMultiElementConfiguration(activeConfigurationName.value, nextName)
  }
}

function requestDeleteMultiElementConfiguration(configuration) {
  configurationPendingDeletion.value = configuration
  showDeleteConfigurationDialog.value = true
}

function confirmDeleteMultiElementConfiguration() {
  const configuration = configurationPendingDeletion.value
  if (configuration) {
    if (isElementGridMode.value) deleteMultiElementForecastConfiguration(configuration.name)
    else deleteMultiElementConfiguration(configuration.name)
  }
  configurationPendingDeletion.value = null
  showDeleteConfigurationDialog.value = false
}

watch(multiMapMode, (mode) => {
  if (!mode) resetSyncState()
  activeElementPanelIndex.value = 0
  activePanelViewContext.value = null
})

watch(multiMapPanels, (panels) => {
  panelViewContexts.clear()
  activePanelViewContext.value = null
  if (activeElementPanelIndex.value >= panels.length) {
    activeElementPanelIndex.value = Math.max(0, panels.length - 1)
  }
})
</script>

<template>
  <section class="multi-map-workspace">
    <header class="multi-map-header">
      <div class="multi-map-heading">
        <strong>{{ modeLabel }}</strong>
        <div v-if="isInitMode || isInitForecastMode || isElementInitMode" class="multi-map-controls">
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
            <span>{{ isInitMode ? '子图数量' : isInitForecastMode ? '起报行数' : '起报列数' }}</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiInitPanelCountOptions"
                :key="count"
                :type="multiInitPanelCount === count ? 'primary' : 'default'"
                @click="setMultiInitPanelCount(count)"
              >
                {{ isInitMode ? `${count} 图` : isInitForecastMode ? `${count} 行` : `${count} 列` }}
              </n-button>
            </n-button-group>
          </div>
        </div>
        <div v-if="isElementEditableMode" class="multi-map-controls multi-element-controls">
          <div v-if="isElementMode" class="multi-map-control-group">
            <span>子图数量</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiElementPanelCountOptions"
                :key="count"
                :type="multiElementPanelCount === count ? 'primary' : 'default'"
                @click="setMultiElementPanelCount(count)"
              >
                {{ count }} 图
              </n-button>
            </n-button-group>
          </div>
          <n-button size="small" secondary @click="showElementSettings = true">
            <template #icon><Settings :size="15" /></template>
            设置
          </n-button>
          <n-button size="small" secondary @click="requestSaveMultiElementConfiguration">
            <template #icon><Save :size="15" /></template>
            保存配置
          </n-button>
          <n-popover v-if="configurations.length" trigger="hover" placement="bottom-start" :show-arrow="false">
            <template #trigger>
              <n-button size="small" secondary>
                {{ activeConfigurationName || '选择配置' }}
              </n-button>
            </template>
            <div class="multi-element-configuration-menu">
              <n-button
                v-for="configuration in configurations"
                :key="configuration.name"
                size="small"
                block
                :type="activeConfigurationName === configuration.name ? 'primary' : 'default'"
                @click="selectMultiElementConfiguration(configuration)"
              >
                {{ configuration.name }}
              </n-button>
            </div>
          </n-popover>
        </div>
        <div v-if="isForecastMode || isElementForecastMode || isInitForecastMode" class="multi-forecast-controls">
          <n-button-group v-if="isForecastMode || isInitForecastMode" size="small">
            <n-button
              v-for="option in multiForecastIntervalOptions"
              :key="option.value"
              :type="multiForecastInterval === option.value ? 'primary' : 'default'"
              @click="setMultiForecastInterval(option.value)"
            >
              {{ option.label }}
            </n-button>
          </n-button-group>
          <n-button-group v-if="isForecastMode || isInitForecastMode" size="small">
            <n-button
              v-for="count in multiForecastPanelCountOptions"
              :key="count"
              :type="multiForecastPanelCount === count ? 'primary' : 'default'"
              @click="setMultiForecastPanelCount(count)"
            >
              {{ isInitForecastMode ? `${count} 列` : `${count} 图` }}
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
      <div class="multi-map-header-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button size="small" secondary @click="captureMultiMap">
              <template #icon><Camera :size="15" /></template>
              截图
            </n-button>
          </template>
          截取全部子图（含标题）
        </n-tooltip>
        <n-button size="small" secondary @click="close">
          <template #icon><X :size="15" /></template>
          退出多图
        </n-button>
      </div>
    </header>

    <ForecastSlider />

    <n-modal
      v-model:show="showElementSettings"
      preset="card"
      :title="isElementGridMode ? `${modeLabel}配置设置` : '多要素配置设置'"
      style="width: 760px; max-width: 94vw;"
    >
      <div class="multi-element-settings">
        <div class="multi-element-configuration-row">
          <n-select
            :value="activeConfigurationName || null"
            size="small"
            clearable
            placeholder="选择已保存配置"
            :options="multiElementConfigurationOptions"
            @update:value="selectMultiElementConfigurationByName"
          />
          <n-button size="small" secondary @click="createNewMultiElementConfiguration">
            <template #icon><Plus :size="15" /></template>
            新建配置
          </n-button>
        </div>
        <div class="multi-element-save-row">
          <n-input v-model:value="configurationName" size="small" placeholder="配置名称，如 配置1" />
          <n-button
            size="small"
            secondary
            :disabled="!activeConfigurationName || configurationName === activeConfigurationName"
            @click="renameActiveMultiElementConfiguration"
          >
            <template #icon><Pencil :size="15" /></template>
            重命名
          </n-button>
          <n-button size="small" type="primary" @click="requestSaveMultiElementConfiguration">
            <template #icon><Save :size="15" /></template>
            保存配置
          </n-button>
        </div>
        <div v-if="isElementMode" class="multi-element-count-row">
          <span>子图数量</span>
          <n-button-group size="small">
            <n-button
              v-for="count in multiElementPanelCountOptions"
              :key="count"
              :type="multiElementPanelCount === count ? 'primary' : 'default'"
              @click="setMultiElementPanelCount(count)"
            >
              {{ count }} 图
            </n-button>
          </n-button-group>
        </div>
        <template v-if="isElementForecastMode">
          <div class="multi-element-count-row multi-element-forecast-settings">
            <span>预报时效间隔</span>
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
          </div>
          <div class="multi-element-count-row multi-element-forecast-settings">
            <span>时效列数</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiForecastPanelCountOptions"
                :key="count"
                :type="multiForecastPanelCount === count ? 'primary' : 'default'"
                @click="setMultiForecastPanelCount(count)"
              >
                {{ count }} 列
              </n-button>
            </n-button-group>
          </div>
        </template>
        <p v-if="isElementForecastMode">逐一设置每一行的天气要素；预报时效滑块控制第一列。</p>
        <p v-else-if="isElementInitMode">逐一设置每一行的天气要素；每列起报时次不同，但各列内真实时间相同。</p>
        <p v-else>逐一点击下方子图，再通过元素选择器指定该子图的层次和图层组合。</p>
        <div class="multi-element-panel-settings">
          <button
            v-for="(panel, index) in settingsPanels"
            :key="panel.id"
            type="button"
            :class="{ active: isElementGridMode ? activeElementPanelIndex === index * comparisonColumnCount : activeElementPanelIndex === index }"
            @click="activateElementSetting(index)"
          >
            <strong>{{ isElementGridMode ? `第 ${index + 1} 行` : `子图 ${index + 1}` }}</strong>
            <span>{{ panel.title }}</span>
            <small>{{ panel.level === 'surface' ? '地面' : `${panel.level} hPa` }}｜{{ panel.selectedLayerTypes.join(' + ') }}</small>
          </button>
        </div>
        <div class="multi-element-picker-row">
          <span>当前编辑：{{ isElementGridMode ? `第 ${Math.floor(activeElementPanelIndex / comparisonColumnCount) + 1} 行` : `子图 ${activeElementPanelIndex + 1}` }}</span>
          <ElementSelector
            header-trigger
            wide
            :active-element-key="activeElementKey"
            :selection-handler="applyElementToActivePanel"
          />
        </div>
        <div v-if="configurations.length" class="multi-element-saved-configs">
          <span>已保存配置</span>
          <div>
            <div
              v-for="configuration in configurations"
              :key="configuration.name"
              class="multi-element-saved-config"
            >
              <n-button
                size="small"
                :type="activeConfigurationName === configuration.name ? 'primary' : 'default'"
                @click="selectMultiElementConfiguration(configuration)"
              >
                {{ configuration.name }}
              </n-button>
              <n-button
                size="small"
                tertiary
                circle
                type="error"
                :aria-label="`删除${configuration.name}`"
                @click="requestDeleteMultiElementConfiguration(configuration)"
              >
                <template #icon><Trash2 :size="13" /></template>
              </n-button>
            </div>
          </div>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="showSaveConfigurationDialog"
      preset="card"
      :title="isElementGridMode ? `保存${modeLabel}配置` : '保存多要素配置'"
      style="width: 400px; max-width: 92vw;"
    >
      <n-input v-model:value="configurationNameDraft" autofocus placeholder="配置名称，如 配置1" @keyup.enter="confirmSaveMultiElementConfiguration" />
      <template #footer>
        <div class="multi-element-dialog-actions">
          <n-button size="small" @click="showSaveConfigurationDialog = false">取消</n-button>
          <n-button size="small" type="primary" @click="confirmSaveMultiElementConfiguration">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showDeleteConfigurationDialog"
      preset="card"
      title="删除多要素配置"
      style="width: 400px; max-width: 92vw;"
    >
      <p class="multi-element-confirm-copy">确定删除“{{ configurationPendingDeletion?.name }}”吗？此操作无法撤销。</p>
      <template #footer>
        <div class="multi-element-dialog-actions">
          <n-button size="small" @click="showDeleteConfigurationDialog = false">取消</n-button>
          <n-button size="small" type="error" @click="confirmDeleteMultiElementConfiguration">删除</n-button>
        </div>
      </template>
    </n-modal>

    <aside class="multi-map-floating-controls" aria-label="地图工具">
      <MultiTimeSelector />
      <ElementSelector
        :active-element-key="activeElementKey"
        :selection-handler="applyElementToActivePanel"
      />
      <MultiMapSelector />
      <MapViewSelector :apply-view="applyMultiMapView" :save-view="saveMultiMapView" />
      <DrawingToolbar v-if="activePanelViewContext" :view-context="activePanelViewContext" />
    </aside>

    <div ref="gridRef" class="multi-map-grid" :style="gridStyle">
      <MultiMapPanel
        v-for="(panel, index) in multiMapPanels"
        :key="`${panel.id}-load-${panelLoadConcurrency}`"
        :panel="{ ...panel, syncId: panel.id, syncState, maxLoadConcurrent: panelLoadConcurrency }"
        :active="activeElementPanelIndex === index"
        @activate="activateElementPanel(index)"
        @ready="registerPanelViewContext(index, $event)"
      />
    </div>

    <div v-if="screenshotToast" class="multi-map-screenshot-toast">{{ screenshotToast }}</div>
  </section>
</template>

<style scoped>
.multi-map-header-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
}

.multi-map-screenshot-toast {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
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
