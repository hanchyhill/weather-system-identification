// Express 应用：下发 VAPID 公钥、接收订阅/退订。
// 路由（生产经 nginx 反代 /api/；开发经 vite server.proxy 转发到本服务）：
//   GET  /api/push/vapid-public-key   -> { public_key, subject }
//   POST /api/push/subscribe          body: { subscription }
//   POST /api/push/unsubscribe        body: { endpoint }

import fs from 'node:fs'

import express from 'express'

import { serverPort, vapidKeysPath } from './config.js'
import { addSubscription, listSubscriptions, removeSubscription } from './subscriptionStore.js'

const app = express()
app.use(express.json({ limit: '32kb' }))

function loadPublicKey() {
  try {
    const keys = JSON.parse(fs.readFileSync(vapidKeysPath(), 'utf-8'))
    if (!keys.public_key) return null
    return { public_key: keys.public_key, subject: keys.subject || '' }
  } catch {
    return null
  }
}

app.get('/api/push/health', (req, res) => {
  res.json({ ok: true, vapidConfigured: loadPublicKey() !== null, subscriptions: listSubscriptions().length })
})

app.get('/api/push/vapid-public-key', (req, res) => {
  const key = loadPublicKey()
  if (!key) {
    res.status(503).json({ error: 'VAPID 公钥未配置，请先运行 generateVapidKeys.js' })
    return
  }
  res.json(key)
})

app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body && req.body.subscription
  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'invalid subscription' })
    return
  }
  addSubscription(subscription)
  res.json({ ok: true })
})

app.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = req.body && req.body.endpoint
  if (!endpoint) {
    res.status(400).json({ error: 'missing endpoint' })
    return
  }
  const removed = removeSubscription(endpoint)
  res.json({ ok: true, removed })
})

const port = serverPort()
app.listen(port, '127.0.0.1', () => {
  console.log(`[push] 订阅服务已启动 http://127.0.0.1:${port}`)
})
