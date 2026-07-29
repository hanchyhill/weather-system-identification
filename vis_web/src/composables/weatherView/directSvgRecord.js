import { DEFAULT_MAP_BOUNDS } from './constants.js'

const MULTI_Z_LAYER_TYPES = new Set([
  'wind_barb',
  'wind_quiver',
  'surface_barb',
  'surface_quiver'
])
const MATRIX_BOUNDS = { lon_min: -120, lon_max: 240, lat_min: -120, lat_max: 120 }
const BASE_TILE_SIZE = { lon: 90, lat: 60 }
const TILE_LEVELS = [0, 1, 2]

function tileBounds(z, x, y) {
  const divisor = 2 ** z
  const lonSize = BASE_TILE_SIZE.lon / divisor
  const latSize = BASE_TILE_SIZE.lat / divisor
  return {
    lon_min: MATRIX_BOUNDS.lon_min + x * lonSize,
    lon_max: MATRIX_BOUNDS.lon_min + (x + 1) * lonSize,
    lat_min: MATRIX_BOUNDS.lat_max - (y + 1) * latSize,
    lat_max: MATRIX_BOUNDS.lat_max - y * latSize
  }
}

function intersects(left, right) {
  return left.lon_min < right.lon_max
    && left.lon_max > right.lon_min
    && left.lat_min < right.lat_max
    && left.lat_max > right.lat_min
}

function directTiles(fcHour, level, layerType, z) {
  const divisor = 2 ** z
  const xCount = 4 * divisor
  const yCount = 4 * divisor
  const tiles = []
  for (let y = 0; y < yCount; y += 1) {
    for (let x = 0; x < xCount; x += 1) {
      const bounds = tileBounds(z, x, y)
      if (!intersects(bounds, DEFAULT_MAP_BOUNDS)) continue
      tiles.push({
        z,
        x,
        y,
        bounds,
        status: 'generated',
        path: `${fcHour}/${level}/${layerType}/${z}/${x}/${y}.svg`
      })
    }
  }
  return tiles
}

// 多图首屏使用稳定的 SVG 输出契约直接构造当前图层记录，不依赖大体积 Manifest。
// Manifest 到达后仍作为权威索引，用于可用性校验、时效过滤和相邻页预加载。
export function directSvgLayerRecord(fcHour, level, layerType) {
  const normalizedHour = String(fcHour).padStart(3, '0')
  const normalizedLevel = String(level)
  const levels = MULTI_Z_LAYER_TYPES.has(layerType) ? TILE_LEVELS : [0]
  return {
    fc_hour: normalizedHour,
    level: normalizedLevel,
    layer_type: layerType,
    bounds: { ...DEFAULT_MAP_BOUNDS },
    status: 'generated',
    tiles: Object.fromEntries(levels.map((z) => [
      String(z),
      directTiles(normalizedHour, normalizedLevel, layerType, z)
    ]))
  }
}

export function isDirectMultiZoomLayer(layerType) {
  return MULTI_Z_LAYER_TYPES.has(layerType)
}
