// Service Worker 客户端：注册 SW、下发预取指令、取消预取。
// 非安全上下文（局域网 IP + HTTP）或浏览器不支持时静默降级——主线程仍走原有加载路径，
// 只是拿不到 SW 级缓存与后台预取。生产用 https / 本地用 localhost 即可启用。

let registration = null

export function isServiceWorkerSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export async function registerWeatherSW() {
  if (!isServiceWorkerSupported()) {
    console.info('[sw] 当前环境不支持 Service Worker（非安全上下文？），已降级为无 SW 加载。')
    return null
  }
  try {
    registration = await navigator.serviceWorker.register('/sw.js')
    return registration
  } catch (error) {
    console.warn('[sw] 注册失败，降级为无 SW 加载：', error)
    return null
  }
}

function activeController() {
  if (!isServiceWorkerSupported()) return null
  return navigator.serviceWorker.controller || null
}

// 下发预取指令：起报时次列表 + 可选过滤器 { fcHours, levels, layerTypes }。
// options 省略表示不过滤（按 manifest 尽量多预取），SW 内部按 z0->z1->z2 分级、受存储配额约束。
export function prefetchInitTimes(initTimes, options = {}) {
  const controller = activeController()
  if (!controller || !Array.isArray(initTimes) || !initTimes.length) return false
  controller.postMessage({ type: 'prefetch', initTimes, options })
  return true
}

export function cancelPrefetch() {
  const controller = activeController()
  if (!controller) return
  controller.postMessage({ type: 'cancelPrefetch' })
}

// 把用户的预取策略下发给 SW 持久化，供 push 唤醒（页面已关闭）时读取。
export function setPrefetchOptions(options) {
  const controller = activeController()
  if (!controller) return false
  controller.postMessage({ type: 'setPrefetchOptions', options: options || {} })
  return true
}
