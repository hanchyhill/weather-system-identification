// 独立的推送轮询脚本（与绘图流水线解耦）。
// 每 interval-minutes 分钟检查一次 products 目录里最新起报时次的 manifest：
// 出现新起报时次即推一次（同一时次只推一次，去重见 pushSender / last_pushed.json）。
//
// 用法：
//   node pushSchedule.js                          常驻，默认每 30 分钟对齐网格运行
//   node pushSchedule.js --run-immediately
//   node pushSchedule.js --interval-minutes 30

import { maybeNotifyNewInit } from './pushSender.js'

function log(message) {
  const now = new Date().toISOString()
  console.log(`[${now}] [push-schedule] ${message}`)
}

function parseArgs() {
  const argv = process.argv.slice(2)
  const runImmediately = argv.includes('--run-immediately')
  let intervalMinutes = 30
  const idx = argv.indexOf('--interval-minutes')
  if (idx !== -1 && argv[idx + 1]) {
    const parsed = Number(argv[idx + 1])
    if (Number.isFinite(parsed) && parsed >= 1) intervalMinutes = Math.floor(parsed)
  }
  return { runImmediately, intervalMinutes }
}

// 下一个对齐到整点分钟网格（步长 interval）的时间点距现在的毫秒数。
function msUntilNextRun(intervalMinutes, now = new Date()) {
  const interval = Math.max(1, intervalMinutes)
  const minutes = now.getMinutes()
  const nextMultiple = (Math.floor(minutes / interval) + 1) * interval
  const next = new Date(now)
  next.setSeconds(0, 0)
  if (nextMultiple >= 60) {
    next.setHours(now.getHours() + 1, 0, 0, 0)
  } else {
    next.setMinutes(nextMultiple)
  }
  return Math.max(0, next.getTime() - now.getTime())
}

async function checkOnce() {
  try {
    const pushed = await maybeNotifyNewInit()
    log(pushed ? '检测到新起报时次，已推送' : '无新起报时次，跳过')
  } catch (error) {
    log(`检查/推送异常：${error && error.stack ? error.stack : error}`)
  }
}

async function run() {
  const { runImmediately, intervalMinutes } = parseArgs()
  if (runImmediately) await checkOnce()

  const loop = () => {
    const delay = msUntilNextRun(intervalMinutes)
    const next = new Date(Date.now() + delay)
    log(`下次检查：${next.toISOString()}`)
    setTimeout(async () => {
      await checkOnce()
      loop()
    }, delay)
  }
  loop()
}

run()
