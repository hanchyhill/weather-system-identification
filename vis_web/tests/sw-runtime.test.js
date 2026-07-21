import assert from 'node:assert/strict'
import { extname } from 'node:path'
import { registerHooks } from 'node:module'
import { after, describe, it } from 'node:test'
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) return nextResolve(`${specifier}.js`, context)
    return nextResolve(specifier, context)
  }
})

const originalGlobals = Object.fromEntries(
  ['self', 'caches', 'indexedDB', 'IDBKeyRange', 'navigator', 'fetch', 'Image'].map((key) => [key, globalThis[key]])
)

const listeners = new Map()
const clientMessages = []
const notifications = []
const cacheBuckets = new Map()
const fetchCalls = []
const slowFirstAttempt = new Set()
const abortedUrls = []
let storageLimited = false

function absoluteUrl(input) {
  const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  return new URL(value, 'https://weather.test').href
}

globalThis.self = {
  location: { origin: 'https://weather.test' },
  addEventListener: (type, listener) => listeners.set(type, listener),
  skipWaiting: async () => {},
  clients: {
    claim: async () => {},
    matchAll: async () => [{ postMessage: (message) => clientMessages.push(message), focus: async () => {} }],
    openWindow: async () => {}
  },
  registration: {
    showNotification: async (title, options) => notifications.push({ title, options })
  }
}

globalThis.caches = {
  keys: async () => [...cacheBuckets.keys()],
  delete: async (key) => cacheBuckets.delete(key),
  open: async (name) => {
    if (!cacheBuckets.has(name)) cacheBuckets.set(name, new Map())
    const bucket = cacheBuckets.get(name)
    return {
      match: async (request) => bucket.get(absoluteUrl(request))?.clone(),
      put: async (request, response) => bucket.set(absoluteUrl(request), response.clone())
    }
  }
}

globalThis.indexedDB = indexedDB
globalThis.IDBKeyRange = IDBKeyRange
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { storage: { estimate: async () => (storageLimited ? { usage: 600, quota: 1000 } : { usage: 1, quota: 1000 }) } }
})

function manifestFor(initTime) {
  return {
    version: `v-${initTime}`,
    products: {
      '000': {
        '500': {
          wind: { status: 'generated', path: `000/500/wind-${initTime}.svg` }
        }
      }
    }
  }
}

globalThis.fetch = async (input, options = {}) => {
  const url = absoluteUrl(input)
  fetchCalls.push(url)
  const manifestMatch = url.match(/\/data\/products\/(\d{10})\/manifest\.json$/)
  if (manifestMatch) {
    return new Response(JSON.stringify(manifestFor(manifestMatch[1])), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  if (url.endsWith('/data/user-visible.json')) return new Response('{}', { status: 200 })
  if (slowFirstAttempt.has(url)) {
    slowFirstAttempt.delete(url)
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        abortedUrls.push(url)
        reject(options.signal?.reason || new DOMException('Aborted', 'AbortError'))
      }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  return new Response('<svg width="10" height="10"/>', {
    status: 200,
    headers: { 'content-type': 'image/svg+xml' }
  })
}

await import(`../public/sw.js?runtime-test=${Date.now()}`)

function dispatchExtendable(type, extra = {}) {
  const waits = []
  const event = { ...extra, waitUntil: (promise) => waits.push(Promise.resolve(promise)) }
  listeners.get(type)(event)
  return Promise.all(waits)
}

function dispatchMessage(data) {
  return dispatchExtendable('message', { data })
}

async function readSourcesForInitTime(initTime) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('WeatherSystemVisualization', 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('svg_sources', 'readonly').objectStore('svg_sources').index('initTime').getAll(initTime)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function dispatchFetch(path) {
  const waits = []
  let responsePromise
  const event = {
    request: new Request(new URL(path, 'https://weather.test')),
    respondWith: (promise) => { responsePromise = Promise.resolve(promise) },
    waitUntil: (promise) => waits.push(Promise.resolve(promise))
  }
  listeners.get('fetch')(event)
  const response = await responsePromise
  await Promise.all(waits)
  return response
}

async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('等待 SW 状态超时')
}

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300))
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key]
    else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})

