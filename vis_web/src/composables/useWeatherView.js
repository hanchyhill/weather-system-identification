import * as d3 from 'd3'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { feature } from 'topojson-client'

import worldTopo from '../source/110m.json'
import chinaTopo from '../source/bou2_4l.topo.simplify.json'
import { SvgImageCache } from '../utils/indexedDBCache'
import { drawShape, catmullRom } from '../utils/mapDrawing'
import {
  LAYER_TYPE_OPTIONS,
  cellKey,
  defaultElementConfig,
  loadElementConfig,
  persistElementConfig
} from '../utils/elementSelectorConfig'

export function useWeatherView(initialView = {}) {

// 计算最新起报时次，逻辑与后端 src/weather_common.py 的 calLatestBaseTime 保持一致：
//   UTC 07-19 时 -> 当日 00 时；19 时以后 -> 当日 12 时；07 时以前 -> 前一日 12 时。
// 考虑到后端绘图约滞后一小时才能完整绘制完所有图像，前端起报时次整体后移一小时计算，
// 即用 (当前 UTC 时间 - 1 小时) 代入上述判断，使前端切换时次相应延后一小时。
function calLatestBaseTime() {
  const now = new Date(Date.now() - 60 * 60 * 1000)
  const hour = now.getUTCHours()

  let base
  if (hour >= 7 && hour < 19) {
    base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0))
  } else if (hour >= 19) {
    base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
  } else {
    const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    base = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 12))
  }

  const year = base.getUTCFullYear()
  const month = padTimePart(base.getUTCMonth() + 1)
  const day = padTimePart(base.getUTCDate())
  const baseHour = padTimePart(base.getUTCHours())
  return `${year}${month}${day}${baseHour}`
}

const DEFAULT_INIT_TIME = calLatestBaseTime()
const DEFAULT_FC_HOURS = [
  '000', '003', '006', '009', '012', '015', '018', '021', '024',
  '027', '030', '033', '036', '039', '042', '045', '048', '051',
  '054', '057', '060', '063', '066', '069', '072', '078', '084',
  '090', '096', '102', '108', '114', '120', '126', '132', '138',
  '144', '150', '156', '162', '168', '174', '180', '186', '192',
  '198', '204', '210', '216', '222', '228', '234', '240'
]
const DEFAULT_LEVELS = ['200', '500', '700', '850', '925', '950', '1000']
const VORTEX_TRACK_LEVELS = new Set(['850', '925', '950', '1000', 'surface'])
const DEFAULT_MAP_BOUNDS = { lon_min: 60, lon_max: 150, lat_min: 0, lat_max: 60 }
const DEFAULT_MAP_CENTER = [105, 30]
const DEFAULT_MAP_SCALE = 3
const TROUGH_DEFAULT_COLOR = '#8B4513'
const SHEAR_COLORS = reactive({
  shear_u_left: TROUGH_DEFAULT_COLOR,
  shear_u_right: TROUGH_DEFAULT_COLOR,
  shear_v_up: TROUGH_DEFAULT_COLOR,
  shear_v_down: TROUGH_DEFAULT_COLOR
})
const LAYER_COMBINATION_STORAGE_KEY = 'weather-view-layer-combinations'
const MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY = 'weather-view-multi-element-configurations'
const FILL_LAYER_TYPES = new Set(['wind_speed_fill', 'vort_fill', 'rhum_fill', 'surface_speed_fill'])
const WIND_OVERLAY_LAYER_TYPES = new Set([
  'wind_quiver',
  'wind_barb',
  'wind_streamline',
  'surface_quiver',
  'surface_barb',
  'surface_streamline'
])

// 等值线图层是预渲染的 SVG 图像，绘制时整体乘以 zoomTransform.k，
// 因此放大系数越小、线条被压缩得越细。为保证不同放大系数下等值线的视觉线宽一致，
// 当 k 小于参考放大系数时，通过多方向偏移重绘（形态学膨胀）补偿线宽。
const CONTOUR_REFERENCE_ZOOM = 6
// 在最小放大系数处额外补偿的“半线宽”（屏幕像素），随 k 接近参考值线性衰减到 0。
const CONTOUR_MAX_DILATION_PX = 1.1
// 八方向单位偏移（对角线归一化到单位圆），配合膨胀半径生成更粗的线条。
const CONTOUR_DILATION_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]
]

// SVG 图层按其固有像素尺寸栅格化后再随 zoomTransform.k 放大绘制，放大系数越大越模糊。
// 为在高放大系数下保持清晰，按放大系数动态提高栅格化“采样倍率”（超采样），
// 即用更大的宽高重新栅格化同一份矢量 SVG。倍率按区间取整以避免频繁重载。
// 采样倍率封顶 2 倍：3 倍会让位图像素数达 9 倍，高放大系数下重栅格化/绘制明显卡顿；
// 2 倍在清晰度与性能之间更平衡，并把提升阈值适当抬高，减少高倍率下的重载与内存占用。
const RENDER_SCALE_MAX = 2
function renderScaleForZoom(k) {
  if (!(k > 8)) return 1
  return RENDER_SCALE_MAX
}

const initialLayers = Array.isArray(initialView.selectedLayerTypes) && initialView.selectedLayerTypes.length
  ? initialView.selectedLayerTypes.map(String)
  : ['wind_barb']
const compactView = Boolean(initialView.compact)
const minCanvasWidth = compactView ? 260 : 540
const minCanvasHeight = compactView ? 200 : 420
const syncState = initialView.syncState || null
const syncId = initialView.syncId || null
const canvasRef = ref(null)
const shellRef = ref(null)
const canvasSize = reactive({ width: 960, height: 640 })
const zoomTransform = ref(d3.zoomIdentity)
const projectionName = ref(initialView.projectionName || 'equirectangular')

// —— 手绘图形（多常用天气图元）——
// 每个图形以经纬度存储，随地图平移缩放。kind：line/box/point；render 决定样式。
const DRAW_TOOLS = [
  // 几何图形类
  { key: 'ellipse-blue', label: '蓝色椭圆', group: 'geom', kind: 'box', render: 'ellipse', color: '#2563eb' },
  { key: 'ellipse-red', label: '红色椭圆', group: 'geom', kind: 'box', render: 'ellipse', color: '#dc2626' },
  { key: 'rect-blue', label: '蓝色矩形', group: 'geom', kind: 'box', render: 'rect', color: '#2563eb' },
  { key: 'rect-red', label: '红色矩形', group: 'geom', kind: 'box', render: 'rect', color: '#dc2626' },
  // 线类型
  { key: 'trough', label: '槽线', group: 'line', kind: 'line', render: 'trough', color: '#8b5e3c' },
  { key: 'shear', label: '切变线', group: 'line', kind: 'line', render: 'shear', color: '#dc2626' },
  { key: 'convergence', label: '辐合线', group: 'line', kind: 'line', render: 'convergence', color: '#111827' },
  { key: 'arrow-red', label: '红色箭头线', group: 'line', kind: 'line', render: 'arrow', color: '#dc2626' },
  { key: 'arrow-blue', label: '蓝色箭头线', group: 'line', kind: 'line', render: 'arrow', color: '#2563eb' },
  { key: 'block-arrow-red', label: '红色粗箭头线', group: 'line', kind: 'line', render: 'block-arrow', color: '#dc2626' },
  { key: 'block-arrow-blue', label: '蓝色粗箭头线', group: 'line', kind: 'line', render: 'block-arrow', color: '#2563eb' },
  { key: 'cold-front', label: '冷锋', group: 'line', kind: 'line', render: 'cold', color: '#2563eb' },
  { key: 'warm-front', label: '暖锋', group: 'line', kind: 'line', render: 'warm', color: '#dc2626' },
  // 标注类
  { key: 'label-L', label: 'L（红）', group: 'label', kind: 'point', render: 'text', text: 'L', color: '#dc2626' },
  { key: 'label-D', label: 'D（红）', group: 'label', kind: 'point', render: 'text', text: 'D', color: '#dc2626' },
  { key: 'label-H', label: 'H（蓝）', group: 'label', kind: 'point', render: 'text', text: 'H', color: '#2563eb' },
  { key: 'label-G', label: 'G（蓝）', group: 'label', kind: 'point', render: 'text', text: 'G', color: '#2563eb' },
  { key: 'thunderstorm', label: '雷暴标记', group: 'label', kind: 'point', render: 'text', text: '☈', color: '#dc2626' },
  { key: 'typhoon', label: '台风标记', group: 'label', kind: 'point', render: 'text', text: '🌀', color: '#dc2626' },
  // 工具：删除
  { key: 'erase', label: '删除图形', group: 'tool', kind: 'erase', color: '#ef4444' }
]
const drawMode = ref(false)
const activeDrawTool = ref(null)
const drawings = ref([])
const draftPoints = ref([])
const draftCursor = ref(null)
const hoverDeleteIndex = ref(-1)
let boxStartGeo = null
let boxDragging = false
let drawSeq = 0
const initTime = ref(initialView.initTime || DEFAULT_INIT_TIME)
const fcHour = ref(normalizeFcHour(initialView.fcHour || '000'))
const level = ref(String(initialView.level || '850'))
const layerType = ref(initialLayers[0])
const manifest = ref(null)
const worldFeatures = ref(null)
const chinaFeatures = ref(null)
const activeSvgLayers = ref([])
const selectedLayerTypes = ref(initialLayers)
const layerCombinationName = ref('默认天气图')
const activeLayerCombinationName = ref('默认天气图')
const savedLayerCombinations = ref(loadSavedLayerCombinations())
// 元素选择器（要素表格）配置与当前选中标识。
const elementConfig = ref(loadElementConfig())
const activeElementKey = ref('')
const multiMapMode = ref(null)
const multiMapPanels = ref([])
const multiInitInterval = ref('12')
const multiInitPanelCount = ref(4)
const multiForecastInterval = ref('24')
const multiForecastPanelCount = ref(4)
const multiElementPanelCount = ref(4)
const multiElementConfigurations = ref(loadMultiElementConfigurations())
const multiElementConfigurationName = ref('配置1')
const activeMultiElementConfigurationName = ref('')
const troughData = ref(null)
const jetData = ref(null)
const vortexCenters = ref([])
const vortexTracks = ref(null)
const showSvgLayer = ref(true)
const showTrough = ref(true)
const showJetAxes = ref(false)
const showRawPoints = ref(false)
const showVortexCenters = ref(true)
const showVortexTracks = ref(true)
const showWarmOnlyTracks = ref(true)
const showWarmOnlyCenters = ref(false)
const showTooltip = ref(true)
const showTileDebug = ref(false)
const activeSystemTab = ref('trough')
const troughMinLength = ref(0)
const troughMinWindSpeed = ref(3.0)
const troughLineWidth = ref(1.2)
const DEFAULT_SHEAR_FILTERS = {
  shear_u_left: true,
  shear_u_right: true,
  shear_v_up: true,
  shear_v_down: true
}
const LEVEL_SHEAR_DEFAULTS = {
  '1000': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '950': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '925': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '850': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '500': { shear_u_left: false, shear_u_right: false, shear_v_up: true, shear_v_down: true },
  '200': { shear_u_left: false, shear_u_right: false, shear_v_up: true, shear_v_down: true }
}
const troughShearFiltersByLevel = reactive({})

function defaultShearFiltersForLevel(levelValue) {
  return { ...(LEVEL_SHEAR_DEFAULTS[String(levelValue)] || DEFAULT_SHEAR_FILTERS) }
}

function shearFiltersForLevel(levelValue) {
  const key = String(levelValue)
  if (!troughShearFiltersByLevel[key]) {
    troughShearFiltersByLevel[key] = defaultShearFiltersForLevel(key)
  }
  return troughShearFiltersByLevel[key]
}

const troughShearFilters = computed(() => shearFiltersForLevel(level.value))
const jetMinAxisLength = ref(6.5)
const jetMinAvgWindSpeed = ref(6)
const jetMinMaxWindSpeed = ref(0)
const jetLineWidth = ref(2.2)
const showJetArrowHeads = ref(true)
const vortexMinWindSpeed = ref(0)
const vortexMinVorticity = ref(0.00006)
const vortexTrackMinWindSpeed = ref(0)
const showFutureVortexTracks = ref(true)
const showOnlyFutureVortexTracks = ref(true)
const showHistoricalVortexTracks = computed({
  get: () => !showOnlyFutureVortexTracks.value,
  set: (value) => {
    showOnlyFutureVortexTracks.value = !value
  }
})
const loadingState = reactive({
  manifest: '未加载',
  svg: '未加载',
  trough: '未加载',
  jet: '未加载',
  vortexCenters: '未加载',
  vortexTracks: '未加载',
  map: '未加载'
})
const errorMessage = ref('')
const preloading = ref(false)
const mouseGeo = ref(null)
const hoverLine = ref(null)
const hoverJetLine = ref(null)
const hoverVortexCenter = ref(null)
const hoverVortexTrack = ref(null)
const cache = new SvgImageCache()

