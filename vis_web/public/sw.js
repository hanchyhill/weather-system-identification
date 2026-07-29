import {
  collectSvgUrls,
  latestInitTime,
  manifestVersion,
  normalizePrefetchOptions,
  optionsFingerprint,
  shouldAcceptPush,
  shouldReuseCompletedTask
} from './swPrefetch.js'

const DB_NAME = 'WeatherSystemVisualization'
const DB_VERSION = 2
const SVG_STORE = 'svg_sources'
const META_STORE = 'prefetch_meta'
const LEGACY_STORE = 'svg_images'
const EXPIRY_MS = 72 * 60 * 60 * 1000
const MANIFEST_CACHE = 'weather-manifests-v2'
const DATA_PREFIX = '/data/'
const PRODUCT_PREFIX = '/data/products/'
const MANIFEST_RE = /\/data\/products\/[^/]+\/manifest\.json$/
const PREFETCH_CONCURRENCY = 2
const STORAGE_SOFT_LIMIT_RATIO = 0.6
const FOREGROUND_IDLE_MS = 2000

let currentTask = null
let foregroundRequests = 0
let foregroundIdleUntil = 0
let resumeTimer = null
let broadcastTimer = null
let lastBroadcast = 0
let downloadDebugEnabled = false
let status = {
  state: 'idle', initTime: '', ready: 0, total: 0, downloaded: 0, failed: 0, reason: ''
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('weather-tiles-')).map((key) => caches.delete(key)))
    await cleanupExpiredSources()
    status = (await readMeta('status')) || status
    await self.clients.claim()
    await broadcastStatus(true)
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(DATA_PREFIX)) return
  foregroundStarted()
  const responsePromise = MANIFEST_RE.test(url.pathname) ? networkFirstManifest(request) : fetch(request)
  event.respondWith(responsePromise)
  // 克隆流读完才算请求结束，空闲窗口不会从“刚收到响应头”过早开始。
  event.waitUntil(responsePromise
    .then((response) => response.clone().arrayBuffer())
    .catch(() => {})
    .finally(foregroundFinished))
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'prefetchLatest') {
    event.waitUntil(startPrefetch(data.initTime, data.options || {}))
  } else if (data.type === 'prefetch') {
    // 兼容旧页面，但只处理其中最新的起报时次。
    event.waitUntil(startPrefetch(latestInitTime(data.initTimes), data.options || {}))
  } else if (data.type === 'cancelPrefetch') {
    event.waitUntil(cancelPrefetch('disabled'))
  } else if (data.type === 'setPrefetchOptions') {
    event.waitUntil(saveOptions(data.options || {}))
  } else if (data.type === 'getPrefetchStatus') {
    event.waitUntil((async () => {
      status = (await readMeta('status')) || status
      await broadcastStatus(true)
    })())
  } else if (data.type === 'setDownloadDebug') {
    downloadDebugEnabled = Boolean(data.enabled)
  }
})

async function broadcastDownloadDebug(record) {
  if (!downloadDebugEnabled) return
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) client.postMessage({ type: 'downloadDebug', record: { at: new Date().toISOString(), ...record } })
}

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = {} }
  const initTime = payload.init_time || payload.initTime || ''
  event.waitUntil((async () => {
    const storedOptions = await loadOptions()
    const pushedOptions = payload.options && typeof payload.options === 'object' ? payload.options : {}
    // enabled 以本机持久化总开关为准；服务端旧 payload 缺少该字段时不能意外重新开启。
    const options = normalizePrefetchOptions({ ...storedOptions, ...pushedOptions, enabled: storedOptions.enabled !== false })
    await self.registration.showNotification('天气数据已更新', {
      body: initTime
        ? `新起报时次 ${initTime} 已就绪${options.enabled ? '，正在后台预加载' : ''}`
        : '最新预报已生成',
      tag: 'weather-update', renotify: true, data: { initTime }
    })
    // 过期 Push 不能把一个更新任务替换成旧任务；关闭预加载时只发通知。
    const persisted = (await readMeta('status')) || status
    if (options.enabled && shouldAcceptPush(persisted.initTime, initTime)) {
      await startPrefetch(initTime, options)
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.length) await windows[0].focus()
    else await self.clients.openWindow('/')
  })())
})

