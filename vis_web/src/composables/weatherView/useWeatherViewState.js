// useWeatherView 的核心 store：集中创建全部响应式状态、领域 computed，以及被多个
// 行为模块共享的基础函数（buildProjection / requestDraw / recordForLayerType 等）。
// 各行为模块从本 store 解构 ref（解构 ref 不丢失响应性），因此函数体可与原实现保持一致。
import * as d3 from 'd3'
import { computed, reactive, ref } from 'vue'

import { calLatestBaseTime } from '../../utils/initTime'
import { loadElementConfig } from '../../utils/elementSelectorConfig'
import { sharedSvgImageCache } from '../../utils/indexedDBCache'
import {
  DEFAULT_FC_HOURS,
  DEFAULT_LEVELS,
  VORTEX_TRACK_LEVELS,
  DEFAULT_MAP_BOUNDS,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_SCALE,
  DEFAULT_SHEAR_FILTERS,
  LEVEL_SHEAR_DEFAULTS,
  fallbackLayerOptions
} from './constants'
import {
  normalizeFcHour,
  parseInitTime,
  padTimePart,
  passesMinimum,
  arraysEqual,
  trackStepRange,
  layerLabel,
  hasTiles,
  boundsPolygon,
  loadSavedLayerCombinations,
  loadSavedMapViews
} from './helpers'

// 运行期非响应式共享变量（原文件中的模块级 let）：跨行为模块读写，装配后由各模块直接改写。
export function createRuntime() {
  return {
    resizeObserver: null,
    zoomBehavior: null,
    applyingSynchronizedZoom: false,
    drawQueued: false,
    activeLayerLoadId: 0,
    visibleTileLoadId: 0,
    loadedTileZoom: null,
    loadedRenderScale: 1,
    preloadRunId: 0,
    preloadTimer: null,
    preloadAbortController: null
  }
}

