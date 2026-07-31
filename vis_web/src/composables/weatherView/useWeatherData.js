// 数据加载：世界/中国底图、manifest、槽线/急流/冷锋/涡旋 JSON，以及 SVG 图层与瓦片加载、
// 相邻预报时效预加载。全部从原 useWeatherView.js 迁出，改为读 store（含 runtime 上的加载状态）。
import { fetchJsonShared } from '../../utils/jsonRequestCache'
import { PRIORITY } from '../../utils/loadQueue'
import { sharedManifestIndexedDBCache } from '../../utils/manifestIndexedDBCache'
import { loadBaseFeatures } from '../../utils/mapBaseData'
import { COLD_FRONT_LEVELS } from './constants'
import {
  getTileZoom,
  resolveTileZoom,
  tilesForRecord,
  hasTiles,
  isTileVisible,
  isUsableLayerStatus,
  isFillLayerRecord,
  renderScaleForZoom,
  cacheSvgSource,
  loadSvgImage
} from './helpers'

// 预加载相邻预报时效的瓦片：切换预报时效是最常见的操作，提前把邻近时效的瓦片写入
// IndexedDB 可显著加快切换速度。按优先级顺序预加载：
//   n+1, n-1, n+2, n-2, n+3, n-3, n+4, n-4, n+5, n-5, n+6, n-6, n+7，共 13 个时效。
const PRELOAD_FC_HOUR_OFFSETS = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7]

