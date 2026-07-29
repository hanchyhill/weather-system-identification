import {
  MANIFEST_CACHE_TTL_MS,
  sharedManifestIndexedDBCache
} from './manifestIndexedDBCache.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function createMultiMapLoadCoordinator({
  preloadDelay = 400,
  manifestCache = sharedManifestIndexedDBCache,
  manifestTtl = MANIFEST_CACHE_TTL_MS
} = {}) {
  let generation = 0
  let expectedPanels = new Set()
  let visiblePending = new Set()
  let foregroundPending = new Set()
  let visibleTokens = new Map()
  let visibleBarrier = deferred()
  let foregroundBarrier = deferred()
  let manifestQueue = Promise.resolve()
  let preloadTimer = null
  const manifestMemory = new Map()
  const preloadEntries = new Map()

  function isCurrent(targetGeneration) {
    return targetGeneration === generation
  }

  function isPanelCurrent(panelId, targetGeneration) {
    return isCurrent(targetGeneration) && expectedPanels.has(panelId)
  }

  function cancelScheduledPreload() {
    if (preloadTimer) {
      clearTimeout(preloadTimer)
      preloadTimer = null
    }
    for (const entry of preloadEntries.values()) entry.cancel?.()
  }

  function maybeSchedulePreload() {
    if (visiblePending.size || foregroundPending.size || !preloadEntries.size || preloadTimer) return
    const targetGeneration = generation
    preloadTimer = setTimeout(() => {
      preloadTimer = null
      if (!isCurrent(targetGeneration) || visiblePending.size || foregroundPending.size) return
      const entries = [...preloadEntries.values()]
      void Promise.allSettled(entries.map((entry) => entry.run()))
    }, preloadDelay)
  }

  function beginBatch(targetGeneration, panelIds) {
    cancelScheduledPreload()
    cancelPendingManifests()
    visibleBarrier.resolve(false)
    foregroundBarrier.resolve(false)
    generation = targetGeneration
    expectedPanels = new Set(panelIds)
    visiblePending = new Set(panelIds)
    foregroundPending = new Set(panelIds)
    visibleTokens = new Map()
    preloadEntries.clear()
    visibleBarrier = deferred()
    foregroundBarrier = deferred()
    if (!visiblePending.size) visibleBarrier.resolve(true)
    if (!foregroundPending.size) foregroundBarrier.resolve(true)
  }

  function visibleStarted(panelId, targetGeneration) {
    if (!isCurrent(targetGeneration) || !expectedPanels.has(panelId)) return null
    cancelScheduledPreload()
    if (!visiblePending.size) visibleBarrier = deferred()
    visiblePending.add(panelId)
    const token = Symbol(panelId)
    visibleTokens.set(panelId, token)
    return token
  }

  function visibleFinished(panelId, targetGeneration, token) {
    if (!isCurrent(targetGeneration) || visibleTokens.get(panelId) !== token) return
    visibleTokens.delete(panelId)
    visiblePending.delete(panelId)
    if (!visiblePending.size) {
      visibleBarrier.resolve(true)
      maybeSchedulePreload()
    }
  }

  async function waitForVisible(targetGeneration) {
    if (!isCurrent(targetGeneration)) return false
    return visibleBarrier.promise
  }

  function foregroundFinished(panelId, targetGeneration) {
    if (!isCurrent(targetGeneration)) return
    foregroundPending.delete(panelId)
    if (!foregroundPending.size) foregroundBarrier.resolve(true)
    maybeSchedulePreload()
  }

  async function waitForForeground(targetGeneration) {
    if (!isCurrent(targetGeneration)) return false
    return foregroundBarrier.promise
  }

  function registerPreload(panelId, targetGeneration, entry) {
    if (!isCurrent(targetGeneration) || !expectedPanels.has(panelId)) return
    preloadEntries.set(panelId, entry)
    maybeSchedulePreload()
  }

  function disposePanel(panelId, targetGeneration) {
    if (!isCurrent(targetGeneration)) return
    preloadEntries.get(panelId)?.cancel?.()
    preloadEntries.delete(panelId)
    expectedPanels.delete(panelId)
    visibleTokens.delete(panelId)
    visiblePending.delete(panelId)
    foregroundPending.delete(panelId)
    if (!visiblePending.size) visibleBarrier.resolve(true)
    if (!foregroundPending.size) foregroundBarrier.resolve(true)
    maybeSchedulePreload()
  }

  async function getManifest(initTime, loader) {
    const key = String(initTime)
    const cached = manifestMemory.get(key)
    if (cached?.state === 'pending') return cached.promise
    if (cached?.expiresAt > Date.now()) return cached.promise
    if (cached) manifestMemory.delete(key)

    const controller = new AbortController()
    const entry = { controller, expiresAt: 0, promise: null, state: 'pending' }
    const request = manifestQueue
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) throw controller.signal.reason
        const persisted = await manifestCache.get(key)
        if (persisted) return persisted
        if (controller.signal.aborted) throw controller.signal.reason
        const value = await loader(controller.signal)
        const expiresAt = Date.now() + manifestTtl
        void manifestCache.put(key, value, manifestTtl)
        return { value, expiresAt }
      })
      .then(({ value, expiresAt }) => {
        entry.state = 'resolved'
        entry.expiresAt = expiresAt
        return value
      })
      .catch((error) => {
        if (manifestMemory.get(key) === entry) manifestMemory.delete(key)
        throw error
      })
    entry.promise = request
    manifestMemory.set(key, entry)
    manifestQueue = request.catch(() => {})
    return request
  }

  function cancelPendingManifests() {
    for (const [key, entry] of manifestMemory) {
      if (entry.state !== 'pending') continue
      entry.controller.abort()
      manifestMemory.delete(key)
    }
    manifestQueue = Promise.resolve()
  }

  function clearManifests() {
    for (const entry of manifestMemory.values()) entry.controller.abort()
    manifestMemory.clear()
    manifestQueue = Promise.resolve()
    void manifestCache.clear()
  }

  function clearManifestMemory() {
    for (const entry of manifestMemory.values()) entry.controller.abort()
    manifestMemory.clear()
    manifestQueue = Promise.resolve()
  }

  function dispose() {
    cancelScheduledPreload()
    clearManifestMemory()
    visibleBarrier.resolve(false)
    foregroundBarrier.resolve(false)
    expectedPanels.clear()
    visiblePending.clear()
    foregroundPending.clear()
    visibleTokens.clear()
    preloadEntries.clear()
  }

  return {
    beginBatch,
    clearManifests,
    dispose,
    disposePanel,
    foregroundFinished,
    getManifest,
    isCurrent,
    isPanelCurrent,
    registerPreload,
    visibleFinished,
    visibleStarted,
    waitForForeground,
    waitForVisible
  }
}