let resizeObserver = null
let zoomBehavior = null
let applyingSynchronizedZoom = false
let drawQueued = false
let activeLayerLoadId = 0
let visibleTileLoadId = 0
let loadedTileZoom = null
let loadedRenderScale = 1
let preloadRunId = 0
let preloadTimer = null

const projectionOptions = [
  { label: '等经纬度', value: 'equirectangular' },
  { label: '墨卡托', value: 'mercator' },
  { label: '兰伯特', value: 'lambert' }
]

const systemTabs = [
  { label: '槽线', value: 'trough' },
  { label: '涡旋', value: 'vortex' },
  { label: '急流轴', value: 'jet' }
]

const troughShearOptions = [
  { label: 'U 左切变', value: 'shear_u_left' },
  { label: 'U 右切变', value: 'shear_u_right' },
  { label: 'V 上切变', value: 'shear_v_up' },
  { label: 'V 下切变', value: 'shear_v_down' }
]

const fallbackLayerOptions = [
  { label: '高度场等值线', value: 'hght_contour' },
  { label: '风矢量', value: 'wind_quiver' },
  { label: '风羽', value: 'wind_barb' },
  { label: '风速填色', value: 'wind_speed_fill' },
  { label: '流线', value: 'wind_streamline' },
  { label: '气温等值线', value: 'temp_contour' },
  { label: '相对涡度填色', value: 'vort_fill' },
  { label: '相对湿度填色', value: 'rhum_fill' },
  { label: '地面风矢量', value: 'surface_quiver' },
  { label: '地面风羽', value: 'surface_barb' },
  { label: '地面风速填色', value: 'surface_speed_fill' },
  { label: '地面流线', value: 'surface_streamline' },
  { label: '海平面气压等值线', value: 'mslp_contour' }
]

const manifestFcHourSet = computed(() => {
  const manifestHours = manifest.value?.fc_hours
  if (Array.isArray(manifestHours) && manifestHours.length) {
    return new Set(manifestHours.map(normalizeFcHour))
  }

  const productHours = Object.keys(manifest.value?.products || {})
  if (productHours.length) {
    return new Set(productHours.map(normalizeFcHour))
  }

  return null
})

const firstAvailableFcHour = computed(() => (
  DEFAULT_FC_HOURS.find((value) => manifestFcHourSet.value?.has(value)) || DEFAULT_FC_HOURS[0]
))

const sliderFcHours = computed(() => {
  if (!manifestFcHourSet.value) return DEFAULT_FC_HOURS

  const availableHours = DEFAULT_FC_HOURS.filter((value) => manifestFcHourSet.value.has(value))
  return availableHours.length ? availableHours : DEFAULT_FC_HOURS
})

const fcHourIndex = computed({
  get() {
    const index = sliderFcHours.value.indexOf(normalizeFcHour(fcHour.value))
    return index >= 0 ? index : 0
  },
  set(index) {
    const nextFcHour = sliderFcHours.value[Number(index)]
    if (nextFcHour) fcHour.value = nextFcHour
  }
})

const sliderIndexCount = computed(() => sliderFcHours.value.length)
const forecastValidTimeLabel = computed(() => getSliderTooltip(fcHourIndex.value))
const forecastValidTimeBjtLabel = computed(() => {
  const initDate = parseInitTime(initTime.value)
  if (!initDate) return '-- BJT'
  const validTime = new Date(initDate.getTime() + (Number(fcHour.value) + 8) * 60 * 60 * 1000)
  return `${padTimePart(validTime.getUTCMonth() + 1)}-${padTimePart(validTime.getUTCDate())} ${padTimePart(validTime.getUTCHours())} BJT`
})

const fcHourOptions = computed(() => DEFAULT_FC_HOURS.map((value) => {
  const disabled = Boolean(manifest.value && manifestFcHourSet.value && !manifestFcHourSet.value.has(value))
  return {
    label: `+${value} h`,
    value,
    disabled
  }
}))

const levelOptions = computed(() => {
  const levels = manifest.value?.levels?.length ? manifest.value.levels : DEFAULT_LEVELS
  return levels.map((value) => ({
    label: value === 'surface' ? '地面' : `${value} hPa`,
    value: String(value)
  }))
})

const layerOptions = computed(() => {
  const manifestTypes = manifest.value?.layer_types
  if (!manifestTypes) return fallbackLayerOptions

  const types = level.value === 'surface'
    ? manifestTypes.surface || []
    : manifestTypes.upper_air || []

  const labels = new Map(fallbackLayerOptions.map((item) => [item.value, item.label]))
  return types.map((value) => ({ label: labels.get(value) || value, value }))
})

const layerCombinationOptions = computed(() => layerOptions.value.map((option) => {
  const record = recordForLayerType(option.value)
  const disabled = Boolean(manifest.value && !record)
  return {
    ...option,
    disabled
  }
}))

const selectedLayerLabels = computed(() => {
  if (!selectedLayerTypes.value.length) return '未选择'
  return selectedLayerTypes.value.map(layerLabel).join('、')
})

const fillLayerCount = computed(() => (
  activeSvgLayers.value.filter((layer) => layer.isFill).length
))

const layerStatus = computed(() => {
  if (!manifest.value) return '等待 manifest'
  if (!selectedLayerTypes.value.length) return '未选择图层'
  if (!activeSvgLayers.value.length) return '无匹配图层'
  const failed = activeSvgLayers.value.filter((layer) => !isUsableLayerStatus(layer.record?.status)).length
  return failed ? `${activeSvgLayers.value.length}层 / ${failed}层不可用` : `${activeSvgLayers.value.length}层可用`
})

const visibleTroughLines = computed(() => {
  if (!showTrough.value) return []
  const lines = troughData.value?.trough_lines || []
  return lines.filter((line) => {
    const attributes = line.attributes || {}
    return troughShearFilters.value[line.shear_type] !== false
      && passesMinimum(attributes.length, troughMinLength.value)
      && passesMinimum(attributes.avg_wind_speed, troughMinWindSpeed.value)
  })
})

const visibleJetAxisLines = computed(() => {
  if (!showJetAxes.value) return []
  const lines = jetData.value?.jet_axis_lines || []
  return lines.filter((line) => {
    const attributes = line.attributes || {}
    return passesMinimum(attributes.length, jetMinAxisLength.value)
      && passesMinimum(attributes.avg_wind_speed, jetMinAvgWindSpeed.value)
      && passesMinimum(attributes.max_wind_speed, jetMinMaxWindSpeed.value)
  })
})

const visibleVortexCenters = computed(() => {
  if (!showVortexCenters.value) return []
  return (vortexCenters.value || []).filter((center) => (
    (!showWarmOnlyCenters.value || center.warm)
    && passesMinimum(center.vmax, vortexMinWindSpeed.value)
    && passesMinimum(center.vort, vortexMinVorticity.value)
  ))
})

const isVortexTrackLevel = computed(() => VORTEX_TRACK_LEVELS.has(String(level.value)))

const visibleVortexTracks = computed(() => {
  if (!isVortexTrackLevel.value || !showVortexTracks.value) return []
  const tracks = vortexTracks.value?.tracks || []
  return tracks.filter((track) => (
    (!showWarmOnlyTracks.value || track.warm)
    && passesMinimum(track.max_wind, vortexTrackMinWindSpeed.value)
  ))
})
const visibleTroughCount = computed(() => visibleTroughLines.value.length)
const visibleJetAxisCount = computed(() => visibleJetAxisLines.value.length)
const visibleVortexCenterCount = computed(() => visibleVortexCenters.value.length)
const visibleVortexTrackCount = computed(() => visibleVortexTracks.value.length)

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function passesMinimum(value, minimum) {
  const threshold = Number(minimum)
  if (!Number.isFinite(threshold) || threshold <= 0) return true
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= threshold
}

function normalizeFcHour(value) {
  return String(value || '0').padStart(3, '0')
}

function parseInitTime(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/)
  if (!match) return null

  const [, year, month, day, hour] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour)))
  return Number.isNaN(date.getTime()) ? null : date
}

function forecastValidDate(index) {
  const initDate = parseInitTime(initTime.value)
  const fcValue = sliderFcHours.value[Number(index)]
  if (!initDate || !fcValue) return null

  return new Date(initDate.getTime() + Number(fcValue) * 60 * 60 * 1000)
}

function padTimePart(value) {
  return String(value).padStart(2, '0')
}

function shiftInitTime(deltaHours) {
  const date = parseInitTime(initTime.value)
  if (!date) return

  const next = new Date(date.getTime() + deltaHours * 60 * 60 * 1000)
  const year = next.getUTCFullYear()
  const month = padTimePart(next.getUTCMonth() + 1)
  const day = padTimePart(next.getUTCDate())
  const hour = padTimePart(next.getUTCHours())
  initTime.value = `${year}${month}${day}${hour}`
  loadManifest()
}

// 点击“刷新”时重新对齐到最新起报时次（含后端绘图滞后一小时的补偿），再重新加载。
function refreshToLatest() {
  initTime.value = calLatestBaseTime()
  loadManifest()
}

// 多时次选择器：同时指定起报时次与预报时效并重新加载。
// 先同步更新 fcHour 与 initTime（界面即时反映），loadManifest 会在获取到
// 新起报的 manifest 后按已设好的 fcHour 加载对应要素/天气系统数据。
function applyInitAndFcHour(initTimeStr, fcHourStr) {
  const nextInitTime = String(initTimeStr || '').trim()
  if (!parseInitTime(nextInitTime)) return

  if (fcHourStr != null && fcHourStr !== '') {
    fcHour.value = normalizeFcHour(fcHourStr)
  }
  initTime.value = nextInitTime
  loadManifest()
}

function formatForecastValidTime(index, includeMonth = true) {
  const date = forecastValidDate(index)
  if (!date) {
    const fcValue = sliderFcHours.value[Number(index)]
    return fcValue ? `+${fcValue} h` : '--'
  }

  const month = padTimePart(date.getUTCMonth() + 1)
  const day = padTimePart(date.getUTCDate())
  const hour = padTimePart(date.getUTCHours())
  return includeMonth ? `${month}月${day}日${hour}时` : `${day}日${hour}时`
}

function getSliderTooltip(index) {
  return formatForecastValidTime(index)
}

function markSlider(index) {
  const date = forecastValidDate(index)
  if (!date || date.getUTCHours() !== 12) return false

  return {
    label: formatForecastValidTime(index, false),
    style: {
      width: '4px',
      height: '4px',
      display: 'block',
      backgroundColor: '#172033'
    },
    labelStyle: {
      color: '#526173',
      fontSize: '11px'
    }
  }
}

const sliderOpts = {
  width: 'auto',
  lazy: true,
  dragOnClick: true,
  process: false,
  tooltipStyle: { minWidth: '90px', backgroundColor: '#1f7a8c', borderColor: '#1f7a8c' },
  tooltip: 'always'
}

function changeFcHour(type = 'index', value = 1) {
  if (type === 'index') {
    const nextIndex = fcHourIndex.value + Number.parseInt(value, 10)
    if (nextIndex >= 0 && nextIndex < sliderFcHours.value.length) {
      fcHourIndex.value = nextIndex
    }
    return
  }

  if (type === 'hour') {
    const nextFcValue = Number(fcHour.value) + Number(value)
    const nextIndex = sliderFcHours.value.indexOf(normalizeFcHour(nextFcValue))
    if (nextIndex >= 0) fcHourIndex.value = nextIndex
    return
  }

  throw new TypeError(`无法处理的改变时效类型: ${type}`)
}

function scrollForecastSlider(event) {
  event.preventDefault()
  changeFcHour('index', event.deltaY > 0 ? 1 : -1)
}

function layerLabel(value) {
  return fallbackLayerOptions.find((option) => option.value === value)?.label || value
}

function isFillLayerType(value) {
  return FILL_LAYER_TYPES.has(value) || String(value).endsWith('_fill')
}

function isFillLayerRecord(type, record) {
  if (type === 'hght_contour' && String(record?.level) === '500') return true
  return isFillLayerType(type)
}

