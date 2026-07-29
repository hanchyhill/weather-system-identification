// 页面网络/解码调度器。LOW 只在完全没有 HIGH 运行或等待时启动；HIGH 到来会中止
// 所有在途 LOW，使相邻时效预加载无法与用户当前所需资源竞争连接。
export const MAX_CONCURRENT = 8
const LOW_MAX_CONCURRENT = 4

export const PRIORITY = { HIGH: 0, LOW: 1 }

const highQueue = []
const lowQueue = []
const activeEntries = new Set()
const activeByGroup = new Map()
let highActive = 0
let lowActive = 0
let pumpScheduled = false

function abortReason() {
  return new DOMException('被高优先级请求中断', 'AbortError')
}

function cancelActiveLow() {
  for (const entry of activeEntries) {
    if (entry.isLow && !entry.controller.signal.aborted) entry.controller.abort(abortReason())
  }
}

function dispatch(entry) {
  entry.started = true
  activeEntries.add(entry)
  if (entry.isLow) lowActive += 1
  else highActive += 1
  if (entry.groupKey != null) {
    activeByGroup.set(entry.groupKey, (activeByGroup.get(entry.groupKey) || 0) + 1)
  }
  entry.resolve({ entry, signal: entry.controller.signal })
}

function nextDispatchableIndex(queue) {
  let bestIndex = -1
  let bestActive = Number.POSITIVE_INFINITY
  queue.forEach((entry, index) => {
    const groupActive = entry.groupKey == null ? 0 : (activeByGroup.get(entry.groupKey) || 0)
    if (groupActive >= entry.maxGroupConcurrent) return
    if (groupActive < bestActive) {
      bestIndex = index
      bestActive = groupActive
    }
  })
  return bestIndex
}

function pump() {
  pumpScheduled = false
  while (activeEntries.size < MAX_CONCURRENT && highQueue.length) {
    const index = nextDispatchableIndex(highQueue)
    if (index < 0) break
    dispatch(highQueue.splice(index, 1)[0])
  }
  // 严格空闲：只要 HIGH 正在运行或等待，就不启动 LOW。
  while (
    highActive === 0 && highQueue.length === 0 &&
    activeEntries.size < MAX_CONCURRENT && lowActive < LOW_MAX_CONCURRENT && lowQueue.length
  ) {
    const index = nextDispatchableIndex(lowQueue)
    if (index < 0) break
    dispatch(lowQueue.splice(index, 1)[0])
  }
}

function schedulePump() {
  if (pumpScheduled) return
  pumpScheduled = true
  setTimeout(pump, 0)
}

function acquire(priority, callerSignal, scheduling = {}) {
  const isLow = priority === PRIORITY.LOW
  return new Promise((resolve, reject) => {
    const queue = isLow ? lowQueue : highQueue
    const controller = new AbortController()
    const entry = {
      resolve,
      reject,
      isLow,
      controller,
      started: false,
      onAbort: null,
      groupKey: scheduling.groupKey ?? null,
      maxGroupConcurrent: Number(scheduling.maxGroupConcurrent) > 0
        ? Number(scheduling.maxGroupConcurrent)
        : Number.POSITIVE_INFINITY
    }

    if (callerSignal?.aborted) {
      reject(callerSignal.reason || abortReason())
      return
    }
    if (callerSignal) {
      entry.onAbort = () => {
        controller.abort(callerSignal.reason || abortReason())
        if (!entry.started) {
          const index = queue.indexOf(entry)
          if (index >= 0) queue.splice(index, 1)
          reject(callerSignal.reason || abortReason())
        }
      }
      callerSignal.addEventListener('abort', entry.onAbort, { once: true })
    }

    queue.push(entry)
    if (!isLow) cancelActiveLow()
    // 合并同一轮组件挂载产生的请求，让调度器先看到所有子图分组，再按活跃数公平派发。
    schedulePump()
  })
}

export async function runQueued(task, priority = PRIORITY.HIGH, signal, scheduling = {}) {
  const acquired = await acquire(priority, signal, scheduling)
  const { entry } = acquired
  try {
    return await task(acquired.signal)
  } finally {
    activeEntries.delete(entry)
    if (entry.isLow) lowActive -= 1
    else highActive -= 1
    if (entry.groupKey != null) {
      const nextCount = (activeByGroup.get(entry.groupKey) || 1) - 1
      if (nextCount > 0) activeByGroup.set(entry.groupKey, nextCount)
      else activeByGroup.delete(entry.groupKey)
    }
    if (signal && entry.onAbort) signal.removeEventListener('abort', entry.onAbort)
    pump()
  }
}

export function getQueueStats() {
  return {
    active: activeEntries.size,
    highActive,
    lowActive,
    highWaiting: highQueue.length,
    lowWaiting: lowQueue.length,
    activeGroups: activeByGroup.size,
    maxConcurrent: MAX_CONCURRENT
  }
}
