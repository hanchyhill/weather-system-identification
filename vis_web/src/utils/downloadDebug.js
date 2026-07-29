// 数据下载诊断：只在用户明确开启时记录，避免常规使用产生额外内存与存储开销。
const STORAGE_KEY = 'weather-download-debug-enabled'
const MAX_RECORDS = 2_000
const records = []
let observer = null

function nowIso() {
  return new Date().toISOString()
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href)
    // 查询参数可能含有鉴权信息，导出时只保留路径。
    return `${url.origin}${url.pathname}`
  } catch {
    return String(value || '')
  }
}

export function isDownloadDebugEnabled() {
  return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'true'
}

function append(record) {
  if (!isDownloadDebugEnabled()) return
  records.push({ at: nowIso(), ...record })
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
}

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

function isDataRequest(url) {
  try {
    return new URL(url, window.location.href).pathname.startsWith('/data/')
  } catch {
    return false
  }
}

function resourceRecord(entry) {
  if (!isDataRequest(entry.name)) return
  const requestStart = entry.requestStart || entry.startTime
  const responseStart = entry.responseStart || 0
  const responseEnd = entry.responseEnd || entry.startTime + entry.duration
  append({
    source: 'browser-resource-timing',
    kind: entry.name.includes('.svg') ? 'svg' : 'data',
    phase: 'network',
    url: safeUrl(entry.name),
    initiatorType: entry.initiatorType,
    timingMs: {
      total: rounded(entry.duration),
      waitingTtfb: responseStart ? rounded(responseStart - requestStart) : null,
      download: responseStart ? rounded(responseEnd - responseStart) : null,
      dns: rounded(entry.domainLookupEnd - entry.domainLookupStart),
      connect: rounded(entry.connectEnd - entry.connectStart),
      tls: entry.secureConnectionStart ? rounded(entry.connectEnd - entry.secureConnectionStart) : null,
      request: rounded(responseStart - entry.requestStart)
    },
    bytes: { transfer: entry.transferSize, encoded: entry.encodedBodySize, decoded: entry.decodedBodySize },
    protocol: entry.nextHopProtocol || null,
    serverTiming: (entry.serverTiming || []).map((item) => ({ name: item.name, duration: item.duration, description: item.description || '' }))
  })
}

export function startDownloadDebugObserver(buffered = true) {
  if (observer || typeof PerformanceObserver === 'undefined') return
  observer = new PerformanceObserver((list) => list.getEntries().forEach(resourceRecord))
  try {
    observer.observe({ type: 'resource', buffered })
  } catch {
    observer.disconnect()
    observer = null
  }
}

export function setDownloadDebugEnabled(enabled) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  if (enabled) {
    records.length = 0
    startDownloadDebugObserver(false)
    append({ source: 'page', kind: 'session', phase: 'enabled', url: window.location.href })
  }
}

export function recordDownloadDebug(record) {
  append({ source: 'page', ...record, url: record?.url ? safeUrl(record.url) : undefined })
}

export function recordServiceWorkerDownload(record) {
  append({ source: 'service-worker', ...record, url: record?.url ? safeUrl(record.url) : undefined })
}

function summary() {
  const network = records.filter((item) => item.phase === 'network' && item.timingMs?.total != null)
  const waits = network.map((item) => item.timingMs.waitingTtfb).filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = (ratio) => waits.length ? waits[Math.min(waits.length - 1, Math.floor(waits.length * ratio))] : null
  return {
    recordCount: records.length,
    networkRequestCount: network.length,
    svgNetworkRequestCount: network.filter((item) => item.kind === 'svg').length,
    waitingTtfbMs: { p50: percentile(0.5), p95: percentile(0.95), max: waits.at(-1) ?? null },
    generatedAt: nowIso(),
    userAgent: navigator.userAgent
  }
}

export function exportDownloadDebug() {
  return { format: 'weather-system-download-debug', version: 1, summary: summary(), records: [...records] }
}

// 应用启动时恢复已开启的会话，保证刷新页面后的手动复现也会被记录。
if (typeof window !== 'undefined' && isDownloadDebugEnabled()) startDownloadDebugObserver()