function foregroundStarted() {
  foregroundRequests += 1
  foregroundIdleUntil = Number.POSITIVE_INFINITY
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = null
  if (currentTask && !currentTask.controller.signal.aborted) currentTask.controller.abort()
  if (currentTask) setStatus({ state: 'paused', reason: 'foreground-request' })
}

function foregroundFinished() {
  foregroundRequests = Math.max(0, foregroundRequests - 1)
  if (foregroundRequests) return
  foregroundIdleUntil = Date.now() + FOREGROUND_IDLE_MS
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => {
    resumeTimer = null
    foregroundIdleUntil = 0
    if (currentTask && status.state === 'paused') startPrefetch(currentTask.initTime, currentTask.options, true)
  }, FOREGROUND_IDLE_MS)
}

async function cancelPrefetch(nextState = 'idle') {
  if (currentTask) currentTask.controller.abort()
  currentTask = null
  await setStatus({
    state: nextState,
    // 保留最近目标时次，用于拒绝迟到的旧 Push；计数则不再显示为当前活动任务。
    initTime: status.initTime || '', ready: 0, total: 0, downloaded: 0, failed: 0,
    optionsFingerprint: '', manifestVersion: '',
    reason: nextState === 'disabled' ? 'disabled' : ''
  })
}

async function startPrefetch(initTime, rawOptions, resume = false) {
  const options = normalizePrefetchOptions(rawOptions)
  await saveOptions(options)
  if (!options.enabled) return cancelPrefetch('disabled')
  if (!initTime || !/^\d{10}$/.test(String(initTime))) return

  const fingerprint = optionsFingerprint(options)
  if (
    !resume && currentTask && !currentTask.controller.signal.aborted &&
    currentTask.initTime === String(initTime) && currentTask.fingerprint === fingerprint
  ) {
    await broadcastStatus(true)
    return
  }
  const previous = (await readMeta('status')) || status

  if (currentTask) currentTask.controller.abort()
  const task = { initTime: String(initTime), options, fingerprint, controller: new AbortController() }
  currentTask = task
  if (foregroundRequests || Date.now() < foregroundIdleUntil) {
    await setStatus({ ...baseTaskStatus(task), state: 'paused', reason: 'foreground-request' })
    return
  }

  try {
    await cleanupExpiredSources()
    await setStatus({ ...baseTaskStatus(task), state: 'manifest' })
    const manifest = await fetchManifest(task.initTime, task.controller.signal)
    if (!manifest) throw new Error('manifest-unavailable')
    if (task.controller.signal.aborted || currentTask !== task) return
    const currentManifestVersion = manifestVersion(manifest)
    if (!resume && shouldReuseCompletedTask(previous, task.initTime, fingerprint, currentManifestVersion)) {
      currentTask = null
      await setStatus(previous, true)
      return
    }

    const urls = collectSvgUrls(task.initTime, manifest, options)
    const taskStatus = {
      ...baseTaskStatus(task),
      state: 'prefetching',
      manifestVersion: currentManifestVersion,
      total: urls.length
    }
    let ready = 0
    const missing = []
    for (const url of urls) {
      if (await hasFreshSource(url)) ready += 1
      else missing.push(url)
    }
    taskStatus.ready = ready
    await setStatus(taskStatus)

    let index = 0
    async function worker() {
      while (index < missing.length && !task.controller.signal.aborted) {
        if (await overStorageBudget()) {
          task.controller.abort()
          await setStatus({ state: 'storage_limited', reason: 'storage-soft-limit' })
          return
        }
        const url = missing[index++]
        const startedAt = performance.now()
        try {
          const response = await fetch(url, { credentials: 'same-origin', signal: task.controller.signal })
          await broadcastDownloadDebug({ kind: 'svg', phase: 'prefetch-response-headers', url, status: response.status, timingMs: { total: performance.now() - startedAt } })
          if (!response.ok) throw new Error(String(response.status))
          const blob = await response.blob()
          await putSource(url, blob, response.headers.get('content-type'), task.initTime)
          await broadcastDownloadDebug({ kind: 'svg', phase: 'prefetch-stored', url, bytes: blob.size, timingMs: { total: performance.now() - startedAt } })
          taskStatus.ready += 1
          taskStatus.downloaded += 1
        } catch (error) {
          if (task.controller.signal.aborted) return
          await broadcastDownloadDebug({ kind: 'svg', phase: 'prefetch-error', url, error: error?.message || String(error), timingMs: { total: performance.now() - startedAt } })
          taskStatus.failed += 1
        }
        if (task.controller.signal.aborted || currentTask !== task) return
        await setStatus(taskStatus)
      }
    }
    await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, () => worker()))
    if (!task.controller.signal.aborted && currentTask === task) {
      await setStatus({ ...taskStatus, state: 'complete', reason: '' }, true)
      currentTask = null
    }
  } catch (error) {
    if (!task.controller.signal.aborted && currentTask === task) {
      await setStatus({ ...baseTaskStatus(task), state: 'error', reason: error?.message || 'unknown' }, true)
      currentTask = null
    }
  }
}