function layerDrawPriority(type) {
  if (WIND_OVERLAY_LAYER_TYPES.has(type)) return 20
  if (String(type).includes('contour')) return 10
  return 15
}

function isUsableLayerStatus(status) {
  return status === 'generated' || status === 'skipped'
}

function sanitizeLayerSelection(values) {
  const available = new Set(layerOptions.value.map((option) => option.value))
  const selected = Array.from(new Set((values || []).filter((value) => available.has(value))))
  return selected.length ? selected : [layerOptions.value[0]?.value || layerType.value].filter(Boolean)
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function setSelectedLayerTypes(values) {
  const next = sanitizeLayerSelection(values)
  if (!arraysEqual(selectedLayerTypes.value, next)) {
    selectedLayerTypes.value = next
  }
  return next
}

const multiMapModeOptions = [
  { value: 'init', label: '多起报', description: '比较当前与前 3 个起报时次' },
  { value: 'forecast', label: '多时效', description: '比较相邻的 4 个预报时效' },
  { value: 'element', label: '多要素', description: '比较当前层次的 4 个要素组合' }
]

const multiForecastIntervalOptions = [
  { value: '24', label: '24h' },
  { value: '6', label: '6h' },
  { value: '48', label: '48h' },
  { value: 'continuous', label: '连续' }
]
const multiForecastPanelCountOptions = [4, 6, 8, 9]
const multiInitIntervalOptions = [
  { value: '12', label: '12小时' },
  { value: '24', label: '24小时' }
]
const multiInitPanelCountOptions = [4, 6, 8, 9]
const multiElementPanelCountOptions = [4, 6, 8, 9]

function formatInitTime(date) {
  return `${date.getUTCFullYear()}${padTimePart(date.getUTCMonth() + 1)}${padTimePart(date.getUTCDate())}${padTimePart(date.getUTCHours())}`
}

function shiftedInitTime(value, offsetHours) {
  const date = parseInitTime(value)
  return date ? formatInitTime(new Date(date.getTime() + offsetHours * 60 * 60 * 1000)) : value
}

function panelView(overrides = {}) {
  return {
    initTime: initTime.value,
    fcHour: fcHour.value,
    level: level.value,
    selectedLayerTypes: [...selectedLayerTypes.value],
    projectionName: projectionName.value,
    compact: true,
    showPanelTitle: true,
    valid: true,
    ...overrides
  }
}

function multiForecastDescriptors() {
  const hours = sliderFcHours.value
  const startIndex = Math.max(0, hours.indexOf(normalizeFcHour(fcHour.value)))
  const panelCount = multiForecastPanelCount.value

  if (multiForecastInterval.value === 'continuous') {
    return Array.from({ length: panelCount }, (_, index) => {
      const value = hours[startIndex + index] || null
      return { value, valid: Boolean(value) }
    })
  }

  const interval = Number(multiForecastInterval.value)
  const startHour = Number(fcHour.value)
  return Array.from({ length: panelCount }, (_, index) => {
    const value = normalizeFcHour(startHour + (interval * index))
    return { value, valid: hours.includes(value) }
  })
}

// 多起报对比保持首图的有效时间不变：每向前一个起报间隔，预报时效同步增加。
// 例如 2025071012 起报 +000h、12 小时前起报 +012h，均对应 2025071012。
function multiInitDescriptors() {
  const interval = Number(multiInitInterval.value)
  const startFcHour = Number(fcHour.value)

  return Array.from({ length: multiInitPanelCount.value }, (_, index) => ({
    initTime: shiftedInitTime(initTime.value, -interval * index),
    fcHour: normalizeFcHour(startFcHour + interval * index)
  }))
}

function setMultiInitInterval(value) {
  if (!multiInitIntervalOptions.some((option) => option.value === value)) return
  multiInitInterval.value = value
}

function setMultiInitPanelCount(value) {
  const count = Number(value)
  if (!multiInitPanelCountOptions.includes(count)) return
  multiInitPanelCount.value = count
}

function setMultiForecastInterval(value) {
  if (!multiForecastIntervalOptions.some((option) => option.value === value)) return
  multiForecastInterval.value = value
}

function setMultiForecastPanelCount(value) {
  const count = Number(value)
  if (!multiForecastPanelCountOptions.includes(count)) return
  multiForecastPanelCount.value = count
}

function setMultiElementPanelCount(value) {
  const count = Number(value)
  if (!multiElementPanelCountOptions.includes(count)) return
  multiElementPanelCount.value = count
}

function shiftMultiForecastPage(direction) {
  if (multiMapMode.value !== 'forecast') return
  const hours = sliderFcHours.value
  const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
  if (startIndex < 0) return

  if (multiForecastInterval.value === 'continuous') {
    const nextIndex = startIndex + (Number(direction) * multiForecastPanelCount.value)
    if (nextIndex >= 0 && nextIndex < hours.length) fcHour.value = hours[nextIndex]
    return
  }

  const offset = Number(multiForecastInterval.value) * multiForecastPanelCount.value
  const nextValue = normalizeFcHour(Number(fcHour.value) + (Number(direction) * offset))
  if (hours.includes(nextValue)) fcHour.value = nextValue
}

const canShiftMultiForecastBackward = computed(() => {
  const hours = sliderFcHours.value
  const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
  if (startIndex < 0) return false
  if (multiForecastInterval.value === 'continuous') {
    return startIndex - multiForecastPanelCount.value >= 0
  }
  const nextValue = normalizeFcHour(Number(fcHour.value) - (Number(multiForecastInterval.value) * multiForecastPanelCount.value))
  return hours.includes(nextValue)
})

const canShiftMultiForecastForward = computed(() => {
  const hours = sliderFcHours.value
  const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
  if (startIndex < 0) return false
  if (multiForecastInterval.value === 'continuous') {
    return startIndex + multiForecastPanelCount.value < hours.length
  }
  const nextValue = normalizeFcHour(Number(fcHour.value) + (Number(multiForecastInterval.value) * multiForecastPanelCount.value))
  return hours.includes(nextValue)
})

function normalizeMultiElementDescriptor(element, fallbackLabel = '') {
  const layers = Array.isArray(element?.layers)
    ? element.layers
    : element?.selectedLayerTypes
  return {
    label: String(element?.label || element?.title || fallbackLabel).trim() || fallbackLabel,
    level: String(element?.level || level.value),
    layers: Array.isArray(layers) ? layers.map(String).filter(Boolean) : [],
    elementKey: String(element?.elementKey || '')
  }
}

function multiElementCandidates() {
  const current = {
    label: activeLayerCombinationName.value || selectedLayerLabels.value,
    level: level.value,
    layers: [...selectedLayerTypes.value],
    elementKey: activeElementKey.value
  }
  const candidates = [current]
  const seen = new Set([`${current.level}|${current.layers.join(',')}`])

  const addElement = (element) => {
    const descriptor = normalizeMultiElementDescriptor(element)
    const key = `${descriptor.level}|${descriptor.layers.join(',')}`
    if (!descriptor.layers.length || seen.has(key)) return
    candidates.push(descriptor)
    seen.add(key)
  }

  const preferredCells = elementConfig.value.columns.map((column) => (
    elementConfig.value.cells[cellKey(level.value, column.key)] || []
  ))
  const allCells = Object.values(elementConfig.value.cells)
  const singleLayerElements = elementConfig.value.singleLayerGroups.flatMap((group) => group.elements || [])

  for (const elements of [...preferredCells, ...allCells, singleLayerElements]) {
    for (const element of elements) {
      const before = candidates.length
      addElement(element)
      if (candidates.length === before) continue
      if (candidates.length >= multiElementPanelCountOptions[multiElementPanelCountOptions.length - 1]) return candidates
    }
  }

  return candidates
}

function multiElementPanels() {
  const existing = multiMapMode.value === 'element'
    ? multiMapPanels.value.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
    : []
  const candidates = multiElementCandidates()
  const descriptors = [...existing]

  for (let index = descriptors.length; index < multiElementPanelCount.value; index += 1) {
    const fallback = candidates[index % candidates.length] || normalizeMultiElementDescriptor({}, `配置${index + 1}`)
    descriptors.push({ ...fallback, layers: [...fallback.layers] })
  }

  return descriptors.slice(0, multiElementPanelCount.value)
}

function defaultMultiElementPanels() {
  const candidates = multiElementCandidates()
  return Array.from({ length: multiElementPanelCount.value }, (_, index) => {
    const fallback = candidates[index % candidates.length] || normalizeMultiElementDescriptor({}, `配置${index + 1}`)
    return { ...fallback, layers: [...fallback.layers] }
  })
}

function multiElementPanelView(element, index) {
  const descriptor = normalizeMultiElementDescriptor(element, `配置${index + 1}`)
  return panelView({
    id: `element-${initTime.value}-${fcHour.value}-${index}-${descriptor.level}-${descriptor.layers.join('-')}-${descriptor.elementKey}`,
    title: descriptor.label || `配置${index + 1}`,
    level: descriptor.level,
    selectedLayerTypes: [...descriptor.layers],
    elementKey: descriptor.elementKey
  })
}

function updateMultiElementPanel(index, element, elementKey = '') {
  if (multiMapMode.value !== 'element' || !multiMapPanels.value[index]) return
  const panels = multiMapPanels.value.map((panel, panelIndex) => (
    panelIndex === index
      ? multiElementPanelView({ ...element, elementKey }, panelIndex)
      : panel
  ))
  multiMapPanels.value = panels
  activeMultiElementConfigurationName.value = ''
}

function setMultiElementConfigurationName(value) {
  multiElementConfigurationName.value = String(value || '')
}

function nextMultiElementConfigurationName() {
  let index = 1
  while (multiElementConfigurations.value.some((configuration) => configuration.name === `配置${index}`)) {
    index += 1
  }
  return `配置${index}`
}

function createMultiElementConfiguration() {
  multiMapPanels.value = defaultMultiElementPanels().map(multiElementPanelView)
  multiMapMode.value = 'element'
  activeMultiElementConfigurationName.value = ''
  multiElementConfigurationName.value = nextMultiElementConfigurationName()
}

function loadMultiElementConfigurations() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((configuration) => configuration?.name && Array.isArray(configuration.panels))
      .map((configuration) => ({
        name: String(configuration.name),
        panels: configuration.panels.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
      }))
      .filter((configuration) => configuration.panels.length)
  } catch {
    return []
  }
}

function persistMultiElementConfigurations() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY,
    JSON.stringify(multiElementConfigurations.value)
  )
}

function saveMultiElementConfiguration(nameOverride = '') {
  if (multiMapMode.value !== 'element' || !multiMapPanels.value.length) return
  const name = String(nameOverride || multiElementConfigurationName.value).trim() || nextMultiElementConfigurationName()
  const record = {
    name,
    panels: multiMapPanels.value.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
  }
  const existingIndex = multiElementConfigurations.value.findIndex((configuration) => configuration.name === name)
  if (existingIndex >= 0) multiElementConfigurations.value.splice(existingIndex, 1, record)
  else multiElementConfigurations.value.push(record)

  activeMultiElementConfigurationName.value = name
  multiElementConfigurationName.value = name
  persistMultiElementConfigurations()
}

function renameMultiElementConfiguration(currentName, nextName) {
  const from = String(currentName || '').trim()
  const to = String(nextName || '').trim()
  if (!from || !to || from === to) return false
  const currentIndex = multiElementConfigurations.value.findIndex((configuration) => configuration.name === from)
  if (currentIndex < 0 || multiElementConfigurations.value.some((configuration) => configuration.name === to)) return false

  const configuration = multiElementConfigurations.value[currentIndex]
  multiElementConfigurations.value.splice(currentIndex, 1, { ...configuration, name: to })
  if (activeMultiElementConfigurationName.value === from) activeMultiElementConfigurationName.value = to
  if (multiElementConfigurationName.value === from) multiElementConfigurationName.value = to
  persistMultiElementConfigurations()
  return true
}

function applyMultiElementConfiguration(configuration) {
  if (!configuration?.name || !Array.isArray(configuration.panels) || !configuration.panels.length) return
  const panels = configuration.panels.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
  if (multiElementPanelCountOptions.includes(panels.length)) {
    multiElementPanelCount.value = panels.length
  }
  multiMapPanels.value = panels.map(multiElementPanelView)
  multiMapMode.value = 'element'
  activeMultiElementConfigurationName.value = configuration.name
  multiElementConfigurationName.value = configuration.name
}

function deleteMultiElementConfiguration(name) {
  multiElementConfigurations.value = multiElementConfigurations.value.filter((configuration) => configuration.name !== name)
  if (activeMultiElementConfigurationName.value === name) activeMultiElementConfigurationName.value = ''
  persistMultiElementConfigurations()
}

