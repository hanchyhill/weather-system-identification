const DB_NAME = 'WeatherSystemVisualization'
const DB_VERSION = 1
const STORE_NAME = 'svg_images'
const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000

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
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0
    }
  }

  async get(key) {
    if (this.memory.has(key)) {
      this.stats.hits += 1
      return this.memory.get(key)
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
          this.memory.set(key, image)
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

  async set(key, image) {
    this.memory.set(key, image)
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
