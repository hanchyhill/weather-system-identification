// useWeatherView 的无状态纯函数集合：时间/通用/瓦片/图层/SVG/几何工具。
// 均不依赖响应式状态（个别函数以参数形式接收 fallbackLayerOptions 等常量），从原文件原样抽出。
import { sharedSvgImageCache } from '../../utils/indexedDBCache'
import { runQueued, PRIORITY } from '../../utils/loadQueue'
import {
  RENDER_SCALE_MAX,
  FILL_LAYER_TYPES,
  WIND_OVERLAY_LAYER_TYPES,
  CONTOUR_REFERENCE_ZOOM,
  CONTOUR_MAX_DILATION_PX,
  fallbackLayerOptions,
  DRAW_TOOLS,
  DEFAULT_MAP_VIEWS,
  LAYER_COMBINATION_STORAGE_KEY,
  MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY,
  MULTI_ELEMENT_FORECAST_CONFIGURATION_STORAGE_KEY,
  MAP_VIEW_STORAGE_KEY
} from './constants'

// 在途请求合并表（模块级，跨所有视图实例共享）：多个子图/单图同时请求同一 cacheKey 时，
// 只发起一次网络+解码，其余等待同一 Promise。键与内存缓存一致（含 @Nx 超采样后缀）。
const inFlightImageLoads = new Map()
const cache = sharedSvgImageCache

// compact（多图子图）恒为 1：子图在屏上很小，超采样带来的清晰度提升不可感知，
// 却会让位图像素数翻倍、重栅格化/绘制/内存显著增加，故直接封顶为 1。
export function renderScaleForZoom(k, compact = false) {
  if (compact) return 1
  if (!(k > 8)) return 1
  return RENDER_SCALE_MAX
}

// —— 通用数值 —— //
export function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

export function passesMinimum(value, minimum) {
  const threshold = Number(minimum)
  if (!Number.isFinite(threshold) || threshold <= 0) return true
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= threshold
}

export function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// 轨迹的时间区间：所有轨迹点中最小与最大的 step
export function trackStepRange(track) {
  let min = null
  let max = null
  for (const point of track.track || []) {
    const step = Number(point.step ?? point.fc_hour)
    if (!Number.isFinite(step)) continue
    if (min === null || step < min) min = step
    if (max === null || step > max) max = step
  }
  return [min, max]
}

// —— 时间 —— //
export function normalizeFcHour(value) {
  return String(value || '0').padStart(3, '0')
}

export function parseInitTime(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/)
  if (!match) return null

  const [, year, month, day, hour] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour)))
  return Number.isNaN(date.getTime()) ? null : date
}

export function padTimePart(value) {
  return String(value).padStart(2, '0')
}

export function formatInitTime(date) {
  return `${date.getUTCFullYear()}${padTimePart(date.getUTCMonth() + 1)}${padTimePart(date.getUTCDate())}${padTimePart(date.getUTCHours())}`
}

export function shiftedInitTime(value, offsetHours) {
  const date = parseInitTime(value)
  return date ? formatInitTime(new Date(date.getTime() + offsetHours * 60 * 60 * 1000)) : value
}

// —— 图层类型 —— //
export function layerLabel(value) {
  return fallbackLayerOptions.find((option) => option.value === value)?.label || value
}

export function isFillLayerType(value) {
  return FILL_LAYER_TYPES.has(value) || String(value).endsWith('_fill')
}

export function isFillLayerRecord(type, record) {
  if (type === 'hght_contour' && String(record?.level) === '500') return true
  return isFillLayerType(type)
}

export function layerDrawPriority(type) {
  if (WIND_OVERLAY_LAYER_TYPES.has(type)) return 20
  if (String(type).includes('contour')) return 10
  return 15
}

export function isUsableLayerStatus(status) {
  return status === 'generated' || status === 'skipped'
}

export function isContourLayer(layer) {
  return String(layer?.type || '').includes('contour')
}

// 计算等值线膨胀半径（当前缩放坐标系下的本地单位）。
// 屏幕像素补偿量随 k 从参考值线性增长，再除以 k 换算回被 context.scale(k) 缩放前的坐标。
export function contourDilationRadius(layer, k) {
  if (!isContourLayer(layer) || !(k > 0) || k >= CONTOUR_REFERENCE_ZOOM) return 0
  const screenPx = ((CONTOUR_REFERENCE_ZOOM - k) / CONTOUR_REFERENCE_ZOOM) * CONTOUR_MAX_DILATION_PX
  return screenPx / k
}

// —— 瓦片 —— //
export function hasTiles(record) {
  return Boolean(record?.tiles && typeof record.tiles === 'object')
}

export function tilesForRecord(record, z) {
  if (!hasTiles(record)) return []
  const tiles = record.tiles[String(z)]
  return Array.isArray(tiles) ? tiles : []
}