function openMultiMap(mode) {
  if (!multiMapModeOptions.some((option) => option.value === mode)) return

  if (mode === 'init') {
    multiMapPanels.value = multiInitDescriptors().map((descriptor, index) => {
      const { initTime: panelInitTime, fcHour: panelFcHour } = descriptor
      return panelView({
        id: `init-${panelInitTime}-${panelFcHour}-${index}`,
        title: `${panelInitTime} 起报`,
        initTime: panelInitTime,
        fcHour: panelFcHour
      })
    })
  } else if (mode === 'forecast') {
    multiMapPanels.value = multiForecastDescriptors().map(({ value, valid }, index) => panelView({
      id: `forecast-${initTime.value}-${multiForecastInterval.value}-${index}-${value || 'invalid'}`,
      title: value ? `+${value} h` : '无可用时效',
      fcHour: value || fcHour.value,
      showPanelTitle: false,
      valid
    }))
  } else {
    multiMapPanels.value = multiElementPanels().map(multiElementPanelView)
  }

  multiMapMode.value = mode
}

function closeMultiMap() {
  multiMapMode.value = null
  multiMapPanels.value = []
}

function loadSavedLayerCombinations() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LAYER_COMBINATION_STORAGE_KEY)
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item?.name && Array.isArray(item.layers))
      .map((item) => ({
        name: String(item.name),
        layers: item.layers.map(String)
      }))
  } catch {
    return []
  }
}

function persistLayerCombinations() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    LAYER_COMBINATION_STORAGE_KEY,
    JSON.stringify(savedLayerCombinations.value)
  )
}

function layerUrl(record) {
  if (!record?.path) return null
  return `/data/products/${initTime.value}/${record.path}`
}

function hasTiles(record) {
  return Boolean(record?.tiles && typeof record.tiles === 'object')
}

function tilesForRecord(record, z) {
  if (!hasTiles(record)) return []
  const tiles = record.tiles[String(z)]
  return Array.isArray(tiles) ? tiles : []
}

function availableTileZooms(record) {
  if (!hasTiles(record)) return []
  return Object.keys(record.tiles)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
}

function resolveTileZoom(record, desiredZ) {
  const availableZooms = availableTileZooms(record)
  if (!availableZooms.length) return null

  const desired = Number.parseInt(desiredZ, 10)
  if (availableZooms.includes(desired)) return desired

  const lowerOrEqual = availableZooms.filter((value) => value <= desired)
  if (lowerOrEqual.length) return lowerOrEqual[lowerOrEqual.length - 1]
  return availableZooms[0]
}

function tileUrl(tile) {
  if (!tile?.path) return null
  return `/data/products/${initTime.value}/${tile.path}`
}

function layerHasLoadable(record) {
  return hasTiles(record) || Boolean(layerUrl(record))
}

function getTileZoom(k) {
  if (k <= 5) return 0
  if (k <= 8) return 1
  return 2
}

function manifestBounds() {
  const bounds = manifest.value?.tile_scheme?.bounds || manifest.value?.bounds || DEFAULT_MAP_BOUNDS
  return {
    lon_min: Number(bounds.lon_min ?? DEFAULT_MAP_BOUNDS.lon_min),
    lon_max: Number(bounds.lon_max ?? DEFAULT_MAP_BOUNDS.lon_max),
    lat_min: Number(bounds.lat_min ?? DEFAULT_MAP_BOUNDS.lat_min),
    lat_max: Number(bounds.lat_max ?? DEFAULT_MAP_BOUNDS.lat_max)
  }
}

function boundsPolygon(bounds) {
  return {
    type: 'Polygon',
    coordinates: [[
      [bounds.lon_min, bounds.lat_min],
      [bounds.lon_max, bounds.lat_min],
      [bounds.lon_max, bounds.lat_max],
      [bounds.lon_min, bounds.lat_max],
      [bounds.lon_min, bounds.lat_min]
    ]]
  }
}

function isTileVisible(tile, projection, size, transform) {
  const bounds = tile?.bounds
  if (!bounds) return false

  const points = [
    [bounds.lon_min, bounds.lat_min],
    [bounds.lon_max, bounds.lat_min],
    [bounds.lon_max, bounds.lat_max],
    [bounds.lon_min, bounds.lat_max],
    [(bounds.lon_min + bounds.lon_max) / 2, (bounds.lat_min + bounds.lat_max) / 2]
  ]
  const projected = points
    .map((point) => projection(point))
    .filter(Boolean)
    .map((point) => transform.apply(point))

  if (!projected.length) return false
  if (projected.some(([x, y]) => x >= 0 && x <= size.width && y >= 0 && y <= size.height)) {
    return true
  }

  const xs = projected.map(([x]) => x)
  const ys = projected.map(([, y]) => y)
  return Math.max(...xs) >= 0
    && Math.min(...xs) <= size.width
    && Math.max(...ys) >= 0
    && Math.min(...ys) <= size.height
}

function recordForLayerType(targetLayerType) {
  const products = manifest.value?.products
  return products?.[fcHour.value]?.[level.value]?.[targetLayerType] || null
}

function selectedLayerHasTiles() {
  return selectedLayerTypes.value.some((type) => hasTiles(recordForLayerType(type)))
}

function saveLayerCombination() {
  const name = layerCombinationName.value.trim() || activeLayerCombinationName.value.trim()
  const layers = sanitizeLayerSelection(selectedLayerTypes.value)
  if (!name || !layers.length) return

  const existingIndex = savedLayerCombinations.value.findIndex((item) => item.name === name)
  const record = { name, layers }
  if (existingIndex >= 0) {
    savedLayerCombinations.value.splice(existingIndex, 1, record)
  } else {
    savedLayerCombinations.value.push(record)
  }
  activeLayerCombinationName.value = name
  layerCombinationName.value = name
  persistLayerCombinations()
}

function applyLayerCombination(combination) {
  const next = setSelectedLayerTypes(combination.layers)
  layerType.value = next[0] || layerType.value
  activeLayerCombinationName.value = combination.name
  layerCombinationName.value = combination.name
}

function deleteLayerCombination(name) {
  savedLayerCombinations.value = savedLayerCombinations.value.filter((item) => item.name !== name)
  persistLayerCombinations()
}

function handleLayerTypeChange(value) {
  layerType.value = value
  setSelectedLayerTypes([value])
  activeLayerCombinationName.value = layerLabel(value)
  layerCombinationName.value = layerLabel(value)
  activeElementKey.value = ''
}

// 应用一个「要素」：切换层次并设置图层组合。id 用于在选择器中高亮当前项。
function applyElementSelection(element, id) {
  if (!element) return
  const nextLevel = String(element.level || '')
  if (nextLevel) level.value = nextLevel

  const layers = Array.isArray(element.layers) ? element.layers : []
  if (layers.length) {
    const next = setSelectedLayerTypes(layers)
    layerType.value = next[0] || layerType.value
  }
  activeLayerCombinationName.value = element.label || activeLayerCombinationName.value
  layerCombinationName.value = element.label || layerCombinationName.value
  activeElementKey.value = id || ''
}

// —— 元素选择器配置的增删改（供配置界面调用），改动后立即持久化 —— //
function commitElementConfig(nextConfig) {
  elementConfig.value = nextConfig
  persistElementConfig(nextConfig)
}

function cloneElementConfig() {
  return JSON.parse(JSON.stringify(elementConfig.value))
}

// 设置某个单元格（层次×列）的要素列表。
function setCellElements(levelValue, columnKey, elements) {
  const next = cloneElementConfig()
  const key = cellKey(levelValue, columnKey)
  const list = (elements || [])
    .map((el) => ({
      label: String(el.label || '').trim(),
      level: String(el.level || levelValue),
      layers: Array.isArray(el.layers) ? el.layers.map(String).filter(Boolean) : []
    }))
    .filter((el) => el.label)
  if (list.length) next.cells[key] = list
  else delete next.cells[key]
  commitElementConfig(next)
}

// 新增 / 删除垂直层次行。
function addElementLevel(levelDef) {
  const value = String(levelDef?.value || '').trim()
  if (!value) return
  const next = cloneElementConfig()
  if (next.levels.some((lvl) => lvl.value === value)) return
  next.levels.push({ value, label: String(levelDef.label || value) })
  commitElementConfig(next)
}

function removeElementLevel(levelValue) {
  const next = cloneElementConfig()
  next.levels = next.levels.filter((lvl) => lvl.value !== levelValue)
  Object.keys(next.cells).forEach((key) => {
    if (key.startsWith(`${levelValue}|`)) delete next.cells[key]
  })
  commitElementConfig(next)
}

// 新增 / 删除单层要素分组集合。
function addSingleLayerGroup(group) {
  const key = String(group?.key || '').trim()
  const title = String(group?.title || '').trim()
  if (!title) return
  const next = cloneElementConfig()
  const finalKey = key || `group_${next.singleLayerGroups.length + 1}`
  next.singleLayerGroups.push({
    key: finalKey,
    title,
    color: String(group.color || '#e2e8f0'),
    elements: []
  })
  commitElementConfig(next)
}

function removeSingleLayerGroup(groupKey) {
  const next = cloneElementConfig()
  next.singleLayerGroups = next.singleLayerGroups.filter((group) => group.key !== groupKey)
  commitElementConfig(next)
}

// 设置某个单层分组的要素列表。
function setSingleLayerGroupElements(groupKey, elements) {
  const next = cloneElementConfig()
  const group = next.singleLayerGroups.find((item) => item.key === groupKey)
  if (!group) return
  group.elements = (elements || [])
    .map((el) => ({
      label: String(el.label || '').trim(),
      level: String(el.level || 'surface'),
      layers: Array.isArray(el.layers) ? el.layers.map(String).filter(Boolean) : []
    }))
    .filter((el) => el.label)
  commitElementConfig(next)
}

function resetElementConfig() {
  commitElementConfig(defaultElementConfig())
}

// 拖拽排序：垂直层次 / 单层要素集合。
function reorderElementLevels(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
  const next = cloneElementConfig()
  if (fromIndex >= next.levels.length || toIndex >= next.levels.length) return
  const [moved] = next.levels.splice(fromIndex, 1)
  next.levels.splice(toIndex, 0, moved)
  commitElementConfig(next)
}

function reorderSingleLayerGroups(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
  const next = cloneElementConfig()
  if (fromIndex >= next.singleLayerGroups.length || toIndex >= next.singleLayerGroups.length) return
  const [moved] = next.singleLayerGroups.splice(fromIndex, 1)
  next.singleLayerGroups.splice(toIndex, 0, moved)
  commitElementConfig(next)
}

function buildProjection() {
  const margin = { left: 46, top: 18, right: 22, bottom: 34 }
  const extent = boundsPolygon(manifestBounds())

  let projection
  if (projectionName.value === 'mercator') {
    projection = d3.geoMercator()
  } else if (projectionName.value === 'lambert') {
    projection = d3.geoConicConformal()
      .parallels([25, 47])
      .rotate([-DEFAULT_MAP_CENTER[0], 0, 0])
      .center([0, DEFAULT_MAP_CENTER[1]])
  } else {
    projection = d3.geoEquirectangular()
  }

  return projection.fitExtent(
    [[margin.left, margin.top], [canvasSize.width - margin.right, canvasSize.height - margin.bottom]],
    extent
  )
}

function defaultMapTransform() {
  const projection = buildProjection()
  const projectedCenter = projection(DEFAULT_MAP_CENTER)
  if (!projectedCenter) return d3.zoomIdentity

  return d3.zoomIdentity
    .translate(
      (canvasSize.width / 2) - (projectedCenter[0] * DEFAULT_MAP_SCALE),
      (canvasSize.height / 2) - (projectedCenter[1] * DEFAULT_MAP_SCALE)
    )
    .scale(DEFAULT_MAP_SCALE)
}

function applyDefaultView(animate = false) {
  const nextTransform = defaultMapTransform()
  zoomTransform.value = nextTransform

  if (canvasRef.value && zoomBehavior) {
    const selection = d3.select(canvasRef.value)
    const target = animate ? selection.transition().duration(160) : selection
    target.call(zoomBehavior.transform, nextTransform)
  }
}

