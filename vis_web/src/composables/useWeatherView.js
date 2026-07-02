import * as d3 from 'd3'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { feature } from 'topojson-client'

import { SvgImageCache } from '../utils/indexedDBCache'

export function useWeatherView() {

const DEFAULT_INIT_TIME = '2026062900'
const DEFAULT_FC_HOURS = [
  '000', '003', '006', '009', '012', '015', '018', '021', '024',
  '027', '030', '033', '036', '039', '042', '045', '048', '051',
  '054', '057', '060', '063', '066', '069', '072', '078', '084',
  '090', '096', '102', '108', '114', '120', '126', '132', '138',
  '144', '150', '156', '162', '168', '174', '180', '186', '192',
  '198', '204', '210', '216', '222', '228', '234', '240'
]
const DEFAULT_LEVELS = ['200', '500', '700', '850', '925', '950', '1000']
const DEFAULT_MAP_CENTER = [110, 29]
const DEFAULT_MAP_SCALE = 3
const SHEAR_COLORS = {
  shear_u_left: '#2563eb',
  shear_u_right: '#16a34a',
  shear_v_up: '#dc2626',
  shear_v_down: '#f97316'
}
const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
const LAYER_COMBINATION_STORAGE_KEY = 'weather-view-layer-combinations'
const FILL_LAYER_TYPES = new Set(['wind_speed_fill', 'vort_fill', 'rhum_fill', 'surface_speed_fill'])
const WIND_OVERLAY_LAYER_TYPES = new Set([
  'wind_quiver',
  'wind_barb',
  'wind_streamline',
  'surface_quiver',
  'surface_barb',
  'surface_streamline'
])

const canvasRef = ref(null)
const shellRef = ref(null)
const canvasSize = reactive({ width: 960, height: 640 })
const zoomTransform = ref(d3.zoomIdentity)
const projectionName = ref('equirectangular')
const initTime = ref(DEFAULT_INIT_TIME)
const fcHour = ref('000')
const level = ref('500')
const layerType = ref('wind_speed_fill')
const manifest = ref(null)
const worldFeatures = ref(null)
const activeSvgLayers = ref([])
const selectedLayerTypes = ref(['wind_speed_fill'])
const layerCombinationName = ref('风速填色')
const activeLayerCombinationName = ref('风速填色')
const savedLayerCombinations = ref(loadSavedLayerCombinations())
const troughData = ref(null)
const jetData = ref(null)
const vortexCenters = ref([])
const vortexTracks = ref(null)
const showSvgLayer = ref(true)
const showTrough = ref(true)
const showJetAxes = ref(true)
const showRawPoints = ref(false)
const showVortexCenters = ref(true)
const showVortexTracks = ref(true)
const showWarmOnlyTracks = ref(false)
const showWarmOnlyCenters = ref(false)
const showTooltip = ref(true)
const activeSystemTab = ref('trough')
const troughMinLength = ref(0)
const troughMinWindSpeed = ref(0)
const troughLineWidth = ref(1.2)
const troughShearFilters = reactive({
  shear_u_left: true,
  shear_u_right: true,
  shear_v_up: true,
  shear_v_down: true
})
const jetMinAxisLength = ref(0)
const jetMinAvgWindSpeed = ref(0)
const jetMinMaxWindSpeed = ref(0)
const jetLineWidth = ref(2.2)
const showJetArrowHeads = ref(true)
const vortexMinWindSpeed = ref(0)
const vortexMinVorticity = ref(0)
const vortexTrackMinWindSpeed = ref(0)
const showFutureVortexTracks = ref(true)
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
const mouseGeo = ref(null)
const hoverLine = ref(null)
const hoverJetLine = ref(null)
const hoverVortexCenter = ref(null)
const hoverVortexTrack = ref(null)
const cache = new SvgImageCache()

let resizeObserver = null
let zoomBehavior = null
let drawQueued = false

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
    return troughShearFilters[line.shear_type] !== false
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

const visibleVortexTracks = computed(() => {
  if (String(level.value) !== '850' || !showVortexTracks.value) return []
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

function recordForLayerType(targetLayerType) {
  const products = manifest.value?.products
  return products?.[fcHour.value]?.[level.value]?.[targetLayerType] || null
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
}

function buildProjection() {
  const margin = { left: 46, top: 18, right: 22, bottom: 34 }
  const extent = {
    type: 'Polygon',
    coordinates: [[
      [60, 0],
      [180, 0],
      [180, 60],
      [60, 60],
      [60, 0]
    ]]
  }

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

  context.restore()
  drawHudFrame(context)
}

function trackColor(track) {
  return track.warm ? '#7f1d1d' : '#1e3a8a'
}

function drawBaseMap(context, path) {
  if (!worldFeatures.value) return

  context.beginPath()
  path(worldFeatures.value)
  context.strokeStyle = 'rgba(48, 60, 76, 0.78)'
  context.lineWidth = 0.72 / zoomTransform.value.k
  context.stroke()
}

function drawGraticule(context, projection) {
  const interval = zoomTransform.value.k >= 4 ? 5 : zoomTransform.value.k >= 2 ? 10 : 15
  const path = d3.geoPath(projection, context)
  const graticule = d3.geoGraticule().extent([[60, 0], [180, 60]]).step([interval, interval])

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
  if (!layer?.image || !layer?.record) return

  const bounds = layer.record.bounds
  const topLeft = projection([bounds.lon_min, bounds.lat_max])
  const bottomRight = projection([bounds.lon_max, bounds.lat_min])
  if (!topLeft || !bottomRight) return

  context.globalAlpha = layer.isFill && fillLayerCount.value > 1 ? 0.5 : 1
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    layer.image,
    topLeft[0],
    topLeft[1],
    bottomRight[0] - topLeft[0],
    bottomRight[1] - topLeft[1]
  )
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

    if (showJetArrowHeads.value) drawJetArrowHead(context, projectedPoints)
    context.restore()
  }
}

function drawJetArrowHead(context, projectedPoints) {
  const arrow = jetArrowGeometry(projectedPoints)
  if (!arrow) return

  const { point: baseCenter, angle } = arrow
  const length = 24 / zoomTransform.value.k
  const halfWidth = 5 / zoomTransform.value.k
  const tip = [
    baseCenter[0] + length * Math.cos(angle),
    baseCenter[1] + length * Math.sin(angle)
  ]
  const normal = angle + Math.PI / 2

  context.fillStyle = '#e11d48'
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

function jetArrowGeometry(projectedPoints) {
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
    const points = (track.track || []).filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    if (points.length < 2) return

    const currentStep = Number(fcHour.value)
    const pastPoints = points.filter((point) => Number(point.step ?? point.fc_hour) <= currentStep)
    const futurePoints = showFutureVortexTracks.value
      ? points.filter((point) => Number(point.step ?? point.fc_hour) >= currentStep)
      : []
    const color = trackColor(track)
    const lineWidth = track.warm ? 2.1 / zoomTransform.value.k : 1.5 / zoomTransform.value.k

    drawTrackSegment(context, projection, pastPoints, color, lineWidth, false)
    drawTrackSegment(context, projection, futurePoints, color, lineWidth, true)
  })
}

