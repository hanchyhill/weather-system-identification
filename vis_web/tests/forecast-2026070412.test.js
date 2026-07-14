import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

// 此测试有意固定到当前验收用起报时次，不请求 THREDDS，也不依赖浏览器或网络。
// 它验证 vis_web 开发服务器会读取的 manifest 与所有被引用的 SVG 瓦片，避免出现
// “控制器可选但地图无图”的数据契约问题。
const INIT_TIME = '2026070412'
const productsRoot = join(import.meta.dirname, '..', '..', 'data', 'products', INIT_TIME)
const manifestPath = join(productsRoot, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const expectedBounds = { lon_min: 60, lon_max: 150, lat_min: 0, lat_max: 60 }
const usableStatuses = new Set(['generated', 'skipped'])

function allLayerRecords() {
  return Object.entries(manifest.products).flatMap(([fcHour, levels]) => (
    Object.entries(levels).flatMap(([level, layers]) => (
      Object.entries(layers).map(([layerType, record]) => ({ fcHour, level, layerType, record }))
    ))
  ))
}

function assertTileBounds(bounds, label) {
  assert.ok(bounds, `${label}: missing bounds`)
  assert.ok(bounds.lon_min >= expectedBounds.lon_min && bounds.lon_max <= expectedBounds.lon_max, `${label}: longitude bounds`)
  assert.ok(bounds.lat_min >= expectedBounds.lat_min && bounds.lat_max <= expectedBounds.lat_max, `${label}: latitude bounds`)
  assert.ok(bounds.lon_min < bounds.lon_max && bounds.lat_min < bounds.lat_max, `${label}: invalid bounds order`)
}

describe(`frontend forecast fixture ${INIT_TIME}`, () => {
  it('has a manifest matching the frontend forecast selector contract', () => {
    assert.equal(manifest.init_time, INIT_TIME)
    assert.deepEqual(manifest.bounds, expectedBounds)
    assert.deepEqual(manifest.tile_scheme.bounds, expectedBounds)
    assert.deepEqual(manifest.tile_scheme.levels, [0, 1, 2])
    assert.ok(Array.isArray(manifest.fc_hours) && manifest.fc_hours.length > 0)
    assert.ok(Array.isArray(manifest.levels) && manifest.levels.includes('surface'))
    assert.ok(manifest.layer_types && typeof manifest.layer_types === 'object')
    assert.ok(Object.values(manifest.layer_types).every((types) => Array.isArray(types) && types.length > 0))

    const productHours = Object.keys(manifest.products).sort()
    assert.deepEqual(productHours, [...manifest.fc_hours].sort())

    const declaredLayerTypes = new Set(Object.values(manifest.layer_types).flat())
    assert.ok(allLayerRecords().every(({ layerType }) => declaredLayerTypes.has(layerType)))
  })

  it('has consistent layer records for every selectable forecast hour and level', () => {
    const records = allLayerRecords()
    assert.ok(records.length > 0)

    for (const { fcHour, level, layerType, record } of records) {
      assert.equal(record.init_time, INIT_TIME, `${fcHour}/${level}/${layerType}: init_time`)
      assert.equal(String(record.fc_hour).padStart(3, '0'), fcHour, `${fcHour}/${level}/${layerType}: fc_hour`)
      assert.equal(String(record.level), level, `${fcHour}/${level}/${layerType}: level`)
      assert.equal(record.layer_type, layerType, `${fcHour}/${level}/${layerType}: layer_type`)
      assert.deepEqual(record.bounds, expectedBounds, `${fcHour}/${level}/${layerType}: bounds`)
      assert.ok(usableStatuses.has(record.status), `${fcHour}/${level}/${layerType}: unusable status ${record.status}`)
      assert.ok(record.tiles && typeof record.tiles === 'object', `${fcHour}/${level}/${layerType}: missing tiles`)
    }
  })

  it('has a non-empty, in-bounds SVG asset for every manifest tile URL', () => {
    let tileCount = 0

    for (const { fcHour, level, layerType, record } of allLayerRecords()) {
      for (const [zoom, tiles] of Object.entries(record.tiles)) {
        assert.ok(Array.isArray(tiles) && tiles.length > 0, `${fcHour}/${level}/${layerType}/z${zoom}: no tiles`)
        for (const tile of tiles) {
          tileCount += 1
          assert.equal(tile.z, Number(zoom), `${tile.path}: zoom`)
          assert.ok(tile.path && !tile.path.startsWith('/') && !tile.path.includes('..'), `${fcHour}/${level}/${layerType}: unsafe tile path`)
          assert.ok(usableStatuses.has(tile.status), `${tile.path}: unusable status ${tile.status}`)
          assertTileBounds(tile.bounds, tile.path)

          const assetPath = join(productsRoot, tile.path)
          assert.ok(existsSync(assetPath), `${tile.path}: referenced SVG is missing`)
          assert.ok(statSync(assetPath).size > 0, `${tile.path}: empty SVG`)
        }
      }
    }

    assert.ok(tileCount > 0, 'manifest does not contain any tiles')
  })

  it('keeps referenced assets inside the selected product directory', () => {
    for (const { record } of allLayerRecords()) {
      for (const tiles of Object.values(record.tiles)) {
        for (const tile of tiles) {
          const assetPath = join(productsRoot, tile.path)
          assert.equal(assetPath.startsWith(productsRoot), true, `${tile.path}: escaped products root`)
        }
      }
    }
  })
})
