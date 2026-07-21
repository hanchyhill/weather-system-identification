import assert from 'node:assert/strict'
import test from 'node:test'

import { SvgImageCache } from '../src/utils/indexedDBCache.js'
import {
  canvasPixelRatioForSize,
  multiMapSizeFactor,
  renderScaleForZoom
} from '../src/composables/weatherView/multiMapResolution.js'

test('多图线性尺寸按实际 canvas 面积计算', () => {
  assert.equal(multiMapSizeFactor({ width: 960, height: 640 }), 1)
  assert.equal(multiMapSizeFactor({ width: 480, height: 320 }), 0.5)
})

test('多图 canvas 像素比随尺寸分档且不超过设备 DPR', () => {
  assert.equal(canvasPixelRatioForSize({ width: 240, height: 160 }, true, 2), 1)
  assert.equal(canvasPixelRatioForSize({ width: 480, height: 320 }, true, 2), 1)
  assert.equal(canvasPixelRatioForSize({ width: 720, height: 480 }, true, 2), 1.5)
  assert.equal(canvasPixelRatioForSize({ width: 960, height: 640 }, true, 2), 2)
  assert.equal(canvasPixelRatioForSize({ width: 240, height: 160 }, false, 2), 2)
})

test('多图 SVG 栅格倍率同时响应 canvas 尺寸与地图缩放', () => {
  const halfSize = { width: 480, height: 320 }
  assert.equal(renderScaleForZoom(3, true, halfSize), 0.5)
  assert.equal(renderScaleForZoom(12, true, halfSize), 1)
  assert.equal(renderScaleForZoom(3, true, { width: 720, height: 480 }), 0.75)
  assert.equal(renderScaleForZoom(12, true, { width: 720, height: 480 }), 1.5)
  assert.equal(renderScaleForZoom(12, false, halfSize), 2)
})

test('低分辨率 SVG 使用独立的内存缓存项', () => {
  const cache = new SvgImageCache()
  assert.notEqual(cache.decodedKey('/layer.svg', 0.5), cache.decodedKey('/layer.svg', 1))
  assert.notEqual(cache.decodedKey('/layer.svg', 0.75), cache.decodedKey('/layer.svg', 1))
})
