/* 天气瓦片 Service Worker
 *
 * 职责三件事：
 * 1. 拦截 /data/products 下的 .svg 瓦片与 manifest.json，用 Cache Storage 做持久缓存，
 *    让主线程的 new Image().src / fetch 命中缓存时瞬时返回，把网络层从渲染路径上抹掉。
 * 2. 接受页面下发的 prefetch 指令，按 z0→z1→z2 分级预取指定起报时次的全部瓦片，
 *    受存储配额软上限约束、可被新指令随时中断。
 * 3. 接受 Web Push（Stage 2）：后端在新起报时次生成完成时推一条消息，
 *    唤醒本 SW 弹通知并后台预取该起报——即便页面已关闭。
 *
 * 缓存策略取舍：
 *   - 瓦片 (.svg)：cache-first。同一起报时次下某瓦片路径基本不可变，命中即返回不再打网络，
 *     这样才有性能收益；刷新由 prefetch/push 显式重取覆盖。
 *   - manifest.json：network-first。随新时效不断追加记录，需要新鲜度，网络失败再回落缓存。
 */

const CACHE_VERSION = 'v1'
const TILE_CACHE = `weather-tiles-${CACHE_VERSION}`
const DATA_PREFIX = '/data/products/'

const SVG_RE = /\/data\/products\/.+\.svg$/
const MANIFEST_RE = /\/data\/products\/[^/]+\/manifest\.json$/

// 预取并发（后台预取，别和当前视图抢太多带宽）
const PREFETCH_CONCURRENCY = 6
// 存储软上限：占用超过配额的该比例就停止继续预取，避免把用户磁盘塞满
const STORAGE_SOFT_LIMIT_RATIO = 0.6

// 当前预取运行的中断令牌；收到新的 prefetch / cancelPrefetch 指令时把旧的置为 aborted
let prefetchToken = null

self.addEventListener('install', () => {
  // 新 SW 立即进入 activate，不等旧标签页全部关闭
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清掉旧版本缓存
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((k) => k.startsWith('weather-tiles-') && k !== TILE_CACHE)
        .map((k) => caches.delete(k))
    )
    // 首次注册后立即接管当前页面，使 controllerchange 触发页面的首轮预取
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  if (SVG_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req))
  } else if (MANIFEST_RE.test(url.pathname)) {
    event.respondWith(networkFirst(req))
  }
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'prefetch') {
    startPrefetch(Array.isArray(data.initTimes) ? data.initTimes : [], data.options || {})
  } else if (data.type === 'cancelPrefetch') {
    if (prefetchToken) prefetchToken.aborted = true
  }
})

// —— Web Push（Stage 2 启用；此处已就绪，未订阅时不会触发）——
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }
  const initTime = payload.init_time || payload.initTime || null
  event.waitUntil((async () => {
    // Chrome 强制 userVisibleOnly：每条 push 必须弹一条可见通知，否则会被惩罚/吊销订阅。
    // 后端只在“新起报时次”推一次，因此通知频率约为每个 00/12 UTC 起报一次。
    await self.registration.showNotification('天气数据已更新', {
      body: initTime ? `新起报时次 ${initTime} 已就绪，正在后台预加载` : '最新预报已生成',
      tag: 'weather-update',
      renotify: true,
      data: { initTime }
    })
    if (initTime) {
      await startPrefetch([initTime], payload.options || {})
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (clientList.length) {
      await clientList[0].focus()
    } else {
      await self.clients.openWindow('/')
    }
  })())
})

// —— 缓存策略 ——

async function cacheFirst(req) {
  const cache = await caches.open(TILE_CACHE)
  const cached = await cache.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch (error) {
    // 网络失败且未缓存：交还一个失败响应，让主线程按原有逻辑处理
    return cached || Response.error()
  }
}

