let registration = null
const statusListeners = new Set()

export const EMPTY_PREFETCH_STATUS = {
  state: 'idle', initTime: '', ready: 0, total: 0, downloaded: 0, failed: 0, reason: ''
}

export function isServiceWorkerSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export async function registerWeatherSW() {
  if (!isServiceWorkerSupported()) return null
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { type: 'module' })
    return registration
  } catch (error) {
    console.warn('[sw] 注册失败，降级为无 SW 加载：', error)
    return null
  }
}

function controller() {
  return isServiceWorkerSupported() ? navigator.serviceWorker.controller : null
}

export function prefetchLatest(initTime, options = {}) {
  const target = controller()
  if (!target || !initTime) return false
  target.postMessage({ type: 'prefetchLatest', initTime, options })
  return true
}

// 旧调用入口保留；SW 端仍会只选择最新时次。
export function prefetchInitTimes(initTimes, options = {}) {
  const target = controller()
  if (!target || !Array.isArray(initTimes) || !initTimes.length) return false
  target.postMessage({ type: 'prefetch', initTimes, options })
  return true
}

export function cancelPrefetch() {
  controller()?.postMessage({ type: 'cancelPrefetch' })
}

export function setPrefetchOptions(options) {
  const target = controller()
  if (!target) return false
  target.postMessage({ type: 'setPrefetchOptions', options: options || {} })
  return true
}

export function requestPrefetchStatus() {
  const target = controller()
  if (!target) return false
  target.postMessage({ type: 'getPrefetchStatus' })
  return true
}

export function subscribePrefetchStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

if (isServiceWorkerSupported()) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'prefetchStatus') return
    const next = { ...EMPTY_PREFETCH_STATUS, ...event.data }
    for (const listener of statusListeners) listener(next)
  })
}
