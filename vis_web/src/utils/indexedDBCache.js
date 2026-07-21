export const DB_NAME = 'WeatherSystemVisualization'
export const DB_VERSION = 2
export const SVG_SOURCE_STORE = 'svg_sources'
export const PREFETCH_META_STORE = 'prefetch_meta'
export const EXPIRY_MS = 72 * 60 * 60 * 1000
const MEMORY_LIMIT = 600
const LEGACY_IMAGE_STORE = 'svg_images'

let dbPromise = null

export function openWeatherDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      // v1 保存的是按倍率栅格化后的 PNG，可再生成且不能供 SW 复用，直接删除。
      if (db.objectStoreNames.contains(LEGACY_IMAGE_STORE)) db.deleteObjectStore(LEGACY_IMAGE_STORE)
      if (!db.objectStoreNames.contains(SVG_SOURCE_STORE)) {
        const store = db.createObjectStore(SVG_SOURCE_STORE, { keyPath: 'url' })
        store.createIndex('expiry', 'expiry')
        store.createIndex('initTime', 'initTime')
      }
      if (!db.objectStoreNames.contains(PREFETCH_META_STORE)) {
        db.createObjectStore(PREFETCH_META_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      resolve(null)
    }
  })
  return dbPromise
}

function requestResult(request, fallback = null) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? fallback)
    request.onerror = () => resolve(fallback)
  })
}

function initTimeFromUrl(url) {
  return String(url).match(/\/data\/products\/(\d{10})\//)?.[1] || ''
}

export class SvgImageCache {
  constructor() {
    this.memory = new Map()
    this.stats = { hits: 0, misses: 0, errors: 0 }
  }

  decodedKey(url, scale = 1) {
    const numericScale = Number(scale)
    const normalizedScale = Number.isFinite(numericScale) && numericScale > 0 ? numericScale : 1
    return `${url}@${normalizedScale}x`
  }

  touchMemory(key, image) {
    if (this.memory.has(key)) this.memory.delete(key)
    this.memory.set(key, image)
    while (this.memory.size > MEMORY_LIMIT) this.memory.delete(this.memory.keys().next().value)
  }

  getDecoded(url, scale = 1) {
    const key = this.decodedKey(url, scale)
    const image = this.memory.get(key) || null
    if (image) {
      this.touchMemory(key, image)
      this.stats.hits += 1
    }
    return image
  }

  setDecoded(url, scale, image) {
    this.touchMemory(this.decodedKey(url, scale), image)
  }

  async getSource(url) {
    const db = await openWeatherDatabase()
    if (!db) {
      this.stats.misses += 1
      return null
    }
    const item = await requestResult(db.transaction(SVG_SOURCE_STORE, 'readonly').objectStore(SVG_SOURCE_STORE).get(url))
    if (!item || item.expiry <= Date.now()) {
      this.stats.misses += 1
      if (item) this.deleteSource(url)
      return null
    }
    this.stats.hits += 1
    return item.blob
  }

  async has(url) {
    const db = await openWeatherDatabase()
    if (!db) return false
    const item = await requestResult(db.transaction(SVG_SOURCE_STORE, 'readonly').objectStore(SVG_SOURCE_STORE).get(url))
    return Boolean(item && item.expiry > Date.now())
  }

  async putSource(url, blob, contentType = 'image/svg+xml', initTime = initTimeFromUrl(url)) {
    if (!(blob instanceof Blob)) return false
    const db = await openWeatherDatabase()
    if (!db) return false
    const now = Date.now()
    const request = db.transaction(SVG_SOURCE_STORE, 'readwrite').objectStore(SVG_SOURCE_STORE).put({
      url,
      blob,
      contentType: contentType || blob.type || 'image/svg+xml',
      initTime,
      cachedAt: now,
      expiry: now + EXPIRY_MS
    })
    return Boolean(await requestResult(request, false) !== false)
  }

  async deleteSource(url) {
    const db = await openWeatherDatabase()
    if (!db) return false
    const request = db.transaction(SVG_SOURCE_STORE, 'readwrite').objectStore(SVG_SOURCE_STORE).delete(url)
    await requestResult(request, true)
    return true
  }

  async cleanupExpired(now = Date.now()) {
    const db = await openWeatherDatabase()
    if (!db) return 0
    return new Promise((resolve) => {
      let removed = 0
      const tx = db.transaction(SVG_SOURCE_STORE, 'readwrite')
      const request = tx.objectStore(SVG_SOURCE_STORE).index('expiry').openCursor(IDBKeyRange.upperBound(now))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        cursor.delete()
        removed += 1
        cursor.continue()
      }
      tx.oncomplete = () => resolve(removed)
      tx.onerror = () => resolve(removed)
    })
  }

  getStats() {
    return { ...this.stats, memorySize: this.memory.size }
  }
}

export const sharedSvgImageCache = new SvgImageCache()