export function useWeatherData(store) {
  const {
    canvasSize,
    zoomTransform,
    manifest,
    worldFeatures,
    chinaFeatures,
    activeSvgLayers,
    selectedLayerTypes,
    troughData,
    jetData,
    coldFrontData,
    vortexCenters,
    vortexTracks,
    initTime,
    fcHour,
    level,
    fcHourIndex,
    sliderFcHours,
    firstAvailableFcHour,
    layerOptions,
    layerType,
    loadingState,
    errorMessage,
    preloading,
    hoverLine,
    hoverJetLine,
    hoverVortexCenter,
    hoverVortexTrack,
    compactView,
    compactPreloadFcHours,
    multiMapLoadCoordinator,
    multiMapLoadGeneration,
    multiMapPanelId,
    syncId,
    cache,
    runtime,
    buildProjection,
    recordForLayerType,
    layerHasLoadable,
    layerUrl,
    tileUrl,
    selectedLayerHasTiles,
    setSelectedLayerTypes,
    requestDraw
  } = store

  const coordinatedMultiMap = Boolean(
    compactView && multiMapLoadCoordinator && multiMapPanelId
  )
  const isCurrentMultiMapPanel = () => (
    !coordinatedMultiMap
    || multiMapLoadCoordinator.isPanelCurrent(multiMapPanelId, multiMapLoadGeneration)
  )
  // 多图只提供分组键；全局队列按各组当前活跃数公平派发，并自动复用空闲槽位。
  // 单图不分组，仍可使用全部 8 个槽位。
  const visibleScheduling = compactView
    ? { groupKey: syncId || Symbol('compact-weather-view') }
    : {}
  const preloadScheduling = compactView
    ? { groupKey: visibleScheduling.groupKey, maxGroupConcurrent: 1 }
    : {}

  function fetchJson(url, maxAge = 30_000) {
    return fetchJsonShared(url, { maxAge })
  }

  async function fetchManifestDirect(url, signal) {
    const response = await fetch(url, { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return response.json()
  }

  async function loadWorld() {
    try {
      loadingState.map = '加载中'
      const features = await loadBaseFeatures()
      worldFeatures.value = features.world
      chinaFeatures.value = features.china
      loadingState.map = '完成'
    } catch (error) {
      loadingState.map = `失败: ${error.message}`
    } finally {
      requestDraw()
    }
  }

  function applyManifest(manifestData, preferredFcHour, fallbackFcHour) {
    manifest.value = manifestData
    loadingState.manifest = '完成'
    const manifestLevels = (manifest.value.levels || []).map(String)
    if (!manifestLevels.includes(String(level.value))) {
      const firstLevel = manifest.value.levels?.find((item) => item !== 'surface') || manifest.value.levels?.[0]
      if (firstLevel) level.value = String(firstLevel)
    }
    if (!layerOptions.value.some((item) => item.value === layerType.value)) {
      layerType.value = layerOptions.value[0]?.value || layerType.value
    }
    setSelectedLayerTypes(selectedLayerTypes.value)
    if (sliderFcHours.value.length) {
      if (preferredFcHour && sliderFcHours.value.includes(preferredFcHour)) {
        fcHour.value = preferredFcHour
      } else if (fallbackFcHour && sliderFcHours.value.includes(fallbackFcHour)) {
        fcHour.value = fallbackFcHour
      } else if (!sliderFcHours.value.includes(fcHour.value)) {
        fcHour.value = firstAvailableFcHour.value
      }
    }
  }

  async function loadCurrentForeground() {
    await loadActiveLayer()
    // 多图必须等全部子图的当前 SVG 完成后，才让天气系统 JSON 进入网络，
    // 避免先完成子图的 JSON 与仍在加载的可见 SVG 争用服务器连接。
    if (
      coordinatedMultiMap
      && (
        !await multiMapLoadCoordinator.waitForVisible(multiMapLoadGeneration)
        || !isCurrentMultiMapPanel()
      )
    ) return false
    try {
      await Promise.all([
        loadTrough(),
        loadColdFronts(),
        loadJetAxes(),
        loadVortexCenters(),
        loadVortexTracks()
      ])
    } finally {
      if (coordinatedMultiMap && isCurrentMultiMapPanel()) {
        multiMapLoadCoordinator.foregroundFinished(multiMapPanelId, multiMapLoadGeneration)
      }
      requestDraw()
    }
    return true
  }

  async function loadManifest({
    preferredFcHour = null,
    fallbackFcHour = null,
    forceRefresh = false
  } = {}) {
    errorMessage.value = ''
    manifest.value = null
    activeSvgLayers.value = []
    const manifestUrl = `/data/products/${initTime.value}/manifest.json`

    if (coordinatedMultiMap) {
      // 多图首屏按稳定路径直接请求 SVG。大体积 Manifest 直到所有当前前台资源完成后
      // 才按起报时次串行下载，避免多起报比较时多个 10MB JSON 与当前图像争用带宽。
      loadingState.manifest = '等待当前图像'
      if (!await loadCurrentForeground() || !isCurrentMultiMapPanel()) return
      if (
        !await multiMapLoadCoordinator.waitForForeground(multiMapLoadGeneration)
        || !isCurrentMultiMapPanel()
      ) return

      loadingState.manifest = '后台加载中'
      try {
        const manifestData = await multiMapLoadCoordinator.getManifest(
          initTime.value,
          (signal) => fetchManifestDirect(manifestUrl, signal)
        )
        if (!isCurrentMultiMapPanel()) return
        applyManifest(manifestData, preferredFcHour, fallbackFcHour)
        schedulePreload()
      } catch (error) {
        if (!isCurrentMultiMapPanel() || error?.name === 'AbortError') return
        loadingState.manifest = '未找到'
        errorMessage.value = `未找到 ${manifestUrl}；当前 SVG 已按固定路径直接加载。`
      } finally {
        requestDraw()
      }
      return
    }

    loadingState.manifest = '加载中'
    try {
      if (forceRefresh) await sharedManifestIndexedDBCache.delete(initTime.value)
      const persisted = forceRefresh
        ? null
        : await sharedManifestIndexedDBCache.get(initTime.value)
      const manifestData = persisted?.value
        ?? await fetchManifestDirect(manifestUrl)
      if (!persisted) void sharedManifestIndexedDBCache.put(initTime.value, manifestData)
      applyManifest(manifestData, preferredFcHour, fallbackFcHour)
    } catch (error) {
      loadingState.manifest = '未找到'
      errorMessage.value = `未找到 ${manifestUrl}；仍可查看槽线 JSON。`
    } finally {
      await loadCurrentForeground()
    }
  }

  async function loadActiveLayer() {
    const coordinatorToken = coordinatedMultiMap
      ? multiMapLoadCoordinator.visibleStarted(multiMapPanelId, multiMapLoadGeneration)
      : null
    if (coordinatedMultiMap && !coordinatorToken) return
    try {
      const loadId = ++runtime.activeLayerLoadId
      runtime.visibleTileLoadId += 1
      // 切换时效/图层时先取消上一轮预加载，把并发名额与主线程让给“当前所需”的可见瓦片；
      // 本轮可见瓦片加载完成后会在末尾重新 schedulePreload。
      cancelPreload()
      activeSvgLayers.value = []
      setSelectedLayerTypes(selectedLayerTypes.value)
      if (sliderFcHours.value.length && !sliderFcHours.value.includes(fcHour.value)) {
        fcHour.value = firstAvailableFcHour.value
      }
      const projection = buildProjection()
      const tileZoom = getTileZoom(zoomTransform.value.k, compactView, canvasSize)
      runtime.loadedTileZoom = tileZoom
      const renderScale = renderScaleForZoom(zoomTransform.value.k, compactView, canvasSize)
      runtime.loadedRenderScale = renderScale
      const candidates = selectedLayerTypes.value.map((type) => ({
        type,
        record: recordForLayerType(type)
      }))
      const loadable = candidates.filter((item) => layerHasLoadable(item.record))

      if (!loadable.length) {
        loadingState.svg = '无匹配图层'
        requestDraw()
        return
      }

      try {
        loadingState.svg = '加载中'
        const loadedLayers = new Array(loadable.length)
        const publishLayer = (order, layer) => {
          if (!layer || loadId !== runtime.activeLayerLoadId) return
          loadedLayers[order] = layer
          activeSvgLayers.value = loadedLayers.filter(Boolean)
          requestDraw()
        }
        await Promise.all(loadable.map(async (item, order) => {
          const layer = hasTiles(item.record)
            ? await loadSvgTileLayer(
              item,
              order,
              tileZoom,
              projection,
              renderScale,
              (partialLayer) => publishLayer(order, partialLayer)
            )
            : await loadSvgLayer(item, order, renderScale)
          publishLayer(order, layer)
        }))
        if (loadId !== runtime.activeLayerLoadId) return
        const missingCount = candidates.length - activeSvgLayers.value.length
        loadingState.svg = missingCount
          ? `${activeSvgLayers.value.length}层完成 / ${missingCount}层缺失`
          : `${activeSvgLayers.value.length}层完成`
        // 加载期间若布局跨过了分辨率档位，立即按最新尺寸补一次，避免保留旧尺寸位图。
        if (
          tileZoom !== getTileZoom(zoomTransform.value.k, compactView, canvasSize)
          || renderScale !== renderScaleForZoom(zoomTransform.value.k, compactView, canvasSize)
        ) {
          loadActiveLayer()
          return
        }
        schedulePreload()
      } finally {
        requestDraw()
      }
    } finally {
      if (coordinatedMultiMap) {
        multiMapLoadCoordinator.visibleFinished(
          multiMapPanelId,
          multiMapLoadGeneration,
          coordinatorToken
        )
      }
    }
  }

  async function loadSvgTileLayer(
    { type, record },
    order,
    desiredZ,
    projection,
    renderScale = 1,
    onProgress = null
  ) {
    const z = resolveTileZoom(record, desiredZ)
    if (z == null) return null

    const visibleTiles = tilesForRecord(record, z)
      .filter((tile) => isUsableLayerStatus(tile.status ?? record.status))
      .filter((tile) => tileUrl(tile))
      .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))

    if (!visibleTiles.length) return null

    const layer = {
      type,
      record,
      z,
      desiredZ,
      tiles: [],
      isFill: isFillLayerRecord(type, record),
      order
    }
    await Promise.all(visibleTiles.map(async (tile) => {
      const loadedTile = await loadSvgTile(tile, renderScale)
      if (!loadedTile) return
      layer.tiles = [...layer.tiles, loadedTile]
      onProgress?.(layer)
    }))
    const loadedTiles = layer.tiles
    if (!loadedTiles.length) return null

    return layer
  }

  async function loadVisibleTileDelta() {
    const loadId = ++runtime.visibleTileLoadId
    const projection = buildProjection()
    const desiredZ = runtime.loadedTileZoom ?? getTileZoom(zoomTransform.value.k, compactView, canvasSize)
    const renderScale = runtime.loadedRenderScale
    const additions = await Promise.all(activeSvgLayers.value.map(async (layer) => {
      if (!Array.isArray(layer.tiles) || !hasTiles(layer.record)) return null

      const z = resolveTileZoom(layer.record, desiredZ)
      if (z == null || z !== layer.z) return null

      const loadedPaths = new Set(layer.tiles.map((tile) => tile.path))
      const missingVisibleTiles = tilesForRecord(layer.record, z)
        .filter((tile) => isUsableLayerStatus(tile.status ?? layer.record.status))
        .filter((tile) => tileUrl(tile) && !loadedPaths.has(tile.path))
        .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))

      if (!missingVisibleTiles.length) return null
      const loadedTiles = (await Promise.all(missingVisibleTiles.map((tile) => loadSvgTile(tile, renderScale)))).filter(Boolean)
      return loadedTiles.length ? { layer, loadedTiles } : null
    }))

    if (loadId !== runtime.visibleTileLoadId) return

    let changed = false
    for (const item of additions.filter(Boolean)) {
      item.layer.tiles = [...item.layer.tiles, ...item.loadedTiles]
      changed = true
    }
    if (changed) requestDraw()
  }

  async function loadSvgTile(tile, renderScale = 1) {
    const url = tileUrl(tile)
    const image = await loadSvgImage(url, renderScale, PRIORITY.HIGH, null, visibleScheduling)
    if (!image) return null
    return {
      image,
      bounds: tile.bounds,
      path: tile.path,
      z: tile.z,
      x: tile.x,
      y: tile.y
    }
  }

  async function loadSvgLayer({ type, record }, order, renderScale = 1) {
    const url = layerUrl(record)
    const image = await loadSvgImage(url, renderScale, PRIORITY.HIGH, null, visibleScheduling)
    if (!image) return null
    return {
      type,
      record,
      image,
      isFill: isFillLayerRecord(type, record),
      order
    }
  }

  function neighborPreloadFcHours() {
    // 多图子图：只预取父级指定的时效（相邻页/相邻时效切换后本子图会用到的），不做 13 邻churn。
    if (compactView) {
      if (!compactPreloadFcHours || !compactPreloadFcHours.length) return []
      const hours = sliderFcHours.value
      return compactPreloadFcHours.filter((value) => (
        value && value !== fcHour.value && hours.includes(value)
      ))
    }

    const hours = sliderFcHours.value
    const index = fcHourIndex.value
    const result = []
    for (const offset of PRELOAD_FC_HOUR_OFFSETS) {
      const targetIndex = index + offset
      if (targetIndex < 0 || targetIndex >= hours.length) continue
      const targetFcHour = hours[targetIndex]
      if (targetFcHour && targetFcHour !== fcHour.value && !result.includes(targetFcHour)) {
        result.push(targetFcHour)
      }
    }
    return result
  }

  // 依据当前视窗（要素/层次/z 等级/边界）计算指定预报时效需要加载的瓦片 URL 列表。
  function collectPreloadUrls(targetFcHour) {
    if (!manifest.value) return []
    const projection = buildProjection()
    const desiredZ = runtime.loadedTileZoom ?? getTileZoom(zoomTransform.value.k, compactView, canvasSize)
    const urls = []

    for (const type of selectedLayerTypes.value) {
      const record = manifest.value?.products?.[targetFcHour]?.[level.value]?.[type]
      if (!layerHasLoadable(record)) continue

      if (hasTiles(record)) {
        const z = resolveTileZoom(record, desiredZ)
        if (z == null) continue
        const tiles = tilesForRecord(record, z)
          .filter((tile) => isUsableLayerStatus(tile.status ?? record.status))
          .filter((tile) => tileUrl(tile))
          .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))
        for (const tile of tiles) urls.push(tileUrl(tile))
      } else {
        const url = layerUrl(record)
        if (url) urls.push(url)
      }
    }

    return urls
  }

  // 逐个预报时效、逐张瓦片地预加载；预加载前先判断 IndexedDB 是否已存在，存在则跳过。
  async function preloadNeighborForecasts() {
    if (!manifest.value) return
    const runId = ++runtime.preloadRunId
    const targets = neighborPreloadFcHours()
    if (!targets.length) return

    // 每轮预加载独立的取消令牌：新一轮或卸载时 abort，丢弃尚未开始的预加载任务，
    // 及时把并发名额让给切换后“当前所需”的可见瓦片。
    const controller = new AbortController()
    runtime.preloadAbortController = controller
    const { signal } = controller

    preloading.value = true
    try {
      for (const targetFcHour of targets) {
        if (runId !== runtime.preloadRunId || signal.aborted) return
        const urls = collectPreloadUrls(targetFcHour)
        // 同一时效的瓦片并行预取（受全局限流器 LOW 名额约束），逐时效推进以保持“近邻优先”，
        // 使单图模式下相邻时效能像改动前那样迅速预热，而不是逐张串行地慢慢加载。
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(urls.map(async (url) => {
          if (runId !== runtime.preloadRunId || signal.aborted) return
          if (await cache.has(url)) return
          await cacheSvgSource(url, PRIORITY.LOW, signal, preloadScheduling)
        }))
      }
    } catch (error) {
      // 预加载是后台优化任务；时效、图层或缩放变化时主动 abort 属于正常控制流。
      // 这里必须消费该拒绝，否则定时器启动的 async 任务会在控制台留下未捕获 Promise。
      if (!signal.aborted && error?.name !== 'AbortError') {
        console.warn('相邻预报时效预加载失败', error)
      }
    } finally {
      // 仅当自己仍是最新的预加载任务时才关闭标识，避免被后启动的任务提前清除。
      if (runId === runtime.preloadRunId) {
        preloading.value = false
        if (runtime.preloadAbortController === controller) runtime.preloadAbortController = null
      }
    }
  }

  // 取消当前进行中的预加载：中止尚未开始的任务并令运行号失效。切换时效/图层、卸载时调用。
  function cancelPreload() {
    runtime.preloadRunId += 1
    if (runtime.preloadTimer) {
      clearTimeout(runtime.preloadTimer)
      runtime.preloadTimer = null
    }
    if (runtime.preloadAbortController) {
      runtime.preloadAbortController.abort()
      runtime.preloadAbortController = null
    }
  }

  // 在当前时效瓦片加载完毕后调度预加载；用延时+运行号确保不阻塞渲染且旧任务可被取消。
  function schedulePreload() {
    if (coordinatedMultiMap) {
      if (!manifest.value) return
      multiMapLoadCoordinator.registerPreload(
        multiMapPanelId,
        multiMapLoadGeneration,
        { run: preloadNeighborForecasts, cancel: cancelPreload }
      )
      return
    }
    cancelPreload()
    runtime.preloadTimer = setTimeout(() => {
      runtime.preloadTimer = null
      void preloadNeighborForecasts()
    }, 400)
  }

  async function loadTrough() {
    const loadId = ++runtime.troughLoadId
    troughData.value = null
    hoverLine.value = null
    if (level.value === 'surface') {
      loadingState.trough = '地面层无槽线'
      requestDraw()
      return
    }

    const url = `/data/${initTime.value}/trough_data/trough_${initTime.value}_${fcHour.value}_${level.value}hPa_ecmwf.json`
    try {
      loadingState.trough = '加载中'
      const data = await fetchJson(url)
      if (loadId !== runtime.troughLoadId) return
      troughData.value = data
      loadingState.trough = '完成'
    } catch {
      if (loadId !== runtime.troughLoadId) return
      loadingState.trough = '缺失'
    } finally {
      if (loadId === runtime.troughLoadId) requestDraw()
    }
  }

  async function loadJetAxes() {
    const loadId = ++runtime.jetLoadId
    jetData.value = null
    hoverJetLine.value = null
    if (level.value === 'surface') {
      loadingState.jet = '地面层无急流轴'
      requestDraw()
      return
    }

    const url = `/data/${initTime.value}/jet_data/jet_${initTime.value}_${fcHour.value}_${level.value}hPa_ecmwf.json`
    try {
      loadingState.jet = '加载中'
      const data = await fetchJson(url)
      if (loadId !== runtime.jetLoadId) return
      jetData.value = data
      loadingState.jet = '完成'
    } catch {
      if (loadId !== runtime.jetLoadId) return
      loadingState.jet = '缺失'
    } finally {
      if (loadId === runtime.jetLoadId) requestDraw()
    }
  }

  async function loadColdFronts() {
    const loadId = ++runtime.coldFrontLoadId
    coldFrontData.value = null
    if (!COLD_FRONT_LEVELS.has(String(level.value))) {
      loadingState.coldFront = '该层无冷锋产品'
      requestDraw()
      return
    }

    const url = `/data/${initTime.value}/cold_fronts/cold_front_${initTime.value}_${fcHour.value}_${level.value}hPa.json`
    try {
      loadingState.coldFront = '加载中'
      const data = await fetchJson(url)
      if (loadId !== runtime.coldFrontLoadId) return
      coldFrontData.value = data
      loadingState.coldFront = '完成'
    } catch {
      if (loadId !== runtime.coldFrontLoadId) return
      loadingState.coldFront = '缺失'
    } finally {
      if (loadId === runtime.coldFrontLoadId) requestDraw()
    }
  }

  async function loadVortexCenters() {
    const loadId = ++runtime.vortexCentersLoadId
    vortexCenters.value = []
    hoverVortexCenter.value = null
    if (level.value === 'surface') {
      loadingState.vortexCenters = '地面层无中心'
      requestDraw()
      return
    }

    const centerUrl = `/data/${initTime.value}/vortex_centers/vortex_center_${initTime.value}_${fcHour.value}_${level.value}hPa.json`
    const warmUrl = `/data/${initTime.value}/vortex_warm_core/vortex_warm_core_${initTime.value}_${fcHour.value}_850hPa.json`
    try {
      loadingState.vortexCenters = '加载中'
      const centers = await fetchJson(centerUrl)
      if (loadId !== runtime.vortexCentersLoadId) return

      if (String(level.value) === '850') {
        try {
          const warmCenters = await fetchJson(warmUrl)
          if (loadId !== runtime.vortexCentersLoadId) return
          const warmByPosition = new Map(
            warmCenters.map((center) => [`${Number(center.lat).toFixed(4)}:${Number(center.lon).toFixed(4)}`, center])
          )
          vortexCenters.value = centers.map((center) => ({
            ...center,
            ...(warmByPosition.get(`${Number(center.lat).toFixed(4)}:${Number(center.lon).toFixed(4)}`) || {})
          }))
        } catch {
          if (loadId !== runtime.vortexCentersLoadId) return
          vortexCenters.value = centers
        }
      } else {
        vortexCenters.value = centers
      }

      loadingState.vortexCenters = '完成'
    } catch {
      if (loadId !== runtime.vortexCentersLoadId) return
      loadingState.vortexCenters = '缺失'
    } finally {
      if (loadId === runtime.vortexCentersLoadId) requestDraw()
    }
  }

  async function loadVortexTracks() {
    vortexTracks.value = null
    hoverVortexTrack.value = null
    const url = `/data/${initTime.value}/vortex_tracks/tc_tracking_results_processed_${initTime.value}.json`
    try {
      loadingState.vortexTracks = '加载中'
      vortexTracks.value = await fetchJson(url)
      loadingState.vortexTracks = '完成'
    } catch {
      loadingState.vortexTracks = '缺失'
    } finally {
      requestDraw()
    }
  }

  return {
    fetchJson,
    loadWorld,
    loadManifest,
    loadActiveLayer,
    loadVisibleTileDelta,
    cancelPreload,
    schedulePreload,
    loadTrough,
    loadJetAxes,
    loadColdFronts,
    loadVortexCenters,
    loadVortexTracks
  }
}
