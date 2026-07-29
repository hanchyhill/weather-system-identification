import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'

globalThis.indexedDB = indexedDB
globalThis.IDBKeyRange = IDBKeyRange

const {
  MANIFEST_CACHE_TTL_MS,
  ManifestIndexedDBCache
} = await import('../src/utils/manifestIndexedDBCache.js')

describe('Manifest IndexedDB 缓存', () => {
  it('在10分钟内返回缓存，过期后删除并视为未命中', async () => {
    const cache = new ManifestIndexedDBCache()
    await cache.clear()
    const manifest = { init_time: '2026073012', products: { '000': {} } }
    assert.equal(
      await cache.put('2026073012', manifest, MANIFEST_CACHE_TTL_MS, 1_000),
      true
    )

    const fresh = await cache.get('2026073012', 1_000 + MANIFEST_CACHE_TTL_MS - 1)
    assert.deepEqual(fresh, {
      value: manifest,
      expiresAt: 1_000 + MANIFEST_CACHE_TTL_MS
    })
    assert.equal(await cache.get('2026073012', 1_000 + MANIFEST_CACHE_TTL_MS), null)
  })

  it('支持显式清空全部 Manifest', async () => {
    const cache = new ManifestIndexedDBCache()
    await cache.put('2026073000', { init_time: '2026073000' })
    await cache.put('2026073012', { init_time: '2026073012' })
    assert.equal(await cache.clear(), true)
    assert.equal(await cache.get('2026073000'), null)
    assert.equal(await cache.get('2026073012'), null)
  })
})
