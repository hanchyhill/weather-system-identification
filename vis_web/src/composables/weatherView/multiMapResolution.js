import {
  MULTI_MAP_REFERENCE_SIZE,
  MULTI_MAP_RENDER_SCALES,
  RENDER_SCALE_MAX
} from './constants.js'

function positiveDimension(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

// 用面积的平方根表示子图相对单图的“线性尺寸”。相比只看宽或高，这能适应横长、
// 竖长以及移动端单列布局，同时让像素预算跟实际 canvas 面积一致。
export function multiMapSizeFactor(size = {}) {
  const width = positiveDimension(size.width)
  const height = positiveDimension(size.height)
  if (!width || !height) return 1
  return Math.sqrt(
    (width * height) / (MULTI_MAP_REFERENCE_SIZE.width * MULTI_MAP_REFERENCE_SIZE.height)
  )
}

function quantizeUp(value, steps) {
  return steps.find((step) => value <= step) ?? steps[steps.length - 1]
}

// 多图 canvas 的 backing store 像素比：小面板从 1× 起步，面板越接近单图面积，
// 越接近设备原生 DPR。按 0.25 分档，避免拖动窗口时反复重分配画布内存。
export function canvasPixelRatioForSize(size, compact = false, devicePixelRatio = 1) {
  const dpr = Math.max(1, positiveDimension(devicePixelRatio) || 1)
  if (!compact) return dpr
  const target = Math.max(1, Math.min(dpr, dpr * multiMapSizeFactor(size)))
  return Math.min(dpr, Math.ceil(target * 4) / 4)
}

// 单图延续原来的 1×/2×策略。多图则进一步乘以实际 canvas 的线性尺寸比例并分档：
// 典型四宫格在普通缩放下只解码 0.5× SVG，高倍缩放或大面板才逐步升到 1×/2×。
export function renderScaleForZoom(k, compact = false, canvasSize = null) {
  const zoomScale = k > 8 ? RENDER_SCALE_MAX : 1
  if (!compact) return zoomScale
  return quantizeUp(zoomScale * multiMapSizeFactor(canvasSize), MULTI_MAP_RENDER_SCALES)
}
