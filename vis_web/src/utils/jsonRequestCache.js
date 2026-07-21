// 多图子图共享 JSON 请求。相同 URL 的并发请求只发送一次；短时缓存避免同一批子图
// 因挂载时序相差数毫秒而重复下载和解析 Manifest/天气系统 JSON。
const inFlight = new Map()
const resolved = new Map()
const MAX_RESOLVED = 120

function pruneExpired(now = Date.now()) {
  for (const [url, entry] of resolved) {
    if (entry.expiresAt <= now) resolved.delete(url)
  }
}

function touchResolved(url, entry) {
  resolved.delete(url)
  resolved.set(url, entry)
  while (resolved.size > MAX_RESOLVED) resolved.delete(resolved.keys().next().value)
}

export async function fetchJsonShared(url, { maxAge = 30_000 } = {}) {
  const now = Date.now()
  const cached = resolved.get(url)
  if (cached && now <= cached.expiresAt) {
    touchResolved(url, cached)
    return cached.value
  }
  if (cached) resolved.delete(url)

  const pending = inFlight.get(url)
  if (pending) return pending

  const request = (async () => {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const value = await response.json()
    const cachedAt = Date.now()
    pruneExpired(cachedAt)
    touchResolved(url, { value, cachedAt, expiresAt: cachedAt + Math.max(0, maxAge) })
    return value
  })()
  inFlight.set(url, request)
  request.then(
    () => { if (inFlight.get(url) === request) inFlight.delete(url) },
    () => { if (inFlight.get(url) === request) inFlight.delete(url) }
  )
  return request
}

export function clearJsonRequestCache() {
  inFlight.clear()
  resolved.clear()
}
