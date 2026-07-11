// 起报时次计算工具（供 Service Worker 客户端做 catch-up 预取用）。
// calLatestBaseTime 的判定逻辑与 useWeatherView.js / 后端 weather_common.calLatestBaseTime 保持一致：
//   取当前 UTC 时间再后移 1 小时（后端绘图约滞后一小时才画完），
//   UTC 07-19 时 -> 当日 00 时；19 时以后 -> 当日 12 时；07 时以前 -> 前一日 12 时。
// 起报周期为 00/12 UTC，相邻两个时次相差 12 小时。

function padTimePart(value) {
  return String(value).padStart(2, '0')
}

function formatBase(date) {
  return (
    `${date.getUTCFullYear()}` +
    `${padTimePart(date.getUTCMonth() + 1)}` +
    `${padTimePart(date.getUTCDate())}` +
    `${padTimePart(date.getUTCHours())}`
  )
}

export function calLatestBaseTime(now = new Date()) {
  const shifted = new Date(now.getTime() - 60 * 60 * 1000)
  const hour = shifted.getUTCHours()

  let base
  if (hour >= 7 && hour < 19) {
    base = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0))
  } else if (hour >= 19) {
    base = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 12))
  } else {
    const prev = new Date(shifted.getTime() - 24 * 60 * 60 * 1000)
    base = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 12))
  }
  return formatBase(base)
}

// 返回最近 count 个起报时次（含最新），由新到旧，步长 12 小时。
export function recentInitTimes(count = 2) {
  const latest = calLatestBaseTime()
  const year = Number(latest.slice(0, 4))
  const month = Number(latest.slice(4, 6))
  const day = Number(latest.slice(6, 8))
  const hour = Number(latest.slice(8, 10))

  let millis = Date.UTC(year, month - 1, day, hour)
  const result = []
  for (let i = 0; i < count; i++) {
    result.push(formatBase(new Date(millis)))
    millis -= 12 * 60 * 60 * 1000
  }
  return result
}
