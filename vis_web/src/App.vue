<script setup>
import * as d3 from 'd3'
import { RefreshCw, RotateCcw } from 'lucide-vue-next'
import {
  NButton,
  NConfigProvider,
  NInput,
  NSelect,
  NSwitch,
  NTag,
  NTooltip
} from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { feature } from 'topojson-client'

import { SvgImageCache } from './utils/indexedDBCache'

const DEFAULT_INIT_TIME = '2026062900'
const DEFAULT_FC_HOURS = [
  '000', '003', '006', '009', '012', '015', '018', '021', '024',
  '027', '030', '033', '036', '039', '042', '045', '048'
]
const DEFAULT_LEVELS = ['200', '500', '850', '925', '950', '1000']
const SHEAR_COLORS = {
  shear_u_left: '#2563eb',
  shear_u_right: '#16a34a',
  shear_v_up: '#dc2626',
  shear_v_down: '#f97316'
}
const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

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
const activeSvgImage = ref(null)
const activeLayerRecord = ref(null)
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
const showTooltip = ref(true)
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

const fallbackLayerOptions = [
  { label: '高度场等值线', value: 'hght_contour' },
  { label: '风矢量', value: 'wind_quiver' },
  { label: '风羽', value: 'wind_barb' },
  { label: '风速填色', value: 'wind_speed_fill' },
  { label: '流线', value: 'wind_streamline' },
  { label: '地面风矢量', value: 'surface_quiver' },
  { label: '地面风羽', value: 'surface_barb' },
  { label: '地面风速填色', value: 'surface_speed_fill' },
  { label: '地面流线', value: 'surface_streamline' }
]

const fcHourOptions = computed(() => {
  const hours = manifest.value?.fc_hours?.length ? manifest.value.fc_hours : DEFAULT_FC_HOURS
  return hours.map((value) => ({ label: `+${value} h`, value }))
})

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

const layerStatus = computed(() => {
  if (!manifest.value) return '等待 manifest'
  if (!activeLayerRecord.value) return '无匹配图层'
  return activeLayerRecord.value.status === 'generated' || activeLayerRecord.value.status === 'skipped'
    ? '可用'
    : activeLayerRecord.value.status
})

const visibleTroughCount = computed(() => troughData.value?.trough_lines?.length || 0)
const visibleJetAxisCount = computed(() => jetData.value?.jet_axis_lines?.length || 0)
const visibleVortexCenterCount = computed(() => vortexCenters.value?.length || 0)
const visibleVortexTrackCount = computed(() => {
  if (String(level.value) !== '850') return 0
  const tracks = vortexTracks.value?.tracks || []
  return showWarmOnlyTracks.value ? tracks.filter((track) => track.warm).length : tracks.length
})

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

function normalizeFcHour(value) {
  return String(value || '0').padStart(3, '0')
}

function layerUrl(record) {
  if (!record?.path) return null
  return `/data/products/${initTime.value}/${record.path}`
}

function currentRecord() {
  const products = manifest.value?.products
  return products?.[fcHour.value]?.[level.value]?.[layerType.value] || null
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
      .rotate([-110, 0, 0])
      .center([0, 30])
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

  drawBaseMap(context, path)
  drawSvgLayer(context, projection)
  drawTroughLines(context, projection)
  drawJetAxes(context, projection)
  drawVortexTracks(context, projection)
  drawVortexCenters(context, projection)
  drawGraticule(context, projection)

  context.restore()
  drawHudFrame(context)
}

function trackColor(track) {
  return track.warm ? '#7f1d1d' : '#1e3a8a'
}

function drawBaseMap(context, path) {
  if (!worldFeatures.value) return

  context.beginPath()
  path({ type: 'Sphere' })
  context.fillStyle = '#edf6f9'
  context.fill()

  context.beginPath()
  path(worldFeatures.value)
  context.fillStyle = '#d9e5de'
  context.fill()
  context.strokeStyle = '#53616f'
  context.lineWidth = 0.65 / zoomTransform.value.k
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

function drawSvgLayer(context, projection) {
  if (!showSvgLayer.value || !activeSvgImage.value || !activeLayerRecord.value) return

  const bounds = activeLayerRecord.value.bounds
  const topLeft = projection([bounds.lon_min, bounds.lat_max])
  const bottomRight = projection([bounds.lon_max, bounds.lat_min])
  if (!topLeft || !bottomRight) return

  context.globalAlpha = layerType.value.includes('fill') ? 0.82 : 1
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    activeSvgImage.value,
    topLeft[0],
    topLeft[1],
    bottomRight[0] - topLeft[0],
    bottomRight[1] - topLeft[1]
  )
  context.globalAlpha = 1
}

