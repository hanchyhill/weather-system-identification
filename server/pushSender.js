// 组织并发送 Web Push，按“新起报时次”去重。
// maybe_notify 语义：探测 products 目录里最新的、已生成 manifest 的起报时次，
// 若不同于上次已推送的，则给所有订阅推一条 {init_time, generated_at}，并写去重标记。

import fs from 'node:fs'
import path from 'node:path'

import webpush from 'web-push'

import { lastPushedPath, productsRoot, vapidKeysPath, vapidSubject } from './config.js'
import { listSubscriptions, removeMany } from './subscriptionStore.js'

function log(message) {
  const now = new Date().toISOString()
  console.log(`[${now}] [push] ${message}`)
}

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return true
  try {
    const keys = JSON.parse(fs.readFileSync(vapidKeysPath(), 'utf-8'))
    if (!keys.public_key || !keys.private_key) {
      log('VAPID 密钥不完整，先运行 generateVapidKeys.js')
      return false
    }
    webpush.setVapidDetails(keys.subject || vapidSubject(), keys.public_key, keys.private_key)
    vapidConfigured = true
    return true
  } catch {
    log(`VAPID 密钥不存在：${vapidKeysPath()}（先运行 generateVapidKeys.js）`)
    return false
  }
}

function loadLastPushed() {
  try {
    const data = JSON.parse(fs.readFileSync(lastPushedPath(), 'utf-8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function saveLastPushed(record) {
  const file = lastPushedPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
}

// 探测最新的、名为 10 位数字且已写出 manifest.json 的起报目录。
export function detectLatestInit(root = productsRoot()) {
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }

  let latest = null
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (!/^\d{10}$/.test(name)) continue
    if (!fs.existsSync(path.join(root, name, 'manifest.json'))) continue
    if (latest === null || name > latest) latest = name
  }
  if (latest === null) return null

  let generatedAt = null
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, latest, 'manifest.json'), 'utf-8'))
    if (manifest && typeof manifest.generated_at === 'string') generatedAt = manifest.generated_at
  } catch {
    generatedAt = null
  }
  return { initTime: latest, generatedAt }
}

// 给所有订阅发送同一条 payload；顺带清理失效（404/410）的订阅。
export async function sendToAll(payload) {
  if (!ensureVapid()) return { sent: 0, error: 'vapid not configured' }

  const subscriptions = listSubscriptions()
  if (!subscriptions.length) {
    log('无订阅，跳过发送')
    return { sent: 0 }
  }

  const data = JSON.stringify(payload)
  let sent = 0
  const expired = []

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, data)
        sent += 1
      } catch (error) {
        const status = error && error.statusCode
        if (status === 404 || status === 410) {
          expired.push(subscription.endpoint)
        } else {
          log(`发送失败 endpoint=${subscription.endpoint} status=${status} err=${error && error.message}`)
        }
      }
    })
  )

  const removed = expired.length ? removeMany(expired) : 0
  const result = { sent, expired: removed }
  log(`发送完成：${JSON.stringify(result)}`)
  return result
}

// 探测/指定最新起报时次；若为新时次则推送一次。返回是否实际推送。
export async function maybeNotifyNewInit(initTime = null) {
  try {
    let generatedAt = null
    if (initTime === null) {
      const detected = detectLatestInit()
      if (!detected) return false
      initTime = detected.initTime
      generatedAt = detected.generatedAt
    }

    const last = loadLastPushed()
    if (last.init_time === initTime) return false

    log(`发现新起报时次 ${initTime}，开始推送`)
    const result = await sendToAll({ init_time: initTime, generated_at: generatedAt })
    saveLastPushed({
      init_time: initTime,
      generated_at: generatedAt,
      pushed_at: new Date().toISOString(),
      result
    })
    return true
  } catch (error) {
    log(`maybeNotifyNewInit 异常：${error && error.stack ? error.stack : error}`)
    return false
  }
}