function transformFromSync(snapshot) {
  const k = Number(snapshot?.k)
  const center = Array.isArray(snapshot?.center) ? snapshot.center.map(Number) : []
  if (!Number.isFinite(k)) return null

  if (center.length === 2 && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
    const projectedCenter = buildProjection()(center)
    if (!projectedCenter) return null
    return d3.zoomIdentity
      .translate((canvasSize.width / 2) - (projectedCenter[0] * k), (canvasSize.height / 2) - (projectedCenter[1] * k))
      .scale(k)
  }

  const x = Number(snapshot?.x)
  const y = Number(snapshot?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return d3.zoomIdentity.translate(x, y).scale(k)
}

function applySynchronizedZoom(snapshot) {
  if (!zoomBehavior || !canvasRef.value) return
  const nextTransform = transformFromSync(snapshot)
  if (!nextTransform) return

  const current = zoomTransform.value
  if (current.x === nextTransform.x && current.y === nextTransform.y && current.k === nextTransform.k) return

  applyingSynchronizedZoom = true
  try {
    d3.select(canvasRef.value).call(zoomBehavior.transform, nextTransform)
  } finally {
    applyingSynchronizedZoom = false
  }
}

function broadcastCursor(geo) {
  if (!syncState || !syncId) return
  syncState.cursor = geo
    ? { lon: geo.lon, lat: geo.lat, source: syncId }
    : null
}

function transformedPoint(projection, lonLat) {
  const projected = projection(lonLat)
  if (!projected) return null
  return zoomTransform.value.apply(projected)
}

function screenToGeo(event) {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const projection = buildProjection()
  const untransformed = zoomTransform.value.invert([x, y])
  const geo = projection.invert(untransformed)
  if (!geo || !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) return null
  return { lon: geo[0], lat: geo[1], x, y }
}

function requestDraw() {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    drawMap()
  })
}

function drawMap() {
  const canvas = canvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(canvasSize.width * ratio)
  canvas.height = Math.floor(canvasSize.height * ratio)
  canvas.style.width = `${canvasSize.width}px`
  canvas.style.height = `${canvasSize.height}px`
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, canvasSize.width, canvasSize.height)

  const projection = buildProjection()
  const path = d3.geoPath(projection, context)

  context.fillStyle = '#f6f8fb'
  context.fillRect(0, 0, canvasSize.width, canvasSize.height)

  context.save()
  context.translate(zoomTransform.value.x, zoomTransform.value.y)
  context.scale(zoomTransform.value.k, zoomTransform.value.k)

  drawWeatherLayers(context, projection, true)
  drawBaseMap(context, path)
  drawGraticule(context, projection)
  drawWeatherLayers(context, projection, false)
  drawTroughLines(context, projection)
  drawJetAxes(context, projection)
  drawVortexTracks(context, projection)
  drawVortexCenters(context, projection)
  drawDrawings(context, projection)
  drawTileDebug(context, projection)

  context.restore()
  drawHudFrame(context)
  drawSynchronizedCursor(context, projection)
}

function drawSynchronizedCursor(context, projection) {
  const cursor = syncState?.cursor
  if (!cursor || cursor.source === syncId) return
  const point = transformedPoint(projection, [cursor.lon, cursor.lat])
  if (!point) return
  const [x, y] = point
  if (x < 0 || x > canvasSize.width || y < 0 || y > canvasSize.height) return

  context.save()
  context.strokeStyle = '#1f7a8c'
  context.lineWidth = 1.6
  context.beginPath()
  context.moveTo(x - 8, y)
  context.lineTo(x + 8, y)
  context.moveTo(x, y - 8)
  context.lineTo(x, y + 8)
  context.stroke()
  context.restore()
}

function trackColor(track) {
  return track.warm ? '#f97316' : '#0ea5e9'
}

function drawBaseMap(context, path) {
  if (worldFeatures.value) {
    context.beginPath()
    path(worldFeatures.value)
    context.strokeStyle = 'rgba(48, 60, 76, 0.78)'
    context.lineWidth = 1.2 / zoomTransform.value.k
    context.stroke()
  }

  if (chinaFeatures.value) {
    context.beginPath()
    path(chinaFeatures.value)
    context.strokeStyle = 'rgba(31, 41, 55, 0.9)'
    context.lineWidth = 2 / zoomTransform.value.k
    context.stroke()
  }
}

function drawGraticule(context, projection) {
  const interval = zoomTransform.value.k >= 4 ? 5 : zoomTransform.value.k >= 2 ? 10 : 15
  const path = d3.geoPath(projection, context)
  const bounds = manifestBounds()
  const graticule = d3.geoGraticule()
    .extent([[bounds.lon_min, bounds.lat_min], [bounds.lon_max, bounds.lat_max]])
    .step([interval, interval])

  context.beginPath()
  path(graticule())
  context.strokeStyle = 'rgba(76, 89, 105, 0.34)'
  context.lineWidth = 0.55 / zoomTransform.value.k
  context.setLineDash([3 / zoomTransform.value.k, 3 / zoomTransform.value.k])
  context.stroke()
  context.setLineDash([])
}

function drawWeatherLayers(context, projection, fillLayers) {
  if (!showSvgLayer.value || !activeSvgLayers.value.length) return

  const layers = activeSvgLayers.value
    .filter((layer) => layer.isFill === fillLayers)
    .sort((left, right) => {
      if (fillLayers) return left.order - right.order
      return layerDrawPriority(left.type) - layerDrawPriority(right.type) || left.order - right.order
    })

  for (const layer of layers) {
    drawSvgLayer(context, projection, layer)
  }
}

function drawSvgLayer(context, projection, layer) {
  if (!layer?.record) return

  if (Array.isArray(layer.tiles)) {
    for (const tile of layer.tiles) {
      drawSvgImage(context, projection, tile.image, tile.bounds, layer)
    }
    return
  }

  drawSvgImage(context, projection, layer.image, layer.record.bounds, layer)
}

function isContourLayer(layer) {
  return String(layer?.type || '').includes('contour')
}

// 计算等值线膨胀半径（当前缩放坐标系下的本地单位）。
// 屏幕像素补偿量随 k 从参考值线性增长，再除以 k 换算回被 context.scale(k) 缩放前的坐标。
function contourDilationRadius(layer, k) {
  if (!isContourLayer(layer) || !(k > 0) || k >= CONTOUR_REFERENCE_ZOOM) return 0
  const screenPx = ((CONTOUR_REFERENCE_ZOOM - k) / CONTOUR_REFERENCE_ZOOM) * CONTOUR_MAX_DILATION_PX
  return screenPx / k
}

function drawSvgImage(context, projection, image, bounds, layer) {
  if (!image || !bounds) return
  const topLeft = projection([bounds.lon_min, bounds.lat_max])
  const bottomRight = projection([bounds.lon_max, bounds.lat_min])
  if (!topLeft || !bottomRight) return

  const dx = topLeft[0]
  const dy = topLeft[1]
  const dw = bottomRight[0] - topLeft[0]
  const dh = bottomRight[1] - topLeft[1]

  context.globalAlpha = layer.isFill && fillLayerCount.value > 1 ? 0.5 : 1
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  // 放大系数较小时，先以多方向偏移重绘等值线以加粗线条，使视觉线宽在各放大系数下保持一致。
  const dilation = contourDilationRadius(layer, zoomTransform.value.k)
  if (dilation > 0) {
    for (const [ox, oy] of CONTOUR_DILATION_OFFSETS) {
      context.drawImage(image, dx + ox * dilation, dy + oy * dilation, dw, dh)
    }
  }

  context.drawImage(image, dx, dy, dw, dh)
  context.globalAlpha = 1
}

function drawTroughLines(context, projection) {
  if (!visibleTroughLines.value.length) return

  for (const line of visibleTroughLines.value) {
    const points = line.smoothed_points?.length ? line.smoothed_points : line.points
    if (!points?.length) continue

    context.beginPath()
    points.forEach((point, index) => {
      const xy = projection([point.lon, point.lat])
      if (!xy) return
      if (index === 0) context.moveTo(xy[0], xy[1])
      else context.lineTo(xy[0], xy[1])
    })
    context.strokeStyle = SHEAR_COLORS[line.shear_type] || '#111827'
    context.lineWidth = Math.max(troughLineWidth.value / zoomTransform.value.k, 0.65)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()

    if (showRawPoints.value && line.points?.length) {
      context.fillStyle = SHEAR_COLORS[line.shear_type] || '#111827'
      for (const point of line.points) {
        const xy = projection([point.lon, point.lat])
        if (!xy) continue
        context.beginPath()
        context.arc(xy[0], xy[1], 1.8 / zoomTransform.value.k, 0, Math.PI * 2)
        context.fill()
      }
    }
  }
}

function drawJetAxes(context, projection) {
  if (!visibleJetAxisLines.value.length) return

  for (const line of visibleJetAxisLines.value) {
    const points = line.smoothed_points?.length ? line.smoothed_points : line.points
    if (!points?.length) continue

    const projectedPoints = points
      .map((point) => projection([point.lon, point.lat]))
      .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))

    if (projectedPoints.length < 2) continue

    context.save()
    context.beginPath()
    projectedPoints.forEach((point, index) => {
      if (index === 0) context.moveTo(point[0], point[1])
      else context.lineTo(point[0], point[1])
    })
    context.strokeStyle = '#e11d48'
    context.lineWidth = jetLineWidth.value / zoomTransform.value.k
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()

    if (showJetArrowHeads.value) drawLineArrowHead(context, projectedPoints, '#e11d48')
    context.restore()
  }
}

function drawLineArrowHead(context, projectedPoints, color, lengthPx = 24, halfWidthPx = 5) {
  const arrow = lineArrowGeometry(projectedPoints)
  if (!arrow) return

  const { point: baseCenter, angle } = arrow
  const length = lengthPx / zoomTransform.value.k
  const halfWidth = halfWidthPx / zoomTransform.value.k
  const tip = [
    baseCenter[0] + length * Math.cos(angle),
    baseCenter[1] + length * Math.sin(angle)
  ]
  const normal = angle + Math.PI / 2

  context.fillStyle = color
  context.beginPath()
  context.moveTo(tip[0], tip[1])
  context.lineTo(
    baseCenter[0] + halfWidth * Math.cos(normal),
    baseCenter[1] + halfWidth * Math.sin(normal)
  )
  context.lineTo(
    baseCenter[0] - halfWidth * Math.cos(normal),
    baseCenter[1] - halfWidth * Math.sin(normal)
  )
  context.closePath()
  context.fill()
}

function lineArrowGeometry(projectedPoints) {
  if (projectedPoints.length < 2) return null

  const lengths = []
  let totalLength = 0
  for (let index = 1; index < projectedPoints.length; index += 1) {
    const previous = projectedPoints[index - 1]
    const current = projectedPoints[index]
    const length = Math.hypot(current[0] - previous[0], current[1] - previous[1])
    lengths.push(length)
    totalLength += length
  }
  if (totalLength <= 0) return null

  const targetLength = totalLength * 0.75
  let traveled = 0
  let arrowPoint = projectedPoints[projectedPoints.length - 2]
  let segmentStart = projectedPoints[projectedPoints.length - 2]
  let segmentEnd = projectedPoints[projectedPoints.length - 1]

  for (let index = 1; index < projectedPoints.length; index += 1) {
    const length = lengths[index - 1]
    if (traveled + length >= targetLength) {
      segmentStart = projectedPoints[index - 1]
      segmentEnd = projectedPoints[index]
      const ratio = length > 0 ? (targetLength - traveled) / length : 0
      arrowPoint = [
        segmentStart[0] + (segmentEnd[0] - segmentStart[0]) * ratio,
        segmentStart[1] + (segmentEnd[1] - segmentStart[1]) * ratio
      ]
      break
    }
    traveled += length
  }

  const end = projectedPoints[projectedPoints.length - 1]
  const angle = Math.atan2(end[1] - arrowPoint[1], end[0] - arrowPoint[0])
  if (!Number.isFinite(angle)) {
    return {
      point: arrowPoint,
      angle: Math.atan2(segmentEnd[1] - segmentStart[1], segmentEnd[0] - segmentStart[0])
    }
  }

  return { point: arrowPoint, angle }
}

function drawVortexTracks(context, projection) {
  if (!visibleVortexTracks.value.length) return

  visibleVortexTracks.value.forEach((track) => {
    const color = trackColor(track)
    const lineWidth = track.warm ? 2.1 / zoomTransform.value.k : 1.5 / zoomTransform.value.k

    for (const segment of visibleVortexTrackSegments(track)) {
      drawTrackSegment(context, projection, segment.points, color, lineWidth, segment.dashed)
    }
  })
}

