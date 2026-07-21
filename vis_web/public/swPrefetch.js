export const DEFAULT_Z_LEVELS = [0, 1]

export function normalizePrefetchOptions(options = {}) {
  const cleanedZ = Array.isArray(options.zLevels)
    ? options.zLevels.map(Number).filter((z) => z === 0 || z === 1 || z === 2)
    : []
  return {
    enabled: options.enabled !== false,
    zLevels: cleanedZ.length ? [...new Set(cleanedZ)].sort((a, b) => a - b) : [...DEFAULT_Z_LEVELS],
    layerTypes: Array.isArray(options.layerTypes) ? [...new Set(options.layerTypes.map(String))].sort() : [],
    levels: Array.isArray(options.levels) ? [...new Set(options.levels.map(String))].sort() : [],
    fcHours: Array.isArray(options.fcHours) ? [...new Set(options.fcHours.map(String))].sort() : []
  }
}

export function latestInitTime(initTimes) {
  return (Array.isArray(initTimes) ? initTimes : [])
    .map(String)
    .filter((value) => /^\d{10}$/.test(value))
    .sort()
    .at(-1) || null
}

function selectedSet(values) {
  return values.length ? new Set(values) : null
}

export function collectSvgUrls(initTime, manifest, options = {}) {
  const normalized = normalizePrefetchOptions(options)
  const zSet = new Set(normalized.zLevels.map(String))
  const fcSet = selectedSet(normalized.fcHours)
  const levelSet = selectedSet(normalized.levels)
  const layerSet = selectedSet(normalized.layerTypes)
  const urls = new Set()
  const products = manifest?.products
  if (!products || typeof products !== 'object') return []

  for (const [fcHour, byLevel] of Object.entries(products)) {
    if (fcSet && !fcSet.has(String(fcHour))) continue
    if (!byLevel || typeof byLevel !== 'object') continue
    for (const [level, byLayer] of Object.entries(byLevel)) {
      if (levelSet && !levelSet.has(String(level))) continue
      if (!byLayer || typeof byLayer !== 'object') continue
      for (const [layerType, record] of Object.entries(byLayer)) {
        if (layerSet && !layerSet.has(String(layerType))) continue
        if (!record || record.status === 'failed') continue

        // 非瓦片图层使用 record.path；它不受 z 过滤影响。
        if (record.path && (!record.tiles || typeof record.tiles !== 'object')) {
          urls.add(`/data/products/${initTime}/${record.path}`)
        }

        if (!record.tiles || typeof record.tiles !== 'object') continue
        for (const [z, tiles] of Object.entries(record.tiles)) {
          if (!zSet.has(String(z)) || !Array.isArray(tiles)) continue
          for (const tile of tiles) {
            if (!tile || tile.status === 'failed') continue
            const path = tile.path || `${fcHour}/${level}/${layerType}/${z}/${tile.x}/${tile.y}.svg`
            if (path) urls.add(`/data/products/${initTime}/${path}`)
          }
        }
      }
    }
  }
  return [...urls]
}

export function optionsFingerprint(options = {}) {
  return JSON.stringify(normalizePrefetchOptions(options))
}

export function manifestVersion(manifest) {
  return String(manifest?.version ?? manifest?.updated_at ?? manifest?.generated_at ?? '')
}

export function shouldReuseCompletedTask(meta, initTime, fingerprint, currentManifestVersion) {
  return Boolean(
    meta?.state === 'complete' &&
    meta.initTime === initTime &&
    meta.optionsFingerprint === fingerprint &&
    meta.manifestVersion === String(currentManifestVersion ?? '')
  )
}

export function shouldAcceptPush(currentInitTime, pushedInitTime) {
  return Boolean(pushedInitTime && (!currentInitTime || String(pushedInitTime) >= String(currentInitTime)))
}
