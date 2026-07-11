// 全局并发限流器（模块级单例，跨所有视图实例共享）。
//
// 背景：多图模式下最多 9 个子图各自独立发起瓦片加载与预加载，裸 Promise.all 会瞬间
// 打满浏览器连接池，导致可见内容迟迟出不来。此处用共享信号量为“网络+解码”类任务设
// 并发上限，并给两级优先级分配**独立预算**：
//   - 可见瓦片（HIGH）：用户当前正在看的内容，可用满全部名额，优先出图；
//   - 预加载（LOW）：相邻页/相邻时效的预取，最多占用少量名额，且仅当没有 HIGH 在排队
//     时才调度——保证切换时效时“当前所需图片”始终能抢到槽位，不被预加载拖住。
// 同级按入队顺序（FIFO）。支持通过 AbortSignal 取消尚未开始的任务（切换/卸载时释放预算）。

const MAX_CONCURRENT = 8
// 预加载最多同时占用的名额；其余留给可见瓦片，避免 LOW 长时间占满导致 HIGH 饥饿。
// 取 4：单图模式下只有一个预加载者，可较快预热相邻时效；多图模式下 9 个子图共享这几个
// 名额，配合每子图极少的预取目标仍不会打满连接池。且 LOW 仅在无 HIGH 排队时才调度，
// 可见瓦片始终优先，放宽该上限不会拖慢当前视图。
const LOW_MAX_CONCURRENT = 4

export const PRIORITY = {
  HIGH: 0,
  LOW: 1
}

const highQueue = []
const lowQueue = []
let active = 0
let lowActive = 0

function dispatch(entry, isLow) {
  active += 1
  if (isLow) lowActive += 1
  entry.resolve()
}

function pump() {
  while (active < MAX_CONCURRENT) {
    // 始终优先派发 HIGH。
    if (highQueue.length) {
      dispatch(highQueue.shift(), false)
      continue
    }
    // LOW 仅在没有 HIGH 排队、且未超出 LOW 预算时派发，为可见瓦片保留头部名额。
    if (lowQueue.length && lowActive < LOW_MAX_CONCURRENT) {
      dispatch(lowQueue.shift(), true)
      continue
    }
    return
  }
}

// 获取一个并发名额；返回 release 函数，任务完成（无论成败）后必须调用以释放名额。
function acquire(priority, signal) {
  const isLow = priority === PRIORITY.LOW
  return new Promise((resolve, reject) => {
    const queue = isLow ? lowQueue : highQueue
    const entry = { resolve, isLow }

    if (signal) {
      if (signal.aborted) {
        reject(signal.reason || new DOMException('Aborted', 'AbortError'))
        return
      }
      // 尚未开始就被取消：从队列剔除并释放等待，避免占用后续调度。
      entry.onAbort = () => {
        const idx = queue.indexOf(entry)
        if (idx >= 0) {
          queue.splice(idx, 1)
          reject(signal.reason || new DOMException('Aborted', 'AbortError'))
        }
      }
      signal.addEventListener('abort', entry.onAbort, { once: true })
    }

    queue.push(entry)
    pump()
  }).then(() => {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      if (isLow) lowActive -= 1
      pump()
    }
  })
}

// 在并发上限内运行一个异步任务；task 是返回 Promise 的函数。
// signal 可选，用于在任务尚未开始时取消（已开始的任务由 task 自身根据 signal 决定是否中止）。
export async function runQueued(task, priority = PRIORITY.HIGH, signal) {
  const release = await acquire(priority, signal)
  try {
    return await task()
  } finally {
    release()
  }
}

export function getQueueStats() {
  return {
    active,
    lowActive,
    highWaiting: highQueue.length,
    lowWaiting: lowQueue.length,
    maxConcurrent: MAX_CONCURRENT
  }
}
