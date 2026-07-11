// 推送后端的路径与 VAPID 配置。
// 输出根目录逻辑与 Python 端 weather_common.default_output_root 保持一致：
//   Windows 本地开发 -> <repo>/data；Linux 生产 -> /data/weather_vis。
// 环境变量覆盖（与 ecosystem 的 commonEnv 对齐）：
//   WEATHER_OUTPUT_ROOT / WEATHER_PRODUCTS_ROOT / WEATHER_PUSH_ROOT
//   WEATHER_VAPID_SUBJECT（mailto: 或 https: URL）/ WEATHER_PUSH_PORT

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

export function defaultOutputRoot() {
  if (process.env.WEATHER_OUTPUT_ROOT) return process.env.WEATHER_OUTPUT_ROOT
  if (process.platform === 'win32') return path.join(repoRoot, 'data')
  return '/data/weather_vis'
}

export function productsRoot() {
  return process.env.WEATHER_PRODUCTS_ROOT || path.join(defaultOutputRoot(), 'products')
}

export function pushRoot() {
  return process.env.WEATHER_PUSH_ROOT || path.join(defaultOutputRoot(), 'push')
}

export function vapidKeysPath() {
  return path.join(pushRoot(), 'vapid_keys.json')
}

export function subscriptionsPath() {
  return path.join(pushRoot(), 'subscriptions.json')
}

export function lastPushedPath() {
  return path.join(pushRoot(), 'last_pushed.json')
}

export function vapidSubject() {
  return process.env.WEATHER_VAPID_SUBJECT || 'mailto:admin@example.com'
}

export function serverPort() {
  return Number(process.env.WEATHER_PUSH_PORT || 8090)
}