function visibleVortexTrackSegments(track) {
  const points = (track.track || []).filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
  if (points.length < 2) return []

  const currentStep = Number(fcHour.value)
  const onlyFuture = showOnlyFutureVortexTracks.value
  const showFuture = onlyFuture || showFutureVortexTracks.value
  const pastPoints = onlyFuture
    ? []
    : points.filter((point) => Number(point.step ?? point.fc_hour) <= currentStep)
  const futurePoints = showFuture
    ? points.filter((point) => Number(point.step ?? point.fc_hour) >= currentStep)
    : []

  return [
    { points: pastPoints, dashed: false },
    { points: futurePoints, dashed: true }
  ]
}

function drawTrackSegment(context, projection, points, color, lineWidth, dashed) {
  if (points.length < 2) return

  const projectedPoints = points
    .map((point) => projection([point.lon, point.lat]))
    .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))

  if (projectedPoints.length < 2) return

  context.save()
  context.beginPath()
  projectedPoints.forEach((point, pointIndex) => {
    if (pointIndex === 0) context.moveTo(point[0], point[1])
    else context.lineTo(point[0], point[1])
  })
  context.strokeStyle = color
  context.lineWidth = lineWidth
  context.setLineDash(dashed ? [5 / zoomTransform.value.k, 4 / zoomTransform.value.k] : [])
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.stroke()
  drawLineArrowHead(context, projectedPoints, color, 16, 4)
  context.restore()
}

function drawVortexCenters(context, projection) {
  if (!visibleVortexCenters.value.length) return

  for (const center of visibleVortexCenters.value) {
    if (!Number.isFinite(center.lon) || !Number.isFinite(center.lat)) continue
    const xy = projection([center.lon, center.lat])
    if (!xy) continue

    context.save()
    context.translate(xy[0], xy[1])
    context.fillStyle = '#dc2626'
    context.font = `800 ${24 / zoomTransform.value.k}px Arial`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('L', 0, 0.5 / zoomTransform.value.k)
    context.restore()
  }
}

function drawTileDebug(context, projection) {
  if (!showTileDebug.value) return

  const k = zoomTransform.value.k
  const debugLayers = activeSvgLayers.value.filter((layer) => Array.isArray(layer.tiles) && layer.tiles.length)
  if (!debugLayers.length) return

  context.save()
  for (const layer of debugLayers) {
    for (const tile of layer.tiles) {
      const bounds = tile.bounds
      if (!bounds) continue
      const topLeft = projection([bounds.lon_min, bounds.lat_max])
      const bottomRight = projection([bounds.lon_max, bounds.lat_min])
      if (!topLeft || !bottomRight) continue

      const width = bottomRight[0] - topLeft[0]
      const height = bottomRight[1] - topLeft[1]

      context.strokeStyle = 'rgba(220, 38, 38, 0.9)'
      context.lineWidth = 1.4 / k
      context.setLineDash([6 / k, 4 / k])
      context.strokeRect(topLeft[0], topLeft[1], width, height)
      context.setLineDash([])

      const centerX = topLeft[0] + width / 2
      const centerY = topLeft[1] + height / 2
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = 'rgba(220, 38, 38, 0.95)'
      context.font = `700 ${14 / k}px Menlo, Consolas, monospace`
      context.fillText(`${layer.type} z${tile.z}`, centerX, centerY - 8 / k)
      context.font = `500 ${12 / k}px Menlo, Consolas, monospace`
      context.fillText(`x${tile.x} y${tile.y} k=${k.toFixed(2)}`, centerX, centerY + 9 / k)
    }
  }
  context.restore()
}

function drawHudFrame(context) {
  context.strokeStyle = '#bcc7d3'
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, canvasSize.width - 1, canvasSize.height - 1)

  if (showTileDebug.value) {
    const z = getTileZoom(zoomTransform.value.k)
    const actualZoomItems = activeSvgLayers.value
      .filter((layer) => Number.isFinite(layer.z))
      .map((layer) => `${layer.type}:z${layer.z}`)
    const actualZooms = actualZoomItems.length > 4
      ? `${actualZoomItems.slice(0, 4).join('  ')}  +${actualZoomItems.length - 4}`
      : actualZoomItems.join('  ')
    const text = `瓦片调试  k=${zoomTransform.value.k.toFixed(2)}  期望z=${z}${actualZooms ? `  ${actualZooms}` : ''}`
    context.font = '600 12px Menlo, Consolas, monospace'
    context.textAlign = 'left'
    context.textBaseline = 'top'
    const paddingX = 8
    const paddingY = 5
    const metrics = context.measureText(text)
    const boxWidth = metrics.width + paddingX * 2
    const boxHeight = 22
    context.fillStyle = 'rgba(15, 23, 42, 0.82)'
    context.fillRect(8, 8, boxWidth, boxHeight)
    context.fillStyle = '#f8fafc'
    context.fillText(text, 8 + paddingX, 8 + paddingY)
  }
}

function findNearestLine(mouse) {
  if (!showTooltip.value || !visibleTroughLines.value.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const line of visibleTroughLines.value) {
    const points = line.smoothed_points?.length ? line.smoothed_points : line.points
    for (const point of points || []) {
      const screen = transformedPoint(projection, [point.lon, point.lat])
      if (!screen) continue
      const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = line
      }
    }
  }

  return nearestDistance <= 12 ? nearest : null
}

function findNearestJetLine(mouse) {
  if (!showTooltip.value || !visibleJetAxisLines.value.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const line of visibleJetAxisLines.value) {
    const points = line.smoothed_points?.length ? line.smoothed_points : line.points
    for (const point of points || []) {
      const screen = transformedPoint(projection, [point.lon, point.lat])
      if (!screen) continue
      const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = line
      }
    }
  }

  return nearestDistance <= 12 ? nearest : null
}

function findNearestVortexCenter(mouse) {
  if (!showTooltip.value || !visibleVortexCenters.value.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const center of visibleVortexCenters.value) {
    const screen = transformedPoint(projection, [center.lon, center.lat])
    if (!screen) continue
    const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = center
    }
  }

  return nearestDistance <= 14 ? nearest : null
}

function findNearestVortexTrack(mouse) {
  if (!showTooltip.value || !visibleVortexTracks.value.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  visibleVortexTracks.value.forEach((track) => {
    for (const segment of visibleVortexTrackSegments(track)) {
      for (const point of segment.points) {
        const screen = transformedPoint(projection, [point.lon, point.lat])
        if (!screen) continue
        const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = { track, point }
        }
      }
    }
  })

  return nearestDistance <= 11 ? nearest : null
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

function loadWorld() {
  try {
    loadingState.map = '加载中'
    worldFeatures.value = feature(worldTopo, worldTopo.objects.land)
    chinaFeatures.value = feature(chinaTopo, chinaTopo.objects.bou2_4l)
    loadingState.map = '完成'
  } catch (error) {
    loadingState.map = `失败: ${error.message}`
  } finally {
    requestDraw()
  }
}

async function loadManifest() {
  errorMessage.value = ''
  manifest.value = null
  activeSvgLayers.value = []
  loadingState.manifest = '加载中'

  try {
    manifest.value = await fetchJson(`/data/products/${initTime.value}/manifest.json`)
    loadingState.manifest = '完成'
    const manifestLevels = (manifest.value.levels || []).map(String)
    if (manifestFcHourSet.value && !manifestFcHourSet.value.has(fcHour.value)) {
      fcHour.value = firstAvailableFcHour.value
    }
    if (!manifestLevels.includes(String(level.value))) {
      const firstLevel = manifest.value.levels?.find((item) => item !== 'surface') || manifest.value.levels?.[0]
      if (firstLevel) level.value = String(firstLevel)
    }
    if (!layerOptions.value.some((item) => item.value === layerType.value)) {
      layerType.value = layerOptions.value[0]?.value || layerType.value
    }
    setSelectedLayerTypes(selectedLayerTypes.value)
  } catch (error) {
    loadingState.manifest = '未找到'
    errorMessage.value = `未找到 /data/products/${initTime.value}/manifest.json；仍可查看槽线 JSON。`
  } finally {
    await loadActiveLayer()
    await loadTrough()
    await loadJetAxes()
    await loadVortexCenters()
    await loadVortexTracks()
    requestDraw()
  }
}

async function loadActiveLayer() {
  const loadId = ++activeLayerLoadId
  visibleTileLoadId += 1
  activeSvgLayers.value = []
  setSelectedLayerTypes(selectedLayerTypes.value)
  const projection = buildProjection()
  const tileZoom = getTileZoom(zoomTransform.value.k)
  loadedTileZoom = tileZoom
  const renderScale = renderScaleForZoom(zoomTransform.value.k)
  loadedRenderScale = renderScale
  const candidates = selectedLayerTypes.value.map((type) => ({
    type,
    record: recordForLayerType(type)
  }))
  const loadable = candidates.filter((item) => layerHasLoadable(item.record))

  if (!loadable.length) {
    loadingState.svg = '无匹配图层'
    requestDraw()
    return
  }

  try {
    loadingState.svg = '加载中'
    const loadedLayers = await Promise.all(loadable.map((item, order) => (
      hasTiles(item.record)
        ? loadSvgTileLayer(item, order, tileZoom, projection, renderScale)
        : loadSvgLayer(item, order, renderScale)
    )))
    if (loadId !== activeLayerLoadId) return
    activeSvgLayers.value = loadedLayers.filter(Boolean)
    const missingCount = candidates.length - activeSvgLayers.value.length
    loadingState.svg = missingCount
      ? `${activeSvgLayers.value.length}层完成 / ${missingCount}层缺失`
      : `${activeSvgLayers.value.length}层完成`
    schedulePreload()
  } finally {
    requestDraw()
  }
}

async function loadSvgTileLayer({ type, record }, order, desiredZ, projection, renderScale = 1) {
  const z = resolveTileZoom(record, desiredZ)
  if (z == null) return null

  const visibleTiles = tilesForRecord(record, z)
    .filter((tile) => isUsableLayerStatus(tile.status ?? record.status))
    .filter((tile) => tileUrl(tile))
    .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))

  if (!visibleTiles.length) return null

  const loadedTiles = (await Promise.all(visibleTiles.map((tile) => loadSvgTile(tile, renderScale)))).filter(Boolean)
  if (!loadedTiles.length) return null

  return {
    type,
    record,
    z,
    desiredZ,
    tiles: loadedTiles,
    isFill: isFillLayerRecord(type, record),
    order
  }
}

async function loadVisibleTileDelta() {
  const loadId = ++visibleTileLoadId
  const projection = buildProjection()
  const desiredZ = loadedTileZoom ?? getTileZoom(zoomTransform.value.k)
  const renderScale = loadedRenderScale
  const additions = await Promise.all(activeSvgLayers.value.map(async (layer) => {
    if (!Array.isArray(layer.tiles) || !hasTiles(layer.record)) return null

    const z = resolveTileZoom(layer.record, desiredZ)
    if (z == null || z !== layer.z) return null

    const loadedPaths = new Set(layer.tiles.map((tile) => tile.path))
    const missingVisibleTiles = tilesForRecord(layer.record, z)
      .filter((tile) => isUsableLayerStatus(tile.status ?? layer.record.status))
      .filter((tile) => tileUrl(tile) && !loadedPaths.has(tile.path))
      .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))

    if (!missingVisibleTiles.length) return null
    const loadedTiles = (await Promise.all(missingVisibleTiles.map((tile) => loadSvgTile(tile, renderScale)))).filter(Boolean)
    return loadedTiles.length ? { layer, loadedTiles } : null
  }))

  if (loadId !== visibleTileLoadId) return

  let changed = false
  for (const item of additions.filter(Boolean)) {
    item.layer.tiles = [...item.layer.tiles, ...item.loadedTiles]
    changed = true
  }
  if (changed) requestDraw()
}

async function loadSvgTile(tile, renderScale = 1) {
  const url = tileUrl(tile)
  const image = await loadSvgImage(url, renderScale)
  if (!image) return null
  return {
    image,
    bounds: tile.bounds,
    path: tile.path,
    z: tile.z,
    x: tile.x,
    y: tile.y
  }
}

async function loadSvgLayer({ type, record }, order, renderScale = 1) {
  const url = layerUrl(record)
  const image = await loadSvgImage(url, renderScale)
  if (!image) return null
  return {
    type,
    record,
    image,
    isFill: isFillLayerRecord(type, record),
    order
  }
}

function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

// 放大 SVG 根节点的 width/height（保留 viewBox），使浏览器以更高分辨率栅格化矢量图，
// 从而在高放大系数下获得更清晰的等值线与填色边缘。
function scaleSvgMarkup(text, scale) {
  return text.replace(/<svg\b[^>]*>/i, (tag) => (
    tag.replace(/\b(width|height)\s*=\s*"(\d*\.?\d+)([a-z%]*)"/gi, (match, attr, value, unit) => (
      `${attr}="${Number.parseFloat(value) * scale}${unit}"`
    ))
  ))
}