export function availableTileZooms(record) {
  if (!hasTiles(record)) return []
  return Object.keys(record.tiles)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
}

export function resolveTileZoom(record, desiredZ) {
  const availableZooms = availableTileZooms(record)
  if (!availableZooms.length) return null

  const desired = Number.parseInt(desiredZ, 10)
  if (availableZooms.includes(desired)) return desired

  const lowerOrEqual = availableZooms.filter((value) => value <= desired)
  if (lowerOrEqual.length) return lowerOrEqual[lowerOrEqual.length - 1]
  return availableZooms[0]
}

export function getTileZoom(k) {
  if (k <= 5) return 0
  if (k <= 8) return 1
  return 2
}

export function boundsPolygon(bounds) {
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

export function isTileVisible(tile, projection, size, transform) {
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

// —— SVG 图像加载 —— //
export function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = async () => {
      // 主动 decode() 让位图在解码完成后再返回，避免首次 drawImage 时同步栅格化阻塞主线程。
      try {
        if (typeof image.decode === 'function') await image.decode()
      } catch {
        // decode() 失败（个别浏览器/跨域）时退回到 onload 语义，仍可绘制。
      }
      resolve(image)
    }
    image.onerror = reject
    image.src = src
  })
}

// 放大 SVG 根节点的 width/height（保留 viewBox），使浏览器以更高分辨率栅格化矢量图，
// 从而在高放大系数下获得更清晰的等值线与填色边缘。
export function scaleSvgMarkup(text, scale) {
  return text.replace(/<svg\b[^>]*>/i, (tag) => (
    tag.replace(/\b(width|height)\s*=\s*"(\d*\.?\d+)([a-z%]*)"/gi, (match, attr, value, unit) => (
      `${attr}="${Number.parseFloat(value) * scale}${unit}"`
    ))
  ))
}

export async function loadSvgImage(url, renderScale = 1, priority = PRIORITY.HIGH, signal = null) {
  if (!url) return null
  const scale = renderScale > 1 ? renderScale : 1
  const cacheKey = scale > 1 ? `${url}@${scale}x` : url
  try {
    const cached = await cache.get(cacheKey)
    if (cached) return cached

    // 在途合并：相同 cacheKey 的并发请求复用同一 Promise，避免多个子图重复网络/解码。
    const pending = inFlightImageLoads.get(cacheKey)
    if (pending) return await pending

    // 网络+解码走全局限流器；可见瓦片高优先、预加载低优先，避免多图 stampede 打满连接池。
    // signal 使尚未开始的（预加载）任务在切换/卸载时可被取消，及时把并发名额让给可见瓦片。
    const task = runQueued(async () => {
      let image
      if (scale > 1) {
        // 以更高的超采样倍率重新栅格化：拉取 SVG 源文本、放大根节点尺寸后再解码。
        const response = await fetch(url, signal ? { signal } : undefined)
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
      cache.set(cacheKey, image)
      return image
    }, priority, signal)

    inFlightImageLoads.set(cacheKey, task)
    try {
      return await task
    } finally {
      inFlightImageLoads.delete(cacheKey)
    }
  } catch {
    inFlightImageLoads.delete(cacheKey)
    return null
  }
}

// —— 几何（屏幕坐标下的命中/箭头计算）—— //
export function geoAlmostEqual(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

export function pointSegmentDistance(px, py, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  let t = lenSq ? ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}

export function rectBorderDistance(a, b, px, py) {
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

// 折线终段附近的箭头几何：返回箭头基准点与方向角，供绘制急流轴/涡旋轨迹的箭头。
export function lineArrowGeometry(projectedPoints) {
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

// —— 手绘工具 —— //
export function getDrawTool(key) {
  return DRAW_TOOLS.find((tool) => tool.key === key) || null
}

// —— 本地存储读取（无状态：仅从 localStorage 解析，不触碰响应式状态）—— //
export function loadSavedLayerCombinations() {
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

export function loadSavedMapViews() {
  if (typeof window === 'undefined') return defaultMapViews()
  try {
    const raw = window.localStorage.getItem(MAP_VIEW_STORAGE_KEY)
    // 存储键缺失（首次使用）时注入系统内置默认视图；键已存在（含被清空为 []）则以用户数据为准。
    if (raw === null) return defaultMapViews()
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((view) => {
        const center = Array.isArray(view?.center) ? view.center.map(Number) : []
        const k = Number(view?.k)
        const name = String(view?.name || '').trim()
        if (!name || center.length !== 2 || !Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !Number.isFinite(k)) {
          return null
        }
        return { name, center, k }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

// 深拷贝内置默认视图，避免多个视图实例共享/改动模块级常量。
export function defaultMapViews() {
  return DEFAULT_MAP_VIEWS.map((view) => ({ name: view.name, center: [...view.center], k: view.k }))
}
