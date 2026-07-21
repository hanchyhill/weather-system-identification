import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { indexedDB, IDBKeyRange } from 'fake-indexeddb'

import {
  collectSvgUrls,
  latestInitTime,
  normalizePrefetchOptions,
  optionsFingerprint,
  shouldAcceptPush,
  shouldReuseCompletedTask
} from '../public/swPrefetch.js'

describe('预加载设置与 Manifest URL 收集', () => {
  it('迁移旧设置时默认开启，并允许显式禁用', async () => {
    const values = new Map()
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
    const module = await import(`../src/utils/prefetchOptions.js?test=${Date.now()}`)

    values.set('weather-prefetch-options', JSON.stringify({ zLevels: [2], layerTypes: ['wind'], levels: [] }))
    assert.equal(module.loadPrefetchOptions().enabled, true)
    module.savePrefetchOptions({ enabled: false, zLevels: [0], layerTypes: [], levels: [] })
    assert.equal(module.loadPrefetchOptions().enabled, false)
  })

  it('旧 prefetch 消息只选择最新合法时次', () => {
    assert.equal(latestInitTime(['2026072000', 'bad', '2026072112', '2026072100']), '2026072112')
  })

  it('收集单 SVG 与分片瓦片，应用过滤、去重并跳过失败记录', () => {
    const manifest = {
      products: {
        '000': {
          '500': {
            contour: { status: 'generated', path: '000/500/contour.svg' },
            wind: {
              status: 'generated',
              tiles: {
                0: [
                  { path: '000/500/wind/0/0/0.svg' },
                  { path: '000/500/wind/0/0/0.svg' },
                  { path: 'bad.svg', status: 'failed' }
                ],
                2: [{ path: '000/500/wind/2/0/0.svg' }]
              }
            },
            failed: { status: 'failed', path: 'should-not-load.svg' }
          },
          '850': { wind: { status: 'generated', path: 'filtered-level.svg' } }
        }
      }
    }
    const urls = collectSvgUrls('2026072112', manifest, {
      enabled: true, zLevels: [0], levels: ['500'], layerTypes: ['contour', 'wind']
    })
    assert.deepEqual(urls, [
      '/data/products/2026072112/000/500/contour.svg',
      '/data/products/2026072112/000/500/wind/0/0/0.svg'
    ])
  })

  it('规范化选项并识别可复用任务与过期 Push', () => {
    const options = normalizePrefetchOptions({ zLevels: [2, 0, 2], layerTypes: ['b', 'a', 'a'] })
    assert.deepEqual(options.zLevels, [0, 2])
    assert.deepEqual(options.layerTypes, ['a', 'b'])
    const fingerprint = optionsFingerprint(options)
    const complete = { state: 'complete', initTime: '2026072112', optionsFingerprint: fingerprint, manifestVersion: 'v1' }
    assert.equal(shouldReuseCompletedTask(complete, '2026072112', fingerprint, 'v1'), true)
    assert.equal(shouldReuseCompletedTask(complete, '2026072112', fingerprint, 'v2'), false)
    assert.equal(shouldReuseCompletedTask({ ...complete, state: 'prefetching' }, '2026072112', fingerprint, 'v1'), false)
    assert.equal(shouldAcceptPush('2026072112', '2026072100'), false)
    assert.equal(shouldAcceptPush('2026072112', '2026072200'), true)
  })
})

