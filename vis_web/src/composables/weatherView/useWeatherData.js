// 数据加载：世界/中国底图、manifest、槽线/急流/冷锋/涡旋 JSON，以及 SVG 图层与瓦片加载、
// 相邻预报时效预加载。全部从原 useWeatherView.js 迁出，改为读 store（含 runtime 上的加载状态）。
import { feature } from 'topojson-client'

import worldTopo from '../../source/110m.json'
import chinaTopo from '../../source/bou2_4l.topo.simplify.json'
import { fetchJsonShared } from '../../utils/jsonRequestCache'
import { PRIORITY } from '../../utils/loadQueue'
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

// TopoJSON 转 GeoJSON 是纯计算且结果只读，所有单图/子图共享一次转换结果。
let sharedBaseFeatures = null

function baseFeatures() {
  if (!sharedBaseFeatures) {
    sharedBaseFeatures = {
      world: feature(worldTopo, worldTopo.objects.land),
      china: feature(chinaTopo, chinaTopo.objects.bou2_4l)
    }
  }
  return sharedBaseFeatures
}

export function useWeatherData(store) {
  const {
    initialView,
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
    manifestFcHourSet,
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

  const compactVisibleConcurrency = Math.max(1, Number(initialView?.maxLoadConcurrent) || 1)
  // 多图中按父级分配的预算限制单个子图占用，避免先挂载的子图吃满全局队列。
  // 单图不分组，仍可使用全部 8 个槽位。
  const visibleScheduling = compactView
    ? { groupKey: syncId || Symbol('compact-weather-view'), maxGroupConcurrent: compactVisibleConcurrency }
    : {}
  const preloadScheduling = compactView
    ? { groupKey: visibleScheduling.groupKey, maxGroupConcurrent: 1 }
    : {}

  function fetchJson(url, maxAge = 30_000) {
    return fetchJsonShared(url, { maxAge })
  }

  function loadWorld() {
    try {
      loadingState.map = '加载中'
      const features = baseFeatures()
      worldFeatures.value = features.world
      chinaFeatures.value = features.china
      loadingState.map = '完成'
    } catch (error) {
      loadingState.map = `失败: ${error.message}`
    } finally {
      requestDraw()
    }
  }

  async function loadManifest() {
    errorMessage.value = ''
    manifest.value = null
    activeSvgLayers.value = []
    loadingState.manifest = '加载中'

    try {
      // Manifest 仍由 SW 网络优先；这里只在同一批子图挂载期间短暂合并请求。
      manifest.value = await fetchJson(`/data/products/${initTime.value}/manifest.json`, 2_000)
      loadingState.manifest = '完成'
      const manifestLevels = (manifest.value.levels || []).map(String)
      if (manifestFcHourSet.value && !manifestFcHourSet.value.has(fcHour.value)) {
        fcHour.value = firstAvailableFcHour.value
      }
      if (!manifestLevels.includes(String(level.value))) {
        const firstLevel = manifest.value.levels?.find((item) => item !== 'surface') || manifest.value.levels?.[0]
        if (firstLevel) level.value = String(firstLevel)
      }
      if (!layerOptions.value.some((item) => item.value === layerType.value)) {
        layerType.value = layerOptions.value[0]?.value || layerType.value
      }
      setSelectedLayerTypes(selectedLayerTypes.value)
    } catch (error) {
      loadingState.manifest = '未找到'
      errorMessage.value = `未找到 /data/products/${initTime.value}/manifest.json；仍可查看槽线 JSON。`
    } finally {
      // 先完成用户最关心的 SVG，再并行补齐天气系统 JSON。原先逐项 await 会让每个
      // 子图连续经历 5 次网络往返，多图下形成明显的阶梯式完成。
      await loadActiveLayer()
      await Promise.all([
        loadTrough(),
        loadColdFronts(),
        loadJetAxes(),
        loadVortexCenters(),
        loadVortexTracks()
      ])
      requestDraw()
    }
  }

  async function loadActiveLayer() {
    const loadId = ++runtime.activeLayerLoadId
    runtime.visibleTileLoadId += 1
    // 切换时效/图层时先取消上一轮预加载，把并发名额与主线程让给“当前所需”的可见瓦片；
    // 本轮可见瓦片加载完成后会在末尾重新 schedulePreload。
    cancelPreload()
    activeSvgLayers.value = []
    setSelectedLayerTypes(selectedLayerTypes.value)
    const projection = buildProjection()
    const tileZoom = getTileZoom(zoomTransform.value.k)
    runtime.loadedTileZoom = tileZoom
    const renderScale = renderScaleForZoom(zoomTransform.value.k, compactView)
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
      const loadedLayers = await Promise.all(loadable.map((item, order) => (
        hasTiles(item.record)
          ? loadSvgTileLayer(item, order, tileZoom, projection, renderScale)
          : loadSvgLayer(item, order, renderScale)
      )))
      if (loadId !== runtime.activeLayerLoadId) return
      activeSvgLayers.value = loadedLayers.filter(Boolean)
      const missingCount = candidates.length - activeSvgLayers.value.length
      loadingState.svg = missingCount
        ? `${activeSvgLayers.value.length}层完成 / ${missingCount}层缺失`
        : `${activeSvgLayers.value.length}层完成`
      schedulePreload()
    } finally {
      requestDraw()
    }
  }

  async function loadSvgTileLayer({ type, record }, order, desiredZ, projection, renderScale = 1) {
    const z = resolveTileZoom(record, desiredZ)
    if (z == null) return null

    const visibleTiles = tilesForRecord(record, z)
      .filter((tile) => isUsableLayerStatus(tile.status ?? record.status))
      .filter((tile) => tileUrl(tile))
      .filter((tile) => isTileVisible(tile, projection, canvasSize, zoomTransform.value))

    if (!visibleTiles.length) return null

    const loadedTiles = (await Promise.all(visibleTiles.map((tile) => loadSvgTile(tile, renderScale)))).filter(Boolean)
    if (!loadedTiles.length) return null

    return {
      type,
      record,
      z,
      desiredZ,
      tiles: loadedTiles,
      isFill: isFillLayerRecord(type, record),
      order
    }
  }

  async function loadVisibleTileDelta() {
    const loadId = ++runtime.visibleTileLoadId
    const projection = buildProjection()
    const desiredZ = runtime.loadedTileZoom ?? getTileZoom(zoomTransform.value.k)
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
    const desiredZ = runtime.loadedTileZoom ?? getTileZoom(zoomTransform.value.k)
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
    cancelPreload()
    runtime.preloadTimer = setTimeout(() => {
      runtime.preloadTimer = null
      preloadNeighborForecasts()
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
