// Web Push 客户端：能力检测、请求通知授权、订阅/退订、与后端交换订阅信息。
// 依赖 Service Worker 已注册（swClient.registerWeatherSW）。所有能力要求安全上下文
// （https 或 localhost），非安全上下文（局域网 IP + HTTP）下 isPushSupported() 返回 false。

const API_BASE = '/api/push'

export function isPushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

// VAPID 公钥是 URL-safe base64（无填充）的 EC 未压缩点，需转成 Uint8Array 传给 subscribe。
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

async function fetchVapidPublicKey() {
  const res = await fetch(`${API_BASE}/vapid-public-key`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`获取 VAPID 公钥失败：${res.status}`)
  const data = await res.json()
  if (!data || !data.public_key) throw new Error('后端未返回 VAPID 公钥')
  return data.public_key
}

async function readyRegistration() {
  if (!isPushSupported()) throw new Error('当前环境不支持 Web Push')
  return navigator.serviceWorker.ready
}

// 返回当前是否已订阅
export async function getSubscriptionState() {
  if (!isPushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return Boolean(sub)
  } catch {
    return false
  }
}

// 订阅：请求通知授权 -> 取 VAPID 公钥 -> pushManager.subscribe -> 上报后端。
export async function subscribeToPush() {
  if (!isPushSupported()) throw new Error('当前环境不支持 Web Push（需 https 或 localhost）')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('未获得通知授权，无法订阅实时更新')
  }

  const publicKey = await fetchVapidPublicKey()
  const reg = await readyRegistration()

  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true, // Chrome 强制：每条 push 必须弹可见通知
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    })
  }

  const res = await fetch(`${API_BASE}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ subscription: subscription.toJSON() })
  })
  if (!res.ok) throw new Error(`订阅上报失败：${res.status}`)
  return true
}

// 退订：告知后端删除 -> 本地 unsubscribe。
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return false

  try {
    await fetch(`${API_BASE}/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ endpoint: subscription.endpoint })
    })
  } catch {
    // 后端删除失败不阻塞本地退订
  }
  await subscription.unsubscribe()
  return true
}
