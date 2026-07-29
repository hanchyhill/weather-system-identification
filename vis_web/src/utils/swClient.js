let registration = null
const statusListeners = new Set()
const downloadDebugListeners = new Set()

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

// ServiceWorker.postMessage 使用结构化克隆，不能接收 Vue reactive/ref 产生的 Proxy。
// 在唯一的消息边界重建普通数组和标量，避免任一调用方误传响应式对象。
export function cloneablePrefetchOptions(options = {}) {
  return {
    enabled: options?.enabled !== false,
    zLevels: Array.from(options?.zLevels || [], Number),
    layerTypes: Array.from(options?.layerTypes || [], String),
    levels: Array.from(options?.levels || [], String)
  }
}

function postToController(message) {
  const target = controller()
  if (!target) return false
  try {
    target.postMessage(message)
    return true
  } catch (error) {
    console.warn('[sw] 消息发送失败：', error)
    return false
  }
}

export function prefetchLatest(initTime, options = {}) {
  if (!initTime) return false
  return postToController({
    type: 'prefetchLatest',
    initTime: String(initTime),
    options: cloneablePrefetchOptions(options)
  })
}

// 旧调用入口保留；SW 端仍会只选择最新时次。
export function prefetchInitTimes(initTimes, options = {}) {
  if (!Array.isArray(initTimes) || !initTimes.length) return false
  return postToController({
    type: 'prefetch',
    initTimes: Array.from(initTimes, String),
    options: cloneablePrefetchOptions(options)
  })
}

export function cancelPrefetch() {
  return postToController({ type: 'cancelPrefetch' })
}

export function setPrefetchOptions(options) {
  return postToController({
    type: 'setPrefetchOptions',
    options: cloneablePrefetchOptions(options)
  })
}

export function requestPrefetchStatus() {
  return postToController({ type: 'getPrefetchStatus' })
}

export function setServiceWorkerDownloadDebug(enabled) {
  return postToController({ type: 'setDownloadDebug', enabled: Boolean(enabled) })
}

export function subscribeServiceWorkerDownloadDebug(listener) {
  downloadDebugListeners.add(listener)
  return () => downloadDebugListeners.delete(listener)
}

export function subscribePrefetchStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

if (isServiceWorkerSupported()) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'prefetchStatus') {
      const next = { ...EMPTY_PREFETCH_STATUS, ...event.data }
      for (const listener of statusListeners) listener(next)
    } else if (event.data?.type === 'downloadDebug') {
      for (const listener of downloadDebugListeners) listener(event.data.record || {})
    }
  })
}
