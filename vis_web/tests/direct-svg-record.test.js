import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  directSvgLayerRecord,
  isDirectMultiZoomLayer
} from '../src/composables/weatherView/directSvgRecord.js'

describe('多图首屏 SVG 确定性路径', () => {
  it('普通图层只构造覆盖业务范围的 z0 瓦片', () => {
    const record = directSvgLayerRecord('6', 500, 'hght_contour')
    assert.deepEqual(Object.keys(record.tiles), ['0'])
    assert.equal(record.tiles['0'].length, 1)
    assert.deepEqual(record.tiles['0'][0], {
      z: 0,
      x: 2,
      y: 1,
      bounds: { lon_min: 60, lon_max: 150, lat_min: 0, lat_max: 60 },
      status: 'generated',
      path: '006/500/hght_contour/0/2/1.svg'
    })
  })

  it('风场图层构造 z0/z1/z2，并与后端全局瓦片矩阵一致', () => {
    const record = directSvgLayerRecord('102', 'surface', 'surface_barb')
    assert.equal(isDirectMultiZoomLayer('surface_barb'), true)
    assert.deepEqual(Object.keys(record.tiles), ['0', '1', '2'])
    assert.deepEqual(
      Object.fromEntries(Object.entries(record.tiles).map(([z, tiles]) => [z, tiles.length])),
      { 0: 1, 1: 4, 2: 16 }
    )
    assert.equal(record.tiles['1'][0].path, '102/surface/surface_barb/1/4/2.svg')
    assert.equal(record.tiles['2'].at(-1).path, '102/surface/surface_barb/2/11/7.svg')
  })
})
