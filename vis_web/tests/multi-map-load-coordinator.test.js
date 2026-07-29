import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createMultiMapLoadCoordinator } from '../src/utils/multiMapLoadCoordinator.js'

function nextTimer() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('多图加载协调器', () => {
  it('优先复用 IndexedDB Manifest，网络结果会写回持久缓存', async () => {
    const stored = new Map([
      ['2026072912', { value: { init_time: '2026072912' }, expiresAt: Date.now() + 60_000 }]
    ])
    const writes = []
    const manifestCache = {
      get: async (key) => stored.get(key) || null,
      put: async (...args) => { writes.push(args) },
      clear: async () => { stored.clear() }
    }
    const coordinator = createMultiMapLoadCoordinator({ manifestCache })
    let networkRequests = 0

    const cached = await coordinator.getManifest('2026072912', async () => {
      networkRequests += 1
      return null
    })
    assert.deepEqual(cached, { init_time: '2026072912' })
    assert.equal(networkRequests, 0)

    const downloaded = await coordinator.getManifest('2026072900', async () => {
      networkRequests += 1
      return { init_time: '2026072900' }
    })
    assert.deepEqual(downloaded, { init_time: '2026072900' })
    assert.equal(networkRequests, 1)
    await nextTimer()
    assert.equal(writes.length, 1)
    assert.equal(writes[0][0], '2026072900')
  })

  it('在会话内合并 Manifest，并在失败或显式清理后重新请求', async () => {
    const coordinator = createMultiMapLoadCoordinator()
    let requests = 0
    const loader = async () => {
      requests += 1
      return { init_time: '2026072912' }
    }

    const [first, second] = await Promise.all([
      coordinator.getManifest('2026072912', loader),
      coordinator.getManifest('2026072912', loader)
    ])
    assert.equal(requests, 1)
    assert.equal(first, second)

    coordinator.clearManifests()
    await coordinator.getManifest('2026072912', loader)
    assert.equal(requests, 2)

    let failures = 0
    await assert.rejects(coordinator.getManifest('failed', async () => {
      failures += 1
      throw new Error('unavailable')
    }))
    await assert.rejects(coordinator.getManifest('failed', async () => {
      failures += 1
      throw new Error('unavailable')
    }))
    assert.equal(failures, 2)
  })

  it('等待全部当前 SVG 和前台 JSON 完成后才启动预加载', async () => {
    const coordinator = createMultiMapLoadCoordinator({ preloadDelay: 0 })
    coordinator.beginBatch(1, ['panel-a', 'panel-b'])
    const tokenA = coordinator.visibleStarted('panel-a', 1)
    const tokenB = coordinator.visibleStarted('panel-b', 1)
    let preloadRuns = 0
    coordinator.registerPreload('panel-a', 1, {
      run: async () => { preloadRuns += 1 }
    })
    coordinator.registerPreload('panel-b', 1, {
      run: async () => { preloadRuns += 1 }
    })

    coordinator.visibleFinished('panel-a', 1, tokenA)
    await nextTimer()
    assert.equal(preloadRuns, 0)

    coordinator.visibleFinished('panel-b', 1, tokenB)
    assert.equal(await coordinator.waitForVisible(1), true)
    await nextTimer()
    assert.equal(preloadRuns, 0)

    coordinator.foregroundFinished('panel-a', 1)
    await nextTimer()
    assert.equal(preloadRuns, 0)

    coordinator.foregroundFinished('panel-b', 1)
    assert.equal(await coordinator.waitForForeground(1), true)
    await nextTimer()
    assert.equal(preloadRuns, 2)
  })

  it('不同起报时次的 Manifest 串行后台加载', async () => {
    const coordinator = createMultiMapLoadCoordinator()
    const events = []
    let releaseFirst
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const first = coordinator.getManifest('2026072912', async () => {
      events.push('first-start')
      await firstGate
      events.push('first-end')
      return { init_time: '2026072912' }
    })
    const second = coordinator.getManifest('2026072900', async () => {
      events.push('second-start')
      return { init_time: '2026072900' }
    })

    await nextTimer()
    assert.deepEqual(events, ['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    assert.deepEqual(events, ['first-start', 'first-end', 'second-start'])
  })

  it('新加载批次会取消旧预加载并忽略旧批次完成事件', async () => {
    const coordinator = createMultiMapLoadCoordinator({ preloadDelay: 0 })
    let cancellations = 0
    coordinator.beginBatch(1, ['panel-a'])
    const oldToken = coordinator.visibleStarted('panel-a', 1)
    coordinator.registerPreload('panel-a', 1, {
      run: async () => {},
      cancel: () => { cancellations += 1 }
    })

    coordinator.beginBatch(2, ['panel-b'])
    assert.equal(cancellations, 1)
    coordinator.visibleFinished('panel-a', 1, oldToken)

    let settled = false
    const barrier = coordinator.waitForVisible(2).then((value) => {
      settled = value
    })
    await nextTimer()
    assert.equal(settled, false)

    const newToken = coordinator.visibleStarted('panel-b', 2)
    coordinator.visibleFinished('panel-b', 2, newToken)
    await barrier
    assert.equal(settled, true)
  })

  it('翻页会中止尚未完成的后台 Manifest', async () => {
    const coordinator = createMultiMapLoadCoordinator()
    coordinator.beginBatch(1, ['panel-a'])
    let aborted = false
    const manifest = coordinator.getManifest('2026072912', (signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true
        reject(signal.reason)
      }, { once: true })
    }))
    await nextTimer()

    coordinator.beginBatch(2, ['panel-b'])
    await assert.rejects(manifest, { name: 'AbortError' })
    assert.equal(aborted, true)
  })
})
