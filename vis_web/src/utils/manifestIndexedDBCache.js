export const MANIFEST_CACHE_DB_NAME = 'WeatherSystemManifestCache'
export const MANIFEST_CACHE_DB_VERSION = 1
export const MANIFEST_CACHE_STORE = 'manifests'
export const MANIFEST_CACHE_TTL_MS = 10 * 60 * 1000

let dbPromise = null

function requestResult(request, fallback = null) {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? fallback)
    request.onerror = () => resolve(fallback)
  })
}

export function openManifestCacheDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(MANIFEST_CACHE_DB_NAME, MANIFEST_CACHE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MANIFEST_CACHE_STORE)) {
        const store = db.createObjectStore(MANIFEST_CACHE_STORE, { keyPath: 'initTime' })
        store.createIndex('expiry', 'expiresAt')
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

export class ManifestIndexedDBCache {
  async get(initTime, now = Date.now()) {
    const db = await openManifestCacheDatabase()
    if (!db) return null
    const key = String(initTime)
    const entry = await requestResult(
      db.transaction(MANIFEST_CACHE_STORE, 'readonly').objectStore(MANIFEST_CACHE_STORE).get(key)
    )
    if (!entry || entry.expiresAt <= now) {
      if (entry) void this.delete(key)
      return null
    }
    return { value: entry.value, expiresAt: entry.expiresAt }
  }

  async put(initTime, value, ttl = MANIFEST_CACHE_TTL_MS, now = Date.now()) {
    const db = await openManifestCacheDatabase()
    if (!db || value == null) return false
    const expiresAt = now + Math.max(0, Number(ttl) || 0)
    try {
      const request = db.transaction(MANIFEST_CACHE_STORE, 'readwrite')
        .objectStore(MANIFEST_CACHE_STORE)
        .put({ initTime: String(initTime), value, cachedAt: now, expiresAt })
      await requestResult(request, false)
      void this.cleanupExpired(now)
      return true
    } catch {
      return false
    }
  }

  async delete(initTime) {
    const db = await openManifestCacheDatabase()
    if (!db) return false
    const request = db.transaction(MANIFEST_CACHE_STORE, 'readwrite')
      .objectStore(MANIFEST_CACHE_STORE)
      .delete(String(initTime))
    await requestResult(request, true)
    return true
  }

  async clear() {
    const db = await openManifestCacheDatabase()
    if (!db) return false
    const request = db.transaction(MANIFEST_CACHE_STORE, 'readwrite')
      .objectStore(MANIFEST_CACHE_STORE)
      .clear()
    await requestResult(request, true)
    return true
  }

  async cleanupExpired(now = Date.now()) {
    const db = await openManifestCacheDatabase()
    if (!db) return 0
    return new Promise((resolve) => {
      let removed = 0
      const tx = db.transaction(MANIFEST_CACHE_STORE, 'readwrite')
      const request = tx.objectStore(MANIFEST_CACHE_STORE)
        .index('expiry')
        .openCursor(IDBKeyRange.upperBound(now))
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
}

export const sharedManifestIndexedDBCache = new ManifestIndexedDBCache()