async function loadSvgImage(url, renderScale = 1) {
  if (!url) return null
  const scale = renderScale > 1 ? renderScale : 1
  const cacheKey = scale > 1 ? `${url}@${scale}x` : url
  try {
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    let image
    if (scale > 1) {
      // 以更高的超采样倍率重新栅格化：拉取 SVG 源文本、放大根节点尺寸后再解码。
      const response = await fetch(url)
      if (!response.ok) return null
      const markup = scaleSvgMarkup(await response.text(), scale)
      const blobUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
      try {
        image = await decodeImage(blobUrl)
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    } else {
      image = await decodeImage(url)
    }

    if (!image) return null
    await cache.set(cacheKey, image)
    return image
  } catch {
    return null
  }
}

// 预加载相邻预报时效的瓦片：切换预报时效是最常见的操作，提前把邻近时效的瓦片写入
// IndexedDB 可显著加快切换速度。按优先级顺序预加载：
//   n+1, n-1, n+2, n-2, n+3, n-3, n+4, n-4, n+5, n-5, n+6, n-6, n+7，共 13 个时效。
const PRELOAD_FC_HOUR_OFFSETS = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7]

function neighborPreloadFcHours() {
  const hours = sliderFcHours.value
  const index = fcHourIndex.value
  const result = []
  for (const offset of PRELOAD_FC_HOUR_OFFSETS) {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= hours.length) continue
    const targetFcHour = hours[targetIndex]
    if (targetFcHour && targetFcHour !== fcHour.value && !result.includes(targetFcHour)) {
      result.push(targetFcHour)
    }
  }
  return result
}

// 依据当前视窗（要素/层次/z 等级/边界）计算指定预报时效需要加载的瓦片 URL 列表。
function collectPreloadUrls(targetFcHour) {
  if (!manifest.value) return []
  const projection = buildProjection()
  const desiredZ = loadedTileZoom ?? getTileZoom(zoomTransform.value.k)
  const urls = []

  for (const type of selectedLayerTypes.value) {
    const record = manifest.value?.products?.[targetFcHour]?.[level.value]?.[type]
    if (!layerHasLoadable(record)) continue

    if (hasTiles(record)) {
      const z = resolveTileZoom(record, desiredZ)
      if (z == null) continue
      const tiles = tilesForRecord(record, z)
        .filter((tile) => isUsableLayerStatus(tile.status ?? record.status))
        .filter((tile) => tileUrl(tile))
        .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))
      for (const tile of tiles) urls.push(tileUrl(tile))
    } else {
      const url = layerUrl(record)
      if (url) urls.push(url)
    }
  }

  return urls
}

// 逐个预报时效、逐张瓦片地预加载；预加载前先判断 IndexedDB 是否已存在，存在则跳过。
async function preloadNeighborForecasts() {
  if (!manifest.value) return
  const runId = ++preloadRunId
  const targets = neighborPreloadFcHours()
  if (!targets.length) return

  preloading.value = true
  try {
    for (const targetFcHour of targets) {
      if (runId !== preloadRunId) return
      const urls = collectPreloadUrls(targetFcHour)
      for (const url of urls) {
        if (runId !== preloadRunId) return
        // eslint-disable-next-line no-await-in-loop
        if (await cache.has(url)) continue
        // eslint-disable-next-line no-await-in-loop
        await loadSvgImage(url)
      }
    }
  } finally {
    // 仅当自己仍是最新的预加载任务时才关闭标识，避免被后启动的任务提前清除。
    if (runId === preloadRunId) preloading.value = false
  }
}

// 在当前时效瓦片加载完毕后调度预加载；用延时+运行号确保不阻塞渲染且旧任务可被取消。
function schedulePreload() {
  if (preloadTimer) {
    clearTimeout(preloadTimer)
    preloadTimer = null
  }
  preloadRunId += 1
  preloadTimer = setTimeout(() => {
    preloadTimer = null
    preloadNeighborForecasts()
  }, 400)
}

async function loadTrough() {
  troughData.value = null
  hoverLine.value = null
  if (level.value === 'surface') {
    loadingState.trough = '地面层无槽线'
    requestDraw()
    return
  }

  const url = `/data/${initTime.value}/trough_data/trough_${initTime.value}_${fcHour.value}_${level.value}hPa_ecmwf.json`
  try {
    loadingState.trough = '加载中'
    troughData.value = await fetchJson(url)
    loadingState.trough = '完成'
  } catch {
    loadingState.trough = '缺失'
  } finally {
    requestDraw()
  }
}

async function loadJetAxes() {
  jetData.value = null
  hoverJetLine.value = null
  if (level.value === 'surface') {
    loadingState.jet = '地面层无急流轴'
    requestDraw()
    return
  }

  const url = `/data/${initTime.value}/jet_data/jet_${initTime.value}_${fcHour.value}_${level.value}hPa_ecmwf.json`
  try {
    loadingState.jet = '加载中'
    jetData.value = await fetchJson(url)
    loadingState.jet = '完成'
  } catch {
    loadingState.jet = '缺失'
  } finally {
    requestDraw()
  }
}

async function loadVortexCenters() {
  vortexCenters.value = []
  hoverVortexCenter.value = null
  if (level.value === 'surface') {
    loadingState.vortexCenters = '地面层无中心'
    requestDraw()
    return
  }

  const centerUrl = `/data/${initTime.value}/vortex_centers/vortex_center_${initTime.value}_${fcHour.value}_${level.value}hPa.json`
  const warmUrl = `/data/${initTime.value}/vortex_warm_core/vortex_warm_core_${initTime.value}_${fcHour.value}_850hPa.json`
  try {
    loadingState.vortexCenters = '加载中'
    const centers = await fetchJson(centerUrl)

    if (String(level.value) === '850') {
      try {
        const warmCenters = await fetchJson(warmUrl)
        const warmByPosition = new Map(
          warmCenters.map((center) => [`${Number(center.lat).toFixed(4)}:${Number(center.lon).toFixed(4)}`, center])
        )
        vortexCenters.value = centers.map((center) => ({
          ...center,
          ...(warmByPosition.get(`${Number(center.lat).toFixed(4)}:${Number(center.lon).toFixed(4)}`) || {})
        }))
      } catch {
        vortexCenters.value = centers
      }
    } else {
      vortexCenters.value = centers
    }

    loadingState.vortexCenters = '完成'
  } catch {
    loadingState.vortexCenters = '缺失'
  } finally {
    requestDraw()
  }
}

async function loadVortexTracks() {
  vortexTracks.value = null
  hoverVortexTrack.value = null
  const url = `/data/${initTime.value}/vortex_tracks/tc_tracking_results_processed_${initTime.value}.json`
  try {
    loadingState.vortexTracks = '加载中'
    vortexTracks.value = await fetchJson(url)
    loadingState.vortexTracks = '完成'
  } catch {
    loadingState.vortexTracks = '缺失'
  } finally {
    requestDraw()
  }
}

function resetView() {
  applyDefaultView(true)
  requestDraw()
}

function handleMouseMove(event) {
  if (drawMode.value) {
    draftCursor.value = screenToGeo(event)
    hoverDeleteIndex.value = getDrawTool(activeDrawTool.value)?.kind === 'erase'
      ? findShapeIndexNear(event)
      : -1
    requestDraw()
    return
  }
  mouseGeo.value = screenToGeo(event)
  broadcastCursor(mouseGeo.value)
  hoverVortexCenter.value = findNearestVortexCenter(mouseGeo.value)
  hoverVortexTrack.value = hoverVortexCenter.value ? null : findNearestVortexTrack(mouseGeo.value)
  hoverJetLine.value = hoverVortexCenter.value || hoverVortexTrack.value ? null : findNearestJetLine(mouseGeo.value)
  hoverLine.value = hoverVortexCenter.value || hoverVortexTrack.value || hoverJetLine.value ? null : findNearestLine(mouseGeo.value)
}

function handleMouseLeave() {
  if (drawMode.value) {
    draftCursor.value = null
    hoverDeleteIndex.value = -1
    requestDraw()
    return
  }
  broadcastCursor(null)
  clearHoverState()
}

function clearHoverState() {
  mouseGeo.value = null
  hoverLine.value = null
  hoverJetLine.value = null
  hoverVortexCenter.value = null
  hoverVortexTrack.value = null
}

function resizeCanvas() {
  const element = shellRef.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const nextWidth = Math.max(minCanvasWidth, Math.floor(rect.width))
  const nextHeight = Math.max(minCanvasHeight, Math.floor(rect.height))
  const sizeChanged = canvasSize.width !== nextWidth || canvasSize.height !== nextHeight
  canvasSize.width = nextWidth
  canvasSize.height = nextHeight
  if (sizeChanged && transformFromSync(syncState?.zoom)) applySynchronizedZoom(syncState.zoom)
  requestDraw()
}

// —— 绘图：状态操作 ——
function getDrawTool(key) {
  return DRAW_TOOLS.find((tool) => tool.key === key) || null
}

function setDrawTool(key) {
  if (activeDrawTool.value === key) {
    exitDrawMode()
    return
  }
  finishCurrentLine()
  activeDrawTool.value = key
  drawMode.value = true
  draftPoints.value = []
  draftCursor.value = null
  hoverDeleteIndex.value = -1
}

function exitDrawMode() {
  finishCurrentLine()
  drawMode.value = false
  activeDrawTool.value = null
  draftPoints.value = []
  draftCursor.value = null
  hoverDeleteIndex.value = -1
  boxStartGeo = null
  boxDragging = false
  requestDraw()
}

function commitShape(tool, points) {
  drawings.value.push({
    id: `${tool.key}-${drawSeq++}`,
    tool: tool.key,
    kind: tool.kind,
    render: tool.render,
    text: tool.text,
    color: tool.color,
    points
  })
  requestDraw()
}

// 两个经纬度点是否近似重合（用于剔除双击结束时产生的重复折点）。
function geoAlmostEqual(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

// 提交当前正在绘制的线（点数≥2 时）。
function finishCurrentLine() {
  const tool = getDrawTool(activeDrawTool.value)
  if (tool && tool.kind === 'line') {
    const pts = draftPoints.value.map((point) => point.slice())
    // 去除尾部因双击/回车产生的重复折点。
    while (pts.length >= 2 && geoAlmostEqual(pts[pts.length - 1], pts[pts.length - 2])) pts.pop()
    if (pts.length >= 2) commitShape(tool, pts)
  }
  draftPoints.value = []
  draftCursor.value = null
}

function undoDrawing() {
  if (draftPoints.value.length) {
    draftPoints.value.pop()
  } else {
    drawings.value.pop()
  }
  requestDraw()
}

function clearDrawings() {
  drawings.value = []
  draftPoints.value = []
  draftCursor.value = null
  requestDraw()
}

// —— 绘图：图形删除（屏幕坐标下的就近命中）——
function pointSegmentDistance(px, py, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  let t = lenSq ? ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}

function rectBorderDistance(a, b, px, py) {
  const x0 = Math.min(a[0], b[0])
  const x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1])
  const y1 = Math.max(a[1], b[1])
  return Math.min(
    pointSegmentDistance(px, py, [x0, y0], [x1, y0]),
    pointSegmentDistance(px, py, [x1, y0], [x1, y1]),
    pointSegmentDistance(px, py, [x1, y1], [x0, y1]),
    pointSegmentDistance(px, py, [x0, y1], [x0, y0])
  )
}

function shapeScreenDistance(shape, scr, px, py) {
  const pts = scr.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (shape.kind === 'point') {
    return pts[0] ? Math.hypot(pts[0][0] - px, pts[0][1] - py) : null
  }
  if (shape.kind === 'box') {
    return pts.length >= 2 ? rectBorderDistance(pts[0], pts[1], px, py) : null
  }
  if (pts.length < 2) return null
  const smooth = catmullRom(pts, 1, 12)
  let min = Infinity
  for (let i = 0; i < smooth.length - 1; i++) {
    min = Math.min(min, pointSegmentDistance(px, py, smooth[i], smooth[i + 1]))
  }
  return min
}

function findShapeIndexNear(event) {
  const canvas = canvasRef.value
  if (!canvas) return -1
  const rect = canvas.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  const projection = buildProjection()
  const threshold = 12
  let bestIdx = -1
  let bestDist = threshold
  drawings.value.forEach((shape, idx) => {
    const scr = shape.points.map((point) => transformedPoint(projection, point))
    const dist = shapeScreenDistance(shape, scr, px, py)
    if (dist != null && dist < bestDist) {
      bestDist = dist
      bestIdx = idx
    }
  })
  return bestIdx
}