describe('Service Worker 运行时调度', () => {
  it('覆盖复用、换时次取消、前台暂停恢复和 Push 开关', async () => {
    const options = { enabled: true, zLevels: [0], layerTypes: [], levels: [] }

    await dispatchMessage({ type: 'prefetchLatest', initTime: '2026072100', options })
    const firstDownloadCount = fetchCalls.length
    assert.equal(clientMessages.at(-1).state, 'complete')
    assert.equal(clientMessages.at(-1).ready, 1)
    const firstSources = await readSourcesForInitTime('2026072100')
    assert.equal(firstSources.length, clientMessages.at(-1).ready, '状态 ready 应与该任务 IndexedDB 条目一致')

    // 直接走页面实际加载入口：SW 写入后两个倍率都应从同一源 Blob 解码，不再访问网络。
    globalThis.Image = class MockImage {
      async decode() {}
      set src(value) {
        this.currentSrc = value
        queueMicrotask(() => this.onload?.())
      }
    }
    const pageHelpers = await import(`../src/composables/weatherView/helpers.js?sw-hit=${Date.now()}`)
    const pageFetchCount = fetchCalls.length
    const sourceUrl = '/data/products/2026072100/000/500/wind-2026072100.svg'
    const normalImage = await pageHelpers.loadSvgImage(sourceUrl, 1)
    const scaledImage = await pageHelpers.loadSvgImage(sourceUrl, 2)
    assert.ok(normalImage && scaledImage && normalImage !== scaledImage)
    assert.equal(fetchCalls.length, pageFetchCount, '页面命中 SW 写入的源缓存后不得访问网络')

    await dispatchMessage({ type: 'prefetchLatest', initTime: '2026072100', options })
    assert.equal(
      fetchCalls.filter((url) => url === absoluteUrl(sourceUrl)).length,
      1,
      '相同 Manifest 版本的完成任务不应重新遍历或下载 SVG'
    )
    assert.equal(fetchCalls.length, firstDownloadCount + 1, '复用前只允许网络优先校验一次 Manifest 版本')

    const oldUrl = absoluteUrl('/data/products/2026072200/000/500/wind-2026072200.svg')
    slowFirstAttempt.add(oldUrl)
    const oldRun = dispatchMessage({ type: 'prefetchLatest', initTime: '2026072200', options })
    await waitFor(() => fetchCalls.includes(oldUrl))
    await dispatchMessage({ type: 'prefetchLatest', initTime: '2026072212', options })
    await oldRun
    assert.ok(abortedUrls.includes(oldUrl), '新起报任务应中止旧下载')
    assert.equal(clientMessages.at(-1).initTime, '2026072212')
    assert.equal(clientMessages.at(-1).state, 'complete')

    const pausedUrl = absoluteUrl('/data/products/2026072300/000/500/wind-2026072300.svg')
    slowFirstAttempt.add(pausedUrl)
    const pausedRun = dispatchMessage({ type: 'prefetchLatest', initTime: '2026072300', options })
    await waitFor(() => fetchCalls.includes(pausedUrl))
    await dispatchFetch('/data/user-visible.json')
    await pausedRun
    assert.ok(abortedUrls.includes(pausedUrl), '前台 /data/ 请求应立即中止后台下载')
    await dispatchMessage({ type: 'prefetchLatest', initTime: '2026072300', options })
    assert.equal(fetchCalls.filter((url) => url === pausedUrl).length, 1, '2 秒冷却期内的新指令也不得提前恢复下载')
    await waitFor(() => clientMessages.some((message) => message.initTime === '2026072300' && message.state === 'paused'))
    await waitFor(
      () => clientMessages.some((message) => message.initTime === '2026072300' && message.state === 'complete'),
      5000
    )
    assert.ok(fetchCalls.filter((url) => url === pausedUrl).length >= 2, '连续空闲 2 秒后应恢复任务')

    await dispatchMessage({ type: 'setPrefetchOptions', options: { ...options, enabled: false } })
    await dispatchMessage({ type: 'cancelPrefetch' })
    const callsBeforeDisabledPush = fetchCalls.length
    await dispatchExtendable('push', {
      data: { json: () => ({ initTime: '2026072400' }) }
    })
    assert.equal(notifications.length, 1)
    assert.equal(fetchCalls.length, callsBeforeDisabledPush, '关闭开关时 Push 只通知，不下载')

    await dispatchMessage({ type: 'setPrefetchOptions', options })
    const callsBeforeOldPush = fetchCalls.length
    await dispatchExtendable('push', {
      data: { json: () => ({ initTime: '2026072200' }) }
    })
    assert.equal(fetchCalls.length, callsBeforeOldPush, '过期 Push 不应覆盖较新的目标时次')

    await dispatchExtendable('push', {
      data: { json: () => ({ initTime: '2026072400' }) }
    })
    const pushedUrl = absoluteUrl('/data/products/2026072400/000/500/wind-2026072400.svg')
    assert.ok(fetchCalls.includes(pushedUrl), '页面关闭场景下启用的 Push 应下载 SVG')
    assert.equal((await readSourcesForInitTime('2026072400')).length, 1, 'Push 下载应写入共享 IndexedDB')

    storageLimited = true
    await dispatchMessage({ type: 'prefetchLatest', initTime: '2026072500', options })
    await waitFor(() => clientMessages.some((message) => message.initTime === '2026072500' && message.state === 'storage_limited'))
    assert.equal(clientMessages.at(-1).state, 'storage_limited')
    assert.equal(clientMessages.at(-1).reason, 'storage-soft-limit')
    assert.equal((await readSourcesForInitTime('2026072500')).length, 0)
  })
})
