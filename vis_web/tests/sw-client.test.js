import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('Service Worker 客户端消息', () => {
  it('发送前把响应式 Proxy 风格的预取配置转换为可克隆普通对象', async () => {
    const originalNavigator = globalThis.navigator
    const messages = []
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          controller: {
            postMessage(message) {
              // 浏览器在这里执行结构化克隆；若仍含 Proxy，本调用会抛 DOMException。
              messages.push(structuredClone(message))
            }
          },
          addEventListener() {}
        }
      }
    })

    try {
      const module = await import(`../src/utils/swClient.js?proxy=${Date.now()}`)
      const options = {
        enabled: true,
        zLevels: new Proxy([0, 1], {}),
        layerTypes: new Proxy(['wind_barb'], {}),
        levels: new Proxy(['500', 'surface'], {})
      }

      assert.equal(module.setPrefetchOptions(options), true)
      assert.equal(module.prefetchLatest('2026073012', options), true)
      assert.equal(module.prefetchInitTimes(new Proxy(['2026073000', '2026073012'], {}), options), true)

      assert.deepEqual(messages, [
        {
          type: 'setPrefetchOptions',
          options: {
            enabled: true,
            zLevels: [0, 1],
            layerTypes: ['wind_barb'],
            levels: ['500', 'surface']
          }
        },
        {
          type: 'prefetchLatest',
          initTime: '2026073012',
          options: {
            enabled: true,
            zLevels: [0, 1],
            layerTypes: ['wind_barb'],
            levels: ['500', 'surface']
          }
        },
        {
          type: 'prefetch',
          initTimes: ['2026073000', '2026073012'],
          options: {
            enabled: true,
            zLevels: [0, 1],
            layerTypes: ['wind_barb'],
            levels: ['500', 'surface']
          }
        }
      ])
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator
      })
    }
  })
})
