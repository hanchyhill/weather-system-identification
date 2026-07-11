// 订阅信息的 JSON 文件存储（按 endpoint 去重）。
// subscriptions.json 为 PushSubscription.toJSON() 对象数组：
//   { endpoint, keys: { p256dh, auth }, expirationTime }

import fs from 'node:fs'
import path from 'node:path'

import { subscriptionsPath } from './config.js'

function read() {
  const file = subscriptionsPath()
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function write(subscriptions) {
  const file = subscriptionsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 原子写：先写临时文件再 rename，避免并发/中断产生半写的 JSON。
  // 注意：server 与 push-schedule 是两个进程，极端并发下仍可能后写覆盖先写（丢一条订阅，
  // 用户重订即可恢复），但不会损坏文件。
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(subscriptions, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

export function listSubscriptions() {
  return read()
}

export function addSubscription(subscription) {
  const endpoint = subscription && subscription.endpoint
  if (!endpoint) return false
  const subscriptions = read().filter((s) => s.endpoint !== endpoint)
  subscriptions.push(subscription)
  write(subscriptions)
  return true
}

export function removeSubscription(endpoint) {
  if (!endpoint) return false
  const subscriptions = read()
  const filtered = subscriptions.filter((s) => s.endpoint !== endpoint)
  if (filtered.length === subscriptions.length) return false
  write(filtered)
  return true
}

export function removeMany(endpoints) {
  const targets = new Set((endpoints || []).filter(Boolean))
  if (!targets.size) return 0
  const subscriptions = read()
  const filtered = subscriptions.filter((s) => !targets.has(s.endpoint))
  const removed = subscriptions.length - filtered.length
  if (removed) write(filtered)
  return removed
}
