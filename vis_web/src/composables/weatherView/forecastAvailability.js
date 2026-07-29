const USABLE_RECORD_STATUSES = new Set(['generated', 'skipped'])

/**
 * 判断 manifest 中的图层记录是否至少包含一份可加载的 SVG 产品。
 * 兼容旧 manifest：没有 status 时按 path/tiles 判断。
 */
export function hasRenderableForecastRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (record.status && !USABLE_RECORD_STATUSES.has(record.status)) return false
  if (record.path) return true

  if (!record.tiles || typeof record.tiles !== 'object') return false
  return Object.values(record.tiles).some((tiles) => (
    Array.isArray(tiles) && tiles.some((tile) => (
      tile?.path && (!tile.status || USABLE_RECORD_STATUSES.has(tile.status))
    ))
  ))
}

/**
 * 返回当前层次、当前图层组合共同拥有产品的预报时效。
 * 返回 null 表示 manifest 尚未提供 products 索引，调用方应使用默认时效。
 */
export function availableForecastHours(manifest, level, layerTypes, candidateHours) {
  const products = manifest?.products
  if (!products || typeof products !== 'object' || !Object.keys(products).length) return null

  const hours = (candidateHours || []).map((value) => String(value).padStart(3, '0'))
  const layers = Array.isArray(layerTypes) ? layerTypes.map(String).filter(Boolean) : []
  if (!layers.length) return hours

  return hours.filter((fcHour) => {
    const levelProducts = products[fcHour]?.[String(level)]
    return layers.every((layerType) => hasRenderableForecastRecord(levelProducts?.[layerType]))
  })
}