function drawTrackSegment(context, projection, points, color, lineWidth, dashed) {
  if (points.length < 2) return

  context.save()
  context.beginPath()
  points.forEach((point, pointIndex) => {
    const xy = projection([point.lon, point.lat])
    if (!xy) return
    if (pointIndex === 0) context.moveTo(xy[0], xy[1])
    else context.lineTo(xy[0], xy[1])
  })
  context.strokeStyle = color
  context.lineWidth = lineWidth
  context.setLineDash(dashed ? [5 / zoomTransform.value.k, 4 / zoomTransform.value.k] : [])
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.stroke()
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

function drawHudFrame(context) {
  context.strokeStyle = '#bcc7d3'
  context.lineWidth = 1
  context.strokeRect(0.5, 0.5, canvasSize.width - 1, canvasSize.height - 1)
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
    for (const point of track.track || []) {
      const screen = transformedPoint(projection, [point.lon, point.lat])
      if (!screen) continue
      const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = { track, point }
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

async function loadWorld() {
  try {
    loadingState.map = '加载中'
    const world = await fetchJson(WORLD_URL)
    worldFeatures.value = feature(world, world.objects.countries)
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
    const firstLevel = manifest.value.levels?.find((item) => item !== 'surface') || manifest.value.levels?.[0]
    if (manifestFcHourSet.value && !manifestFcHourSet.value.has(fcHour.value)) {
      fcHour.value = firstAvailableFcHour.value
    }
    if (firstLevel) level.value = String(firstLevel)
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
  activeSvgLayers.value = []
  setSelectedLayerTypes(selectedLayerTypes.value)
  const candidates = selectedLayerTypes.value.map((type) => ({
    type,
    record: recordForLayerType(type)
  }))
  const loadable = candidates.filter((item) => layerUrl(item.record))

  if (!loadable.length) {
    loadingState.svg = '无匹配图层'
    requestDraw()
    return
  }

  try {
    loadingState.svg = '加载中'
    const loadedLayers = await Promise.all(loadable.map((item, order) => loadSvgLayer(item, order)))
    activeSvgLayers.value = loadedLayers.filter(Boolean)
    const missingCount = candidates.length - activeSvgLayers.value.length
    loadingState.svg = missingCount
      ? `${activeSvgLayers.value.length}层完成 / ${missingCount}层缺失`
      : `${activeSvgLayers.value.length}层完成`
  } finally {
    requestDraw()
  }
}

async function loadSvgLayer({ type, record }, order) {
  const url = layerUrl(record)
  try {
    const cached = await cache.get(url)
    if (cached) {
      return {
        type,
        record,
        image: cached,
        isFill: isFillLayerRecord(type, record),
        order
      }
    }

    const image = new Image()
    image.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })
    await cache.set(url, image)
    return {
      type,
      record,
      image,
      isFill: isFillLayerRecord(type, record),
      order
    }
  } catch {
    return null
  }
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
  mouseGeo.value = screenToGeo(event)
  hoverVortexCenter.value = findNearestVortexCenter(mouseGeo.value)
  hoverVortexTrack.value = hoverVortexCenter.value ? null : findNearestVortexTrack(mouseGeo.value)
  hoverJetLine.value = hoverVortexCenter.value || hoverVortexTrack.value ? null : findNearestJetLine(mouseGeo.value)
  hoverLine.value = hoverVortexCenter.value || hoverVortexTrack.value || hoverJetLine.value ? null : findNearestLine(mouseGeo.value)
}

function handleMouseLeave() {
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
  canvasSize.width = Math.max(540, Math.floor(rect.width))
  canvasSize.height = Math.max(420, Math.floor(rect.height))
  requestDraw()
}

const context = {
  activeSystemTab,
  canvasRef,
  changeFcHour,
  fcHour,
  fcHourIndex,
  fcHourOptions,
  forecastValidTimeLabel,
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
  jetLineWidth,
  jetMinAvgWindSpeed,
  jetMinAxisLength,
  jetMinMaxWindSpeed,
  activeLayerCombinationName,
  applyLayerCombination,
  deleteLayerCombination,
  layerOptions,
  layerCombinationName,
  layerCombinationOptions,
  layerStatus,
  layerType,
  level,
  levelOptions,
  loadManifest,
  loadingState,
  mouseGeo,
  projectionName,
  projectionOptions,
  resetView,
  saveLayerCombination,
  savedLayerCombinations,
  scrollForecastSlider,
  selectedLayerLabels,
  selectedLayerTypes,
  SHEAR_COLORS,
  shellRef,
  showFutureVortexTracks,
  showJetArrowHeads,
  showJetAxes,
  showRawPoints,
  showSvgLayer,
  showTooltip,
  showTrough,
  showVortexCenters,
  showVortexTracks,
  showWarmOnlyCenters,
  showWarmOnlyTracks,
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
  errorMessage
}

watch([fcHour, level], async () => {
  await loadActiveLayer()
  await loadTrough()
  await loadJetAxes()
  await loadVortexCenters()
})

watch(selectedLayerTypes, async () => {
  await loadActiveLayer()
}, { deep: true })

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
  projectionName,
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
  showFutureVortexTracks
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
    .scaleExtent([0.6, 10])
    .on('zoom', (event) => {
      zoomTransform.value = event.transform
      requestDraw()
    })

  d3.select(canvasRef.value).call(zoomBehavior)
  resizeCanvas()
  applyDefaultView()
  await Promise.all([loadWorld(), loadManifest()])
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  if (canvasRef.value) d3.select(canvasRef.value).on('.zoom', null)
})

return context
}