function deleteShapeNear(event) {
  const idx = findShapeIndexNear(event)
  if (idx >= 0) {
    drawings.value.splice(idx, 1)
    hoverDeleteIndex.value = -1
    requestDraw()
  }
}

// —— 绘图：画布鼠标事件 ——
function handleCanvasPointerDown(event) {
  if (!drawMode.value) return
  const tool = getDrawTool(activeDrawTool.value)
  if (!tool || tool.kind !== 'box') return
  const geo = screenToGeo(event)
  if (!geo) return
  boxStartGeo = geo
  boxDragging = true
  draftCursor.value = geo
  requestDraw()
}

function handleCanvasPointerUp(event) {
  if (!drawMode.value || !boxDragging) return
  const tool = getDrawTool(activeDrawTool.value)
  boxDragging = false
  const geo = screenToGeo(event) || draftCursor.value
  if (tool && tool.kind === 'box' && boxStartGeo && geo &&
    (Math.abs(geo.lon - boxStartGeo.lon) > 1e-4 || Math.abs(geo.lat - boxStartGeo.lat) > 1e-4)) {
    commitShape(tool, [[boxStartGeo.lon, boxStartGeo.lat], [geo.lon, geo.lat]])
  }
  boxStartGeo = null
  draftCursor.value = null
  requestDraw()
}

function handleCanvasClick(event) {
  if (!drawMode.value) return
  const tool = getDrawTool(activeDrawTool.value)
  if (!tool) return
  if (tool.kind === 'erase') {
    deleteShapeNear(event)
    return
  }
  const geo = screenToGeo(event)
  if (!geo) return
  if (tool.kind === 'point') {
    commitShape(tool, [[geo.lon, geo.lat]])
  } else if (tool.kind === 'line') {
    draftPoints.value.push([geo.lon, geo.lat])
    requestDraw()
  }
}

// 双击左键：结束当前线绘制。
function handleCanvasDblClick(event) {
  if (!drawMode.value) return
  const tool = getDrawTool(activeDrawTool.value)
  if (tool && tool.kind === 'line') {
    event.preventDefault()
    finishCurrentLine()
    requestDraw()
  }
}

// 右键：结束当前线（点数≥2 则提交，否则取消）。
function handleCanvasContextMenu(event) {
  if (!drawMode.value) return
  event.preventDefault()
  const tool = getDrawTool(activeDrawTool.value)
  if (tool && tool.kind === 'line') {
    finishCurrentLine()
    requestDraw()
  }
}

// 键盘：回车结束当前线，Esc 退出绘图模式。
function handleDrawKeydown(event) {
  if (!drawMode.value) return
  if (event.key === 'Enter') {
    finishCurrentLine()
    requestDraw()
  } else if (event.key === 'Escape') {
    exitDrawMode()
  }
}

// —— 绘图：渲染（在已应用 zoomTransform 的 context 中）——
function drawDrawings(context, projection) {
  const k = zoomTransform.value.k
  try {
    const eraseActive = drawMode.value && activeDrawTool.value === 'erase'
    drawings.value.forEach((shape, idx) => {
      const proj = shape.points.map((point) => projection(point))
      drawShape(context, shape, proj, k, false, eraseActive && idx === hoverDeleteIndex.value)
    })
    if (!drawMode.value) return
    const tool = getDrawTool(activeDrawTool.value)
    if (!tool) return
    if (tool.kind === 'line' && draftPoints.value.length) {
      const pts = draftPoints.value.slice()
      if (draftCursor.value) pts.push([draftCursor.value.lon, draftCursor.value.lat])
      const proj = pts.map((point) => projection(point))
      drawShape(context, { kind: 'line', render: tool.render, color: tool.color }, proj, k, true)
    } else if (tool.kind === 'box' && boxDragging && boxStartGeo && draftCursor.value) {
      const proj = [
        projection([boxStartGeo.lon, boxStartGeo.lat]),
        projection([draftCursor.value.lon, draftCursor.value.lat])
      ]
      drawShape(context, { kind: 'box', render: tool.render, color: tool.color }, proj, k, false)
    }
  } catch (error) {
    // 绘图渲染异常不应影响整幅地图的绘制与交互。
    console.warn('绘制手绘图形失败：', error)
  }
}

const hasDrawings = computed(() => drawings.value.length > 0 || draftPoints.value.length > 0)
const draftPointCount = computed(() => draftPoints.value.length)

const context = {
  activeSystemTab,
  applyInitAndFcHour,
  DEFAULT_FC_HOURS,
  canvasRef,
  changeFcHour,
  fcHour,
  fcHourIndex,
  fcHourOptions,
  DRAW_TOOLS,
  drawMode,
  activeDrawTool,
  setDrawTool,
  exitDrawMode,
  finishCurrentLine,
  undoDrawing,
  clearDrawings,
  closeMultiMap,
  hasDrawings,
  draftPointCount,
  handleCanvasPointerDown,
  handleCanvasPointerUp,
  handleCanvasClick,
  handleCanvasDblClick,
  handleCanvasContextMenu,
  forecastValidTimeLabel,
  forecastValidTimeBjtLabel,
  formatNumber,
  getSliderTooltip,
  handleMouseLeave,
  handleMouseMove,
  handleLayerTypeChange,
  hoverJetLine,
  hoverLine,
  hoverVortexCenter,
  hoverVortexTrack,
  initTime,
  isVortexTrackLevel,
  jetLineWidth,
  jetMinAvgWindSpeed,
  jetMinAxisLength,
  jetMinMaxWindSpeed,
  activeLayerCombinationName,
  applyLayerCombination,
  deleteLayerCombination,
  activeMultiElementConfigurationName,
  applyMultiElementConfiguration,
  deleteMultiElementConfiguration,
  createMultiElementConfiguration,
  elementConfig,
  activeElementKey,
  applyElementSelection,
  setCellElements,
  addElementLevel,
  removeElementLevel,
  addSingleLayerGroup,
  removeSingleLayerGroup,
  setSingleLayerGroupElements,
  resetElementConfig,
  reorderElementLevels,
  reorderSingleLayerGroups,
  elementLayerTypeOptions: LAYER_TYPE_OPTIONS,
  layerOptions,
  layerCombinationName,
  layerCombinationOptions,
  layerStatus,
  layerType,
  level,
  levelOptions,
  loadManifest,
  loadingState,
  multiMapMode,
  multiMapModeOptions,
  multiMapPanels,
  multiInitInterval,
  multiInitIntervalOptions,
  multiInitPanelCount,
  multiInitPanelCountOptions,
  multiForecastInterval,
  multiForecastIntervalOptions,
  multiForecastPanelCount,
  multiForecastPanelCountOptions,
  multiElementConfigurationName,
  multiElementConfigurations,
  multiElementPanelCount,
  multiElementPanelCountOptions,
  mouseGeo,
  openMultiMap,
  projectionName,
  projectionOptions,
  refreshToLatest,
  resetView,
  saveLayerCombination,
  savedLayerCombinations,
  scrollForecastSlider,
  setMultiInitInterval,
  setMultiInitPanelCount,
  setMultiForecastInterval,
  setMultiForecastPanelCount,
  setMultiElementConfigurationName,
  setMultiElementPanelCount,
  shiftInitTime,
  shiftMultiForecastPage,
  selectedLayerLabels,
  selectedLayerTypes,
  saveMultiElementConfiguration,
  renameMultiElementConfiguration,
  updateMultiElementPanel,
  canShiftMultiForecastBackward,
  canShiftMultiForecastForward,
  SHEAR_COLORS,
  shellRef,
  showFutureVortexTracks,
  showHistoricalVortexTracks,
  showJetArrowHeads,
  showJetAxes,
  showRawPoints,
  showSvgLayer,
  showTileDebug,
  showTooltip,
  showTrough,
  showVortexCenters,
  showVortexTracks,
  showWarmOnlyCenters,
  showWarmOnlyTracks,
  showOnlyFutureVortexTracks,
  sliderIndexCount,
  sliderOpts,
  markSlider,
  systemTabs,
  troughLineWidth,
  troughMinLength,
  troughMinWindSpeed,
  troughShearFilters,
  troughShearOptions,
  visibleJetAxisCount,
  visibleTroughCount,
  visibleVortexCenterCount,
  visibleVortexTrackCount,
  vortexMinVorticity,
  vortexMinWindSpeed,
  vortexTrackMinWindSpeed,
  zoomTransform,
  errorMessage,
  preloading
}

watch(
  () => syncState?.zoom,
  (snapshot) => {
    if (snapshot?.source === syncId) return
    applySynchronizedZoom(snapshot)
  }
)

watch(
  () => syncState?.cursor,
  () => requestDraw()
)

watch([
  multiMapMode,
  initTime,
  fcHour,
  level,
  selectedLayerTypes,
  multiInitInterval,
  multiInitPanelCount,
  multiForecastInterval,
  multiForecastPanelCount,
  multiElementPanelCount
], () => {
  if (multiMapMode.value) openMultiMap(multiMapMode.value)
}, { deep: true })

watch([fcHour, level], async () => {
  await loadActiveLayer()
  await loadTrough()
  await loadJetAxes()
  await loadVortexCenters()
})

watch(selectedLayerTypes, async () => {
  await loadActiveLayer()
}, { deep: true })

watch(projectionName, async () => {
  await loadActiveLayer()
})

watch([
  showSvgLayer,
  showTrough,
  showJetAxes,
  showRawPoints,
  showVortexCenters,
  showVortexTracks,
  showWarmOnlyTracks,
  showWarmOnlyCenters,
  showTooltip,
  showTileDebug,
  troughMinLength,
  troughMinWindSpeed,
  troughLineWidth,
  jetMinAxisLength,
  jetMinAvgWindSpeed,
  jetMinMaxWindSpeed,
  jetLineWidth,
  showJetArrowHeads,
  vortexMinWindSpeed,
  vortexMinVorticity,
  vortexTrackMinWindSpeed,
  showFutureVortexTracks,
  showOnlyFutureVortexTracks
], () => {
  clearHoverState()
  requestDraw()
})

watch(troughShearFilters, () => {
  clearHoverState()
  requestDraw()
}, { deep: true })

onMounted(async () => {
  await nextTick()
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (shellRef.value) resizeObserver.observe(shellRef.value)

  zoomBehavior = d3.zoom()
    .scaleExtent([0.6, 40])
    .filter((event) => {
      // 绘图模式下屏蔽鼠标拖拽/双击引发的平移与缩放，仅保留滚轮缩放，避免与绘图冲突。
      if (drawMode.value && event.type !== 'wheel') return false
      return (!event.ctrlKey || event.type === 'wheel') && !event.button
    })
    .on('zoom', (event) => {
      zoomTransform.value = event.transform
      if (syncState && syncId && !applyingSynchronizedZoom) {
        const projection = buildProjection()
        const viewportCenter = event.transform.invert([canvasSize.width / 2, canvasSize.height / 2])
        const center = projection.invert(viewportCenter)
        syncState.zoom = {
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
          center: center && Number.isFinite(center[0]) && Number.isFinite(center[1])
            ? [center[0], center[1]]
            : null,
          source: syncId
        }
      }
      const nextTileZoom = getTileZoom(event.transform.k)
      const nextRenderScale = renderScaleForZoom(event.transform.k)
      const tileZoomChanged = selectedLayerHasTiles() && nextTileZoom !== loadedTileZoom
      const renderScaleChanged = nextRenderScale !== loadedRenderScale && activeSvgLayers.value.length > 0
      if (tileZoomChanged || renderScaleChanged) {
        loadActiveLayer()
      } else if (selectedLayerHasTiles()) {
        loadVisibleTileDelta()
      }
      requestDraw()
    })

  d3.select(canvasRef.value).call(zoomBehavior)
  window.addEventListener('keydown', handleDrawKeydown)
  resizeCanvas()
  if (transformFromSync(syncState?.zoom)) {
    applySynchronizedZoom(syncState.zoom)
  } else {
    applyDefaultView()
  }
  await Promise.all([loadWorld(), loadManifest()])
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', handleDrawKeydown)
  if (preloadTimer) {
    clearTimeout(preloadTimer)
    preloadTimer = null
  }
  preloadRunId += 1
  if (canvasRef.value) d3.select(canvasRef.value).on('.zoom', null)
})

return context
}
