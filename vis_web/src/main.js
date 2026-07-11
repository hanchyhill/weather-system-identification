import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import './styles.css'
import { recentInitTimes } from './utils/initTime'
import { loadPrefetchOptions } from './utils/prefetchOptions'
import { isServiceWorkerSupported, registerWeatherSW, prefetchInitTimes, setPrefetchOptions } from './utils/swClient'

createApp(App).use(createPinia()).mount('#app')

// 注册 Service Worker，并在“打开 / 标签页重新可见”时做一次 catch-up 预取：
// 预取最近两个起报时次（最新 + 上一时次）的瓦片，让用户下次进入时数据已就绪。
// 预取范围（瓦片层次/要素/气压层）取用户在订阅弹窗里保存的策略；
// 非安全上下文会自动降级为 no-op。
async function bootServiceWorker() {
  if (!isServiceWorkerSupported()) return
  const reg = await registerWeatherSW()
  if (!reg) return

  const kickPrefetch = () => {
    const options = loadPrefetchOptions()
    setPrefetchOptions(options) // 同步给 SW 持久化，供 push 唤醒时用
    prefetchInitTimes(recentInitTimes(2), options)
  }

  // 首次注册后，SW 经 clients.claim 接管当前页面会触发 controllerchange —— 那时再发首轮预取。
  if (navigator.serviceWorker.controller) kickPrefetch()
  navigator.serviceWorker.addEventListener('controllerchange', kickPrefetch)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickPrefetch()
  })
}

bootServiceWorker()
