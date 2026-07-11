const DB_NAME = 'WeatherSystemVisualization'
const DB_VERSION = 1
const STORE_NAME = 'svg_images'
// 缓存有效期 72 小时（3 天）
const EXPIRY_MS = 72 * 60 * 60 * 1000
// 内存层 LRU 上限：单例缓存被单图与全部子图共用，长时间运行可能持续累积已解码的
// Image 对象（每张瓦片占用显存/内存），故对内存 Map 设上限并按最近使用淘汰；
// IndexedDB 仍保留（受 72h 过期约束），被淘汰的条目下次命中时从库里重新解码即可。
const MEMORY_LIMIT = 600

let dbPromise = null

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.resolve(null)
  }

  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('expiry', 'expiry')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })

  return dbPromise
}

function imageToDataUrl(image) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not serialize SVG image'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve({
        dataUrl: reader.result,
        width: canvas.width,
        height: canvas.height
      })
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

function dataUrlToImage(value) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = value.dataUrl
  })
}

export class SvgImageCache {
  constructor() {
    this.memory = new Map()
    this.pendingPersist = new Set()
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0
    }
  }

  // 写入内存并维护 LRU 顺序：Map 迭代顺序即插入顺序，重新 set 前先 delete 可把键移到“最新”，
  // 超出上限时淘汰最旧（迭代到的第一个）键。
  touchMemory(key, image) {
    if (this.memory.has(key)) this.memory.delete(key)
    this.memory.set(key, image)
    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  async get(key) {
    if (this.memory.has(key)) {
      const image = this.memory.get(key)
      this.touchMemory(key, image)
      this.stats.hits += 1
      return image
    }

    const db = await openDatabase()
    if (!db) {
      this.stats.misses += 1
      return null
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)

      request.onsuccess = async () => {
        const item = request.result
        if (!item || item.expiry <= Date.now()) {
          this.stats.misses += 1
          resolve(null)
          return
        }

        try {
          const image = await dataUrlToImage(item.value)
          this.touchMemory(key, image)
          this.stats.hits += 1
          resolve(image)
        } catch {
          this.stats.errors += 1
          resolve(null)
        }
      }
      request.onerror = () => {
        this.stats.misses += 1
        resolve(null)
      }
    })
  }

  // 仅判断缓存中是否已存在未过期的条目，不解码图像；用于预加载前的去重检查。
  async has(key) {
    if (this.memory.has(key)) return true

    const db = await openDatabase()
    if (!db) return false

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        const item = request.result
        resolve(Boolean(item && item.expiry > Date.now()))
      }
      request.onerror = () => resolve(false)
    })
  }

  async set(key, image) {
    // 立即写入内存（供渲染与跨子图复用），把昂贵的 PNG 编码 + IndexedDB 写入推迟到空闲期，
    // 从而不阻塞渲染关键路径。持久化仅用于跨会话复用，延迟完成不影响本次渲染。
    this.touchMemory(key, image)
    this.schedulePersist(key, image)
    return true
  }

  // 空闲期把图片编码为 PNG 并写入 IndexedDB；用 requestIdleCallback 让位于渲染/交互。
  schedulePersist(key, image) {
    if (this.pendingPersist.has(key)) return
    this.pendingPersist.add(key)
    const run = () => {
      this.pendingPersist.delete(key)
      this.persistToDb(key, image)
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 3000 })
    } else {
      setTimeout(run, 0)
    }
  }

  async persistToDb(key, image) {
    const db = await openDatabase()
    if (!db) return false
    try {
      const value = await imageToDataUrl(image)
      return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const request = transaction.objectStore(STORE_NAME).put({
          key,
          value,
          expiry: Date.now() + EXPIRY_MS
        })
        request.onsuccess = () => resolve(true)
        request.onerror = () => resolve(false)
      })
    } catch {
      this.stats.errors += 1
      return false
    }
  }

  getStats() {
    return {
      ...this.stats,
      memorySize: this.memory.size
    }
  }
}

// 全局共享单例：单图与全部多图子图共用同一内存缓存，消除同一瓦片在多个子图间的
// 重复网络/解码开销，并让预加载天然去重。生命周期与页面一致（不随某个视图实例卸载而释放）。
export const sharedSvgImageCache = new SvgImageCache()