function drawTroughLines(context, projection) {
  if (!showTrough.value || !troughData.value?.trough_lines) return

  for (const line of troughData.value.trough_lines) {
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
    context.lineWidth = Math.max(1.2 / zoomTransform.value.k, 0.65)
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
  if (!showJetAxes.value || !jetData.value?.jet_axis_lines?.length) return

  for (const line of jetData.value.jet_axis_lines) {
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
    context.lineWidth = 2.2 / zoomTransform.value.k
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()

    drawJetArrowHead(context, projectedPoints)
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
  if (String(level.value) !== '850' || !showVortexTracks.value || !vortexTracks.value?.tracks?.length) return

  vortexTracks.value.tracks.forEach((track) => {
    if (showWarmOnlyTracks.value && !track.warm) return
    const points = (track.track || []).filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    if (points.length < 2) return

    const currentStep = Number(fcHour.value)
    const pastPoints = points.filter((point) => Number(point.step ?? point.fc_hour) <= currentStep)
    const futurePoints = points.filter((point) => Number(point.step ?? point.fc_hour) >= currentStep)
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
  if (!showVortexCenters.value || !vortexCenters.value?.length) return

  for (const center of vortexCenters.value) {
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
  if (!showTooltip.value || !troughData.value?.trough_lines || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const line of troughData.value.trough_lines) {
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
  if (!showTooltip.value || !showJetAxes.value || !jetData.value?.jet_axis_lines?.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const line of jetData.value.jet_axis_lines) {
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
  if (!showTooltip.value || !showVortexCenters.value || !vortexCenters.value?.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  for (const center of vortexCenters.value) {
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
  if (String(level.value) !== '850' || !showTooltip.value || !showVortexTracks.value || !vortexTracks.value?.tracks?.length || !mouse) return null
  const projection = buildProjection()
  let nearest = null
  let nearestDistance = Infinity

  vortexTracks.value.tracks.forEach((track) => {
    if (showWarmOnlyTracks.value && !track.warm) return
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
  activeLayerRecord.value = null
  activeSvgImage.value = null
  loadingState.manifest = '加载中'

  try {
    manifest.value = await fetchJson(`/data/products/${initTime.value}/manifest.json`)
    loadingState.manifest = '完成'
    const firstFc = manifest.value.fc_hours?.[0]
    const firstLevel = manifest.value.levels?.find((item) => item !== 'surface') || manifest.value.levels?.[0]
    if (firstFc) fcHour.value = firstFc
    if (firstLevel) level.value = String(firstLevel)
    if (!layerOptions.value.some((item) => item.value === layerType.value)) {
      layerType.value = layerOptions.value[0]?.value || layerType.value
    }
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
  activeLayerRecord.value = currentRecord()
  activeSvgImage.value = null

  const url = layerUrl(activeLayerRecord.value)
  if (!url) {
    loadingState.svg = '无匹配图层'
    requestDraw()
    return
  }

  try {
    loadingState.svg = '加载中'
    const cached = await cache.get(url)
    if (cached) {
      activeSvgImage.value = cached
      loadingState.svg = '缓存命中'
      requestDraw()
      return
    }

    const image = new Image()
    image.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })
    activeSvgImage.value = image
    await cache.set(url, image)
    loadingState.svg = '完成'
  } catch {
    loadingState.svg = '缺失或加载失败'
  } finally {
    requestDraw()
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
  zoomTransform.value = d3.zoomIdentity
  if (canvasRef.value && zoomBehavior) {
    d3.select(canvasRef.value).transition().duration(160).call(zoomBehavior.transform, d3.zoomIdentity)
  }
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

watch([fcHour, level, layerType], async () => {
  await loadActiveLayer()
  await loadTrough()
  await loadJetAxes()
  await loadVortexCenters()
})

watch([showSvgLayer, showTrough, showJetAxes, showRawPoints, showVortexCenters, showVortexTracks, showWarmOnlyTracks, projectionName], () => {
  requestDraw()
})

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
  await Promise.all([loadWorld(), loadManifest()])
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  if (canvasRef.value) d3.select(canvasRef.value).on('.zoom', null)
})
</script>

<template>
  <n-config-provider>
    <main class="app-shell">
      <aside class="control-rail">
        <div class="brand-block">
          <h1>天气系统识别</h1>
          <p>SVG 图层与槽线交互查看</p>
        </div>

        <section class="control-section">
          <label>起报时次</label>
          <div class="inline-control">
            <n-input v-model:value="initTime" size="small" />
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button size="small" secondary circle @click="loadManifest">
                  <RefreshCw :size="16" />
                </n-button>
              </template>
              重新加载 manifest 与槽线
            </n-tooltip>
          </div>
        </section>

        <section class="control-section two-column">
          <div>
            <label>预报时效</label>
            <n-select v-model:value="fcHour" size="small" :options="fcHourOptions" />
          </div>
          <div>
            <label>气压层</label>
            <n-select v-model:value="level" size="small" :options="levelOptions" />
          </div>
        </section>

        <section class="control-section">
          <label>图层类型</label>
          <n-select v-model:value="layerType" size="small" :options="layerOptions" />
        </section>

        <section class="control-section">
          <label>投影</label>
          <div class="segmented">
            <button
              v-for="option in projectionOptions"
              :key="option.value"
              :class="{ active: projectionName === option.value }"
              @click="projectionName = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </section>

        <section class="switch-list">
          <label><span>SVG 图层</span><n-switch v-model:value="showSvgLayer" size="small" /></label>
          <label><span>槽线</span><n-switch v-model:value="showTrough" size="small" /></label>
          <label><span>急流轴</span><n-switch v-model:value="showJetAxes" size="small" /></label>
          <label><span>涡旋中心 L</span><n-switch v-model:value="showVortexCenters" size="small" /></label>
          <label>
            <span>850hPa 轨迹</span>
            <n-switch v-model:value="showVortexTracks" size="small" :disabled="level !== '850'" />
          </label>
          <label>
            <span>仅暖心轨迹</span>
            <n-switch v-model:value="showWarmOnlyTracks" size="small" :disabled="level !== '850'" />
          </label>
          <label><span>原始点</span><n-switch v-model:value="showRawPoints" size="small" /></label>
          <label><span>属性提示</span><n-switch v-model:value="showTooltip" size="small" /></label>
        </section>

        <section class="status-panel">
          <div><span>地图</span><n-tag size="small" :bordered="false">{{ loadingState.map }}</n-tag></div>
          <div><span>Manifest</span><n-tag size="small" :bordered="false">{{ loadingState.manifest }}</n-tag></div>
          <div><span>SVG</span><n-tag size="small" :bordered="false">{{ loadingState.svg }}</n-tag></div>
          <div><span>槽线</span><n-tag size="small" :bordered="false">{{ loadingState.trough }}</n-tag></div>
          <div><span>急流轴</span><n-tag size="small" :bordered="false">{{ loadingState.jet }}</n-tag></div>
          <div><span>涡旋中心</span><n-tag size="small" :bordered="false">{{ loadingState.vortexCenters }}</n-tag></div>
          <div><span>涡旋轨迹</span><n-tag size="small" :bordered="false">{{ level === '850' ? loadingState.vortexTracks : '仅850hPa显示' }}</n-tag></div>
          <div><span>图层状态</span><n-tag size="small" :bordered="false">{{ layerStatus }}</n-tag></div>
          <div><span>槽线数量</span><strong>{{ visibleTroughCount }}</strong></div>
          <div><span>急流轴数量</span><strong>{{ visibleJetAxisCount }}</strong></div>
          <div><span>中心数量</span><strong>{{ visibleVortexCenterCount }}</strong></div>
          <div><span>轨迹数量</span><strong>{{ visibleVortexTrackCount }}</strong></div>
        </section>

        <p v-if="errorMessage" class="empty-note">{{ errorMessage }}</p>
      </aside>

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
    </main>
  </n-config-provider>
</template>