export function createWeatherViewStore(initialView = {}) {
  const DEFAULT_INIT_TIME = calLatestBaseTime()

  const initialLayers = Array.isArray(initialView.selectedLayerTypes) && initialView.selectedLayerTypes.length
    ? initialView.selectedLayerTypes.map(String)
    : ['wind_barb']
  const compactView = Boolean(initialView.compact)
  // 多图子图专用预加载目标：由父级（MultiMapWorkspace 所在实例）在构造 panel 描述符时给出，
  // 内容为“本子图在相邻页/相邻时效切换后会用到的预报时效列表”。为空时不进行邻近预加载。
  const compactPreloadFcHours = Array.isArray(initialView.preloadFcHours)
    ? initialView.preloadFcHours.map(String)
    : null
  const minCanvasWidth = compactView ? 260 : 540
  const minCanvasHeight = compactView ? 200 : 420
  const syncState = initialView.syncState || null
  const syncId = initialView.syncId || null

  const canvasRef = ref(null)
  const shellRef = ref(null)
  const canvasSize = reactive({ width: 960, height: 640 })
  const zoomTransform = ref(d3.zoomIdentity)
  const projectionName = ref(initialView.projectionName || 'equirectangular')

  const drawMode = ref(false)
  const activeDrawTool = ref(null)
  const drawings = ref([])
  const draftPoints = ref([])
  const draftCursor = ref(null)
  const hoverDeleteIndex = ref(-1)

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
  const savedMapViews = ref(loadSavedMapViews())
  // 元素选择器（要素表格）配置与当前选中标识。
  const elementConfig = ref(loadElementConfig())
  const activeElementKey = ref('')
  const multiMapMode = ref(null)
  // 左侧「天气系统识别」控制面板的显隐（由地图上的按钮 toggle）
  const showControlRail = ref(true)
  const multiMapPanels = ref([])
  const multiInitInterval = ref('12')
  const multiInitPanelCount = ref(4)
  const multiForecastInterval = ref('24')
  const multiForecastPanelCount = ref(4)
  const multiElementPanelCount = ref(4)
  const multiElementConfigurations = ref([])
  const multiElementConfigurationName = ref('配置1')
  const activeMultiElementConfigurationName = ref('')
  const multiElementForecastRows = ref([])
  const multiElementForecastConfigurations = ref([])
  const multiElementForecastConfigurationName = ref('配置1')
  const activeMultiElementForecastConfigurationName = ref('')
  const troughData = ref(null)
  const jetData = ref(null)
  const coldFrontData = ref(null)
  const vortexCenters = ref([])
  const vortexTracks = ref(null)
  const showSvgLayer = ref(true)
  const showTrough = ref(true)
  const showJetAxes = ref(false)
  const showColdFronts = ref(true)
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
  const troughShearFiltersByLevel = reactive({})

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
  // 仅显示“当前时效落在轨迹时间区间内”的轨迹（初始时效≤当前时效 且 结束时效≥当前时效）
  const showOnlyActiveVortexTracks = ref(true)
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
    coldFront: '未加载',
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
  const cache = sharedSvgImageCache

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

  // —— 领域 computed ——
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

  const visibleColdFrontLines = computed(() => {
    if (!showColdFronts.value) return []
    return coldFrontData.value?.cold_front_lines || []
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
    const currentStep = Number(fcHour.value)
    const filterActive = showOnlyActiveVortexTracks.value && Number.isFinite(currentStep)
    return tracks.filter((track) => {
      if (showWarmOnlyTracks.value && !track.warm) return false
      if (!passesMinimum(track.max_wind, vortexTrackMinWindSpeed.value)) return false
      if (filterActive) {
        const [initStep, endStep] = trackStepRange(track)
        // 仅保留当前时效落在轨迹时间区间 [初始, 结束] 内的轨迹
        if (initStep === null || initStep > currentStep) return false
        if (endStep === null || endStep < currentStep) return false
      }
      return true
    })
  })

  const visibleTroughCount = computed(() => visibleTroughLines.value.length)
  const visibleJetAxisCount = computed(() => visibleJetAxisLines.value.length)
  const visibleColdFrontCount = computed(() => visibleColdFrontLines.value.length)
  const visibleVortexCenterCount = computed(() => visibleVortexCenters.value.length)
  const visibleVortexTrackCount = computed(() => visibleVortexTracks.value.length)

  // —— 时间/滑块格式化（仅依赖 store 内 ref，供 computed 与 ForecastSlider 使用）——
  function forecastValidDate(index) {
    const initDate = parseInitTime(initTime.value)
    const fcValue = sliderFcHours.value[Number(index)]
    if (!initDate || !fcValue) return null

    return new Date(initDate.getTime() + Number(fcValue) * 60 * 60 * 1000)
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

  // —— 图层/瓦片记录与 URL（依赖 initTime/fcHour/level/manifest ref）——
  function recordForLayerType(targetLayerType) {
    const products = manifest.value?.products
    return products?.[fcHour.value]?.[level.value]?.[targetLayerType] || null
  }

  function selectedLayerHasTiles() {
    return selectedLayerTypes.value.some((type) => hasTiles(recordForLayerType(type)))
  }

  function layerUrl(record) {
    if (!record?.path) return null
    return `/data/products/${initTime.value}/${record.path}`
  }

  function tileUrl(tile) {
    if (!tile?.path) return null
    return `/data/products/${initTime.value}/${tile.path}`
  }

  function layerHasLoadable(record) {
    return hasTiles(record) || Boolean(layerUrl(record))
  }

  function isUsableLayerStatus(status) {
    return status === 'generated' || status === 'skipped'
  }

  function sanitizeLayerSelection(values) {
    const available = new Set(layerOptions.value.map((option) => option.value))
    const selected = Array.from(new Set((values || []).filter((value) => available.has(value))))
    return selected.length ? selected : [layerOptions.value[0]?.value || layerType.value].filter(Boolean)
  }

  function setSelectedLayerTypes(values) {
    const next = sanitizeLayerSelection(values)
    if (!arraysEqual(selectedLayerTypes.value, next)) {
      selectedLayerTypes.value = next
    }
    return next
  }

  // —— 投影与边界 ——
  function manifestBounds() {
    const bounds = manifest.value?.tile_scheme?.bounds || manifest.value?.bounds || DEFAULT_MAP_BOUNDS
    return {
      lon_min: Number(bounds.lon_min ?? DEFAULT_MAP_BOUNDS.lon_min),
      lon_max: Number(bounds.lon_max ?? DEFAULT_MAP_BOUNDS.lon_max),
      lat_min: Number(bounds.lat_min ?? DEFAULT_MAP_BOUNDS.lat_min),
      lat_max: Number(bounds.lat_max ?? DEFAULT_MAP_BOUNDS.lat_max)
    }
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

  // drawMap 由渲染模块在装配阶段挂载到 store.drawMap；requestDraw 在运行期调用它，打破渲染环依赖。
  const runtime = createRuntime()
  const store = {
    // 构造参数派生
    initialView,
    initialLayers,
    compactView,
    compactPreloadFcHours,
    minCanvasWidth,
    minCanvasHeight,
    syncState,
    syncId,
    DEFAULT_INIT_TIME,
    runtime,
    cache,
    // 运行期挂载点：由渲染模块设置
    drawMap: null,

    // refs / reactive
    canvasRef,
    shellRef,
    canvasSize,
    zoomTransform,
    projectionName,
    drawMode,
    activeDrawTool,
    drawings,
    draftPoints,
    draftCursor,
    hoverDeleteIndex,
    initTime,
    fcHour,
    level,
    layerType,
    manifest,
    worldFeatures,
    chinaFeatures,
    activeSvgLayers,
    selectedLayerTypes,
    layerCombinationName,
    activeLayerCombinationName,
    savedLayerCombinations,
    savedMapViews,
    elementConfig,
    activeElementKey,
    multiMapMode,
    showControlRail,
    multiMapPanels,
    multiInitInterval,
    multiInitPanelCount,
    multiForecastInterval,
    multiForecastPanelCount,
    multiElementPanelCount,
    multiElementConfigurations,
    multiElementConfigurationName,
    activeMultiElementConfigurationName,
    multiElementForecastRows,
    multiElementForecastConfigurations,
    multiElementForecastConfigurationName,
    activeMultiElementForecastConfigurationName,
    troughData,
    jetData,
    coldFrontData,
    vortexCenters,
    vortexTracks,
    showSvgLayer,
    showTrough,
    showJetAxes,
    showColdFronts,
    showRawPoints,
    showVortexCenters,
    showVortexTracks,
    showWarmOnlyTracks,
    showWarmOnlyCenters,
    showTooltip,
    showTileDebug,
    activeSystemTab,
    troughMinLength,
    troughMinWindSpeed,
    troughLineWidth,
    troughShearFiltersByLevel,
    jetMinAxisLength,
    jetMinAvgWindSpeed,
    jetMinMaxWindSpeed,
    jetLineWidth,
    showJetArrowHeads,
    vortexMinWindSpeed,
    vortexMinVorticity,
    vortexTrackMinWindSpeed,
    showFutureVortexTracks,
    showOnlyFutureVortexTracks,
    showOnlyActiveVortexTracks,
    showHistoricalVortexTracks,
    loadingState,
    errorMessage,
    preloading,
    mouseGeo,
    hoverLine,
    hoverJetLine,
    hoverVortexCenter,
    hoverVortexTrack,

    // shear
    defaultShearFiltersForLevel,
    shearFiltersForLevel,
    troughShearFilters,

    // computed
    manifestFcHourSet,
    firstAvailableFcHour,
    sliderFcHours,
    fcHourIndex,
    sliderIndexCount,
    forecastValidTimeLabel,
    forecastValidTimeBjtLabel,
    fcHourOptions,
    levelOptions,
    layerOptions,
    layerCombinationOptions,
    selectedLayerLabels,
    fillLayerCount,
    layerStatus,
    visibleTroughLines,
    visibleJetAxisLines,
    visibleColdFrontLines,
    visibleVortexCenters,
    isVortexTrackLevel,
    visibleVortexTracks,
    visibleTroughCount,
    visibleJetAxisCount,
    visibleColdFrontCount,
    visibleVortexCenterCount,
    visibleVortexTrackCount,

    // 时间/滑块
    forecastValidDate,
    formatForecastValidTime,
    getSliderTooltip,
    markSlider,
    changeFcHour,
    scrollForecastSlider,

    // 图层/瓦片记录
    recordForLayerType,
    selectedLayerHasTiles,
    layerUrl,
    tileUrl,
    layerHasLoadable,
    isUsableLayerStatus,
    sanitizeLayerSelection,
    setSelectedLayerTypes,

    // 投影/坐标
    manifestBounds,
    buildProjection,
    transformedPoint,
    screenToGeo,

    // requestDraw 依赖运行期挂载的 store.drawMap
    requestDraw() {
      if (runtime.drawQueued) return
      runtime.drawQueued = true
      requestAnimationFrame(() => {
        runtime.drawQueued = false
        if (store.drawMap) store.drawMap()
      })
    }
  }

  return store
}