function baseTaskStatus(task) {
  return {
    initTime: task.initTime,
    optionsFingerprint: task.fingerprint,
    manifestVersion: '', ready: 0, total: 0, downloaded: 0, failed: 0, reason: ''
  }
}

async function setStatus(changes, immediate = false) {
  status = { ...status, ...changes }
  await writeMeta({ key: 'status', ...status })
  await broadcastStatus(immediate)
}

async function broadcastStatus(immediate = false) {
  const elapsed = Date.now() - lastBroadcast
  if (!immediate && elapsed < 150) {
    if (!broadcastTimer) broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      broadcastStatus(true)
    }, 150 - elapsed)
    return
  }
  lastBroadcast = Date.now()
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const payload = {
    type: 'prefetchStatus', state: status.state, initTime: status.initTime || '',
    ready: status.ready || 0, total: status.total || 0, downloaded: status.downloaded || 0,
    failed: status.failed || 0, reason: status.reason || ''
  }
  for (const client of windows) client.postMessage(payload)
}

async function networkFirstManifest(request) {
  const cache = await caches.open(MANIFEST_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
      return response
    }
    return await cache.match(request) || response
  } catch {
    return await cache.match(request) || Response.error()
  }
}

async function fetchManifest(initTime, signal) {
  const request = new Request(new URL(`${PRODUCT_PREFIX}${initTime}/manifest.json`, self.location.origin), { credentials: 'same-origin' })
  const cache = await caches.open(MANIFEST_CACHE)
  try {
    const response = await fetch(request, { cache: 'no-cache', signal })
    if (response.ok) {
      await cache.put(request, response.clone())
      return await response.json()
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  const cached = await cache.match(request)
  return cached ? await cached.json() : null
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(LEGACY_STORE)) db.deleteObjectStore(LEGACY_STORE)
      if (!db.objectStoreNames.contains(SVG_STORE)) {
        const store = db.createObjectStore(SVG_STORE, { keyPath: 'url' })
        store.createIndex('expiry', 'expiry')
        store.createIndex('initTime', 'initTime')
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readMeta(key) {
  try {
    const db = await openDatabase()
    return await idbRequest(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key))
  } catch { return null }
}

async function writeMeta(value) {
  try {
    const db = await openDatabase()
    await idbRequest(db.transaction(META_STORE, 'readwrite').objectStore(META_STORE).put(value))
  } catch { /* 缓存元数据写入失败不影响页面 */ }
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveOptions(options) {
  await writeMeta({ key: 'options', ...normalizePrefetchOptions(options) })
}

async function loadOptions() {
  return (await readMeta('options')) || {}
}

async function hasFreshSource(url) {
  try {
    const db = await openDatabase()
    const item = await idbRequest(db.transaction(SVG_STORE, 'readonly').objectStore(SVG_STORE).get(url))
    return Boolean(item && item.expiry > Date.now())
  } catch { return false }
}

async function putSource(url, blob, contentType, initTime) {
  const db = await openDatabase()
  const now = Date.now()
  await idbRequest(db.transaction(SVG_STORE, 'readwrite').objectStore(SVG_STORE).put({
    url, blob, contentType: contentType || blob.type || 'image/svg+xml', initTime,
    cachedAt: now, expiry: now + EXPIRY_MS
  }))
}

async function cleanupExpiredSources() {
  try {
    const db = await openDatabase()
    await new Promise((resolve) => {
      const tx = db.transaction(SVG_STORE, 'readwrite')
      const request = tx.objectStore(SVG_STORE).index('expiry').openCursor(IDBKeyRange.upperBound(Date.now()))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch { /* 尽力清理 */ }
}

async function overStorageBudget() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return Boolean(quota && usage / quota >= STORAGE_SOFT_LIMIT_RATIO)
  } catch { return false }
}