async function networkFirst(req) {
  const cache = await caches.open(TILE_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch (error) {
    const cached = await cache.match(req)
    if (cached) return cached
    return Response.error()
  }
}

// —— 分级预取 ——

async function startPrefetch(initTimes, options) {
  if (prefetchToken) prefetchToken.aborted = true
  const token = { aborted: false }
  prefetchToken = token
  try {
    await runPrefetch(initTimes, options, token)
  } catch (error) {
    // 预取是尽力而为，失败不影响主流程
  }
}

async function runPrefetch(initTimes, options, token) {
  if (!initTimes.length) return
  const cache = await caches.open(TILE_CACHE)

  // 先把每个起报的 manifest 拉到（network-first，顺带更新缓存）
  const manifests = []
  for (const init of initTimes) {
    if (token.aborted) return
    const manifest = await fetchManifest(cache, init)
    if (manifest) manifests.push({ init, manifest })
  }
  if (!manifests.length) return

  // z0 张数少、覆盖广，先灌满；再 z1、z2。单 z 图层只有 z0，多 z 图层才有 z1/z2。
  for (const z of [0, 1, 2]) {
    if (token.aborted) return
    if (await overStorageBudget()) return
    const urls = []
    for (const { init, manifest } of manifests) {
      collectTileUrls(init, manifest, z, options, urls)
    }
    if (urls.length) await prefetchUrls(cache, urls, token)
  }
}

function toSet(list) {
  return Array.isArray(list) && list.length ? new Set(list.map(String)) : null
}

// 遍历 manifest.products[fc][level][layer].tiles[z]，按可选过滤器拼出瓦片 URL。
// options 为空表示不过滤（尽量多预取，符合“预加载更多数据”的诉求）。
function collectTileUrls(init, manifest, z, options, out) {
  const products = manifest && manifest.products
  if (!products) return

  const zKey = String(z)
  const fcFilter = toSet(options.fcHours)
  const levelFilter = toSet(options.levels)
  const layerFilter = toSet(options.layerTypes)

  for (const fcHour of Object.keys(products)) {
    if (fcFilter && !fcFilter.has(String(fcHour))) continue
    const byLevel = products[fcHour]
    if (!byLevel || typeof byLevel !== 'object') continue

    for (const level of Object.keys(byLevel)) {
      if (levelFilter && !levelFilter.has(String(level))) continue
      const byLayer = byLevel[level]
      if (!byLayer || typeof byLayer !== 'object') continue

      for (const layerType of Object.keys(byLayer)) {
        if (layerFilter && !layerFilter.has(String(layerType))) continue
        const record = byLayer[layerType]
        if (!record || record.status === 'failed') continue
        const tiles = record.tiles && record.tiles[zKey]
        if (!Array.isArray(tiles)) continue

        for (const tile of tiles) {
          if (!tile || tile.status === 'failed') continue
          const url = tile.path
            ? `${DATA_PREFIX}${init}/${tile.path}`
            : `${DATA_PREFIX}${init}/${fcHour}/${level}/${layerType}/${z}/${tile.x}/${tile.y}.svg`
          out.push(url)
        }
      }
    }
  }
}

async function prefetchUrls(cache, urls, token) {
  let index = 0
  async function worker() {
    while (index < urls.length && !token.aborted) {
      const url = urls[index++]
      const existing = await cache.match(url)
      if (existing) continue
      try {
        const res = await fetch(url, { credentials: 'same-origin' })
        if (res && res.ok) await cache.put(url, res.clone())
      } catch {
        // 单张失败忽略
      }
    }
  }
  const workers = []
  for (let w = 0; w < PREFETCH_CONCURRENCY; w++) workers.push(worker())
  await Promise.all(workers)
}

async function fetchManifest(cache, init) {
  const url = `${DATA_PREFIX}${init}/manifest.json`
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' })
    if (res && res.ok) {
      cache.put(url, res.clone())
      return await res.json()
    }
  } catch {
    // 落到缓存兜底
  }
  const cached = await cache.match(url)
  if (cached) {
    try {
      return await cached.json()
    } catch {
      return null
    }
  }
  return null
}

async function overStorageBudget() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      if (quota && usage / quota > STORAGE_SOFT_LIMIT_RATIO) return true
    }
  } catch {
    // 估算不可用时不做限制
  }
  return false
}