describe('IndexedDB v2 原始 SVG 缓存', () => {
  it('删除 v1 PNG store，复用一份 SVG 源并清理过期条目', async () => {
    globalThis.indexedDB = indexedDB
    globalThis.IDBKeyRange = IDBKeyRange

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('WeatherSystemVisualization', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('svg_images', { keyPath: 'key' })
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })

    const module = await import(`../src/utils/indexedDBCache.js?test=${Date.now()}`)
    const db = await module.openWeatherDatabase()
    assert.equal(db.version, 2)
    assert.equal(db.objectStoreNames.contains('svg_images'), false)
    assert.equal(db.objectStoreNames.contains(module.SVG_SOURCE_STORE), true)

    const cache = new module.SvgImageCache()
    const url = '/data/products/2026072112/000/500/wind.svg'
    const blob = new Blob(['<svg width="10" height="10"/>'], { type: 'image/svg+xml' })
    assert.equal(await cache.putSource(url, blob), true)
    assert.equal(await cache.has(url), true)
    assert.equal((await cache.getSource(url)).type, 'image/svg+xml')

    const one = { width: 10 }
    const two = { width: 20 }
    cache.setDecoded(url, 1, one)
    cache.setDecoded(url, 2, two)
    assert.equal(cache.getDecoded(url, 1), one)
    assert.equal(cache.getDecoded(url, 2), two)
    assert.equal(await cache.has(url), true, '不同倍率仍只依赖同一 URL 源记录')

    const expiredUrl = '/data/products/2026072000/expired.svg'
    await new Promise((resolve, reject) => {
      const request = db.transaction(module.SVG_SOURCE_STORE, 'readwrite').objectStore(module.SVG_SOURCE_STORE).put({
        url: expiredUrl, blob, contentType: blob.type, initTime: '2026072000', cachedAt: 1, expiry: 2
      })
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
    })
    assert.equal(await cache.cleanupExpired(3), 1)
    assert.equal(await cache.has(expiredUrl), false)
  })
})

describe('页面严格优先级队列', () => {
  it('高优先级到来会中止在途低优先级，且二者不并发', async () => {
    const { PRIORITY, runQueued } = await import('../src/utils/loadQueue.js')
    const events = []
    let lowRunning = false
    const low = runQueued((signal) => new Promise((resolve, reject) => {
      lowRunning = true
      events.push('low-start')
      signal.addEventListener('abort', () => {
        events.push('low-abort')
        lowRunning = false
        reject(signal.reason)
      }, { once: true })
    }), PRIORITY.LOW).catch(() => null)

    await new Promise((resolve) => setTimeout(resolve, 0))
    const high = runQueued(async () => {
      assert.equal(lowRunning, false)
      events.push('high-start')
    }, PRIORITY.HIGH)
    await Promise.all([low, high])
    assert.deepEqual(events, ['low-start', 'low-abort', 'high-start'])
  })

  it('限制单个子图占用并让后到子图公平获得空闲槽位', async () => {
    const { PRIORITY, runQueued } = await import('../src/utils/loadQueue.js')
    const events = []
    const releases = new Map()
    const task = (label, groupKey) => runQueued(async () => {
      events.push(`${label}-start`)
      await new Promise((resolve) => releases.set(label, resolve))
      events.push(`${label}-end`)
    }, PRIORITY.HIGH, null, { groupKey, maxGroupConcurrent: 2 })

    const running = [task('a1', 'panel-a'), task('a2', 'panel-a'), task('a3', 'panel-a')]
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(events, ['a1-start', 'a2-start'])

    running.push(task('b1', 'panel-b'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(events, ['a1-start', 'a2-start', 'b1-start'])

    releases.get('a1')()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.ok(events.includes('a3-start'))
    releases.get('a2')()
    releases.get('a3')()
    releases.get('b1')()
    await Promise.all(running)
  })
})

describe('多图 JSON 请求合并', () => {
  it('合并并发请求并在短时缓存内复用解析结果', async () => {
    const originalFetch = globalThis.fetch
    let requestCount = 0
    globalThis.fetch = async () => {
      requestCount += 1
      return new Response(JSON.stringify({ init_time: '2026072112' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    try {
      const { clearJsonRequestCache, fetchJsonShared } = await import('../src/utils/jsonRequestCache.js')
      clearJsonRequestCache()
      const [first, second] = await Promise.all([
        fetchJsonShared('/data/products/2026072112/manifest.json'),
        fetchJsonShared('/data/products/2026072112/manifest.json')
      ])
      const third = await fetchJsonShared('/data/products/2026072112/manifest.json')
      assert.equal(requestCount, 1)
      assert.equal(first, second)
      assert.equal(second, third)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
