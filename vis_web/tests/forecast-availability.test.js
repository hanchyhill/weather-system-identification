import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  availableForecastHours,
  hasRenderableForecastRecord
} from '../src/composables/weatherView/forecastAvailability.js'

function record(path, status = 'generated') {
  return { path, status }
}

describe('forecast availability', () => {
  it('filters forecast hours by the selected precipitation layer', () => {
    const manifest = {
      products: {
        '000': { surface: { rain_6h_fill: record('000/rain.svg') } },
        '006': { surface: { rain_6h_fill: record('006/rain.svg') } },
        '012': { surface: { surface_barb: record('012/wind.svg') } }
      }
    }

    assert.deepEqual(
      availableForecastHours(manifest, 'surface', ['rain_6h_fill'], ['000', '006', '012']),
      ['000', '006']
    )
  })

  it('uses the intersection when precipitation is combined with another layer', () => {
    const manifest = {
      products: {
        '000': {
          surface: {
            rain_6h_fill: record('000/rain.svg'),
            surface_barb: record('000/wind.svg')
          }
        },
        '006': {
          surface: {
            rain_6h_fill: record('006/rain.svg')
          }
        },
        '012': {
          surface: {
            rain_6h_fill: record('012/rain.svg'),
            surface_barb: record('012/wind.svg')
          }
        }
      }
    }

    assert.deepEqual(
      availableForecastHours(manifest, 'surface', ['rain_6h_fill', 'surface_barb'], ['000', '006', '012']),
      ['000', '012']
    )
  })

  it('does not treat failed or empty tile records as available', () => {
    assert.equal(hasRenderableForecastRecord(record('missing.svg', 'failed')), false)
    assert.equal(hasRenderableForecastRecord({ status: 'generated', tiles: {} }), false)
    assert.equal(hasRenderableForecastRecord({
      status: 'generated',
      tiles: { '0': [{ path: '0/0/0.svg', status: 'generated' }] }
    }), true)
  })
})
