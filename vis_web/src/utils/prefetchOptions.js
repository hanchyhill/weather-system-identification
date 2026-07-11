// 预取策略的本地存储（localStorage），供订阅弹窗读写、main.js catch-up 与 SW push 使用。
// 语义：
//   zLevels    要预取的瓦片层次，默认 [0, 1]（z2 数量大，默认不取）
//   layerTypes 要预取的要素图层类型；空数组表示不过滤（全部要素）
//   levels     要预取的气压层（含 'surface'）；空数组表示不过滤（全部层次）

const STORAGE_KEY = 'weather-prefetch-options'

export const DEFAULT_PREFETCH_OPTIONS = {
  zLevels: [0, 1],
  layerTypes: [],
  levels: []
}

export function loadPrefetchOptions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFETCH_OPTIONS }
    const parsed = JSON.parse(raw)
    return {
      zLevels:
        Array.isArray(parsed.zLevels) && parsed.zLevels.length
          ? parsed.zLevels.map(Number).filter((z) => z === 0 || z === 1 || z === 2)
          : [...DEFAULT_PREFETCH_OPTIONS.zLevels],
      layerTypes: Array.isArray(parsed.layerTypes) ? parsed.layerTypes.map(String) : [],
      levels: Array.isArray(parsed.levels) ? parsed.levels.map(String) : []
    }
  } catch {
    return { ...DEFAULT_PREFETCH_OPTIONS }
  }
}

export function savePrefetchOptions(options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options || {}))
  } catch {
    // 忽略存储失败（隐私模式等）
  }
}
