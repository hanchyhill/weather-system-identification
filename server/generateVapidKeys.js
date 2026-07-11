// 一次性生成 VAPID 密钥对（web-push 自带生成器）。
// 用法：
//   node generateVapidKeys.js          已存在则不覆盖
//   node generateVapidKeys.js --force  强制重新生成（会使现有订阅失效）
//
// 产物 <push_root>/vapid_keys.json：
//   { "public_key": "<applicationServerKey>", "private_key": "...", "subject": "..." }
// public_key 为 URL-safe base64，前端订阅时用；private_key 供发送签名用。

import fs from 'node:fs'
import path from 'node:path'

import webpush from 'web-push'

import { vapidKeysPath, vapidSubject } from './config.js'

function main() {
  const force = process.argv.includes('--force')
  const file = vapidKeysPath()

  if (fs.existsSync(file) && !force) {
    console.log(`已存在密钥，跳过：${file}（--force 可强制覆盖）`)
    return
  }

  const { publicKey, privateKey } = webpush.generateVAPIDKeys()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ public_key: publicKey, private_key: privateKey, subject: vapidSubject() }, null, 2),
    'utf-8'
  )

  console.log(`已写出密钥：${file}`)
  console.log(`application server key（前端用）：${publicKey}`)
}

main()
