// 投影与视图变换：默认视图、地图视图存取（保存/应用/删除）、多图同步缩放、
// 画布尺寸变化时保持中央经纬度、光标广播。均从原 useWeatherView.js 原样迁出并改为读 store。
import * as d3 from 'd3'

import { DEFAULT_MAP_CENTER, DEFAULT_MAP_SCALE, MAP_VIEW_STORAGE_KEY } from './constants'

export function useMapProjection(store) {
  const {
    canvasRef,
    canvasSize,
    zoomTransform,
    savedMapViews,
    syncState,
    syncId,
    runtime,
    buildProjection,
    requestDraw
  } = store

  function defaultMapTransform() {
    const projection = buildProjection()
    const projectedCenter = projection(DEFAULT_MAP_CENTER)
    if (!projectedCenter) return d3.zoomIdentity

    return d3.zoomIdentity
      .translate(
        (canvasSize.width / 2) - (projectedCenter[0] * DEFAULT_MAP_SCALE),
        (canvasSize.height / 2) - (projectedCenter[1] * DEFAULT_MAP_SCALE)
      )
      .scale(DEFAULT_MAP_SCALE)
  }

  function applyDefaultView(animate = false) {
    const nextTransform = defaultMapTransform()
    zoomTransform.value = nextTransform

    if (canvasRef.value && runtime.zoomBehavior) {
      const selection = d3.select(canvasRef.value)
      const target = animate ? selection.transition().duration(160) : selection
      target.call(runtime.zoomBehavior.transform, nextTransform)
    }
  }

  function persistSavedMapViews() {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(savedMapViews.value))
    } catch {
      // 忽略持久化失败（如隐私模式），当前会话仍可继续使用。
    }
  }

  function currentMapViewSnapshot() {
    const transform = zoomTransform.value
    const k = Number(transform?.k)
    if (!Number.isFinite(k)) return null

    const viewportCenter = transform.invert([canvasSize.width / 2, canvasSize.height / 2])
    const center = buildProjection().invert(viewportCenter)
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null
    return { center: [center[0], center[1]], k }
  }

  function saveMapView(name) {
    const label = String(name || '').trim()
    const snapshot = currentMapViewSnapshot()
    if (!label || !snapshot) return false

    const record = { name: label, ...snapshot }
    const existingIndex = savedMapViews.value.findIndex((view) => view.name === label)
    if (existingIndex >= 0) savedMapViews.value.splice(existingIndex, 1, record)
    else savedMapViews.value.push(record)
    persistSavedMapViews()
    return true
  }

  function applyMapView(view) {
    const nextTransform = transformFromSync(view)
    if (!nextTransform || !runtime.zoomBehavior || !canvasRef.value) return false

    runtime.applyingSynchronizedZoom = true
    try {
      d3.select(canvasRef.value).call(runtime.zoomBehavior.transform, nextTransform)
      return true
    } finally {
      runtime.applyingSynchronizedZoom = false
    }
  }

  function deleteMapView(name) {
    const next = savedMapViews.value.filter((view) => view.name !== name)
    if (next.length === savedMapViews.value.length) return
    savedMapViews.value = next
    persistSavedMapViews()
  }

  function transformFromSync(snapshot) {
    const k = Number(snapshot?.k)
    const center = Array.isArray(snapshot?.center) ? snapshot.center.map(Number) : []
    if (!Number.isFinite(k)) return null

    if (center.length === 2 && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      const projectedCenter = buildProjection()(center)
      if (!projectedCenter) return null
      return d3.zoomIdentity
        .translate((canvasSize.width / 2) - (projectedCenter[0] * k), (canvasSize.height / 2) - (projectedCenter[1] * k))
        .scale(k)
    }

    const x = Number(snapshot?.x)
    const y = Number(snapshot?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return d3.zoomIdentity.translate(x, y).scale(k)
  }

  function applySynchronizedZoom(snapshot) {
    if (!runtime.zoomBehavior || !canvasRef.value) return
    const nextTransform = transformFromSync(snapshot)
    if (!nextTransform) return

    const current = zoomTransform.value
    if (current.x === nextTransform.x && current.y === nextTransform.y && current.k === nextTransform.k) return

    runtime.applyingSynchronizedZoom = true
    try {
      d3.select(canvasRef.value).call(runtime.zoomBehavior.transform, nextTransform)
    } finally {
      runtime.applyingSynchronizedZoom = false
    }
  }

  function broadcastCursor(geo) {
    if (!syncState || !syncId) return
    syncState.cursor = geo
      ? { lon: geo.lon, lat: geo.lat, source: syncId }
      : null
  }

  function resizeCanvas() {
    const element = store.shellRef.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const nextWidth = Math.max(store.minCanvasWidth, Math.floor(rect.width))
    const nextHeight = Math.max(store.minCanvasHeight, Math.floor(rect.height))
    const sizeChanged = canvasSize.width !== nextWidth || canvasSize.height !== nextHeight

    // 画布尺寸变化前先记录当前视窗中心的经纬度：投影用 fitExtent(canvasSize) 构建，
    // 尺寸一变投影就变，而 zoomTransform 的平移量不变，会导致视窗中央对应的经纬度发生偏移
    // （例如隐藏左侧面板使画布变宽时）。先取旧中心，再在新尺寸下重建 transform 使其保持不变。
    const previousCenter = sizeChanged ? currentMapViewSnapshot() : null

    canvasSize.width = nextWidth
    canvasSize.height = nextHeight

    if (sizeChanged) {
      if (transformFromSync(syncState?.zoom)) {
        applySynchronizedZoom(syncState.zoom)
      } else if (previousCenter) {
        // 单图（无多图联动）时，按记录的中心经纬度在新画布尺寸下重建 transform，保持中央经纬度不变。
        applySynchronizedZoom(previousCenter)
      }
    }
    requestDraw()
  }

  function resetView() {
    applyDefaultView(true)
    requestDraw()
  }

  return {
    defaultMapTransform,
    applyDefaultView,
    persistSavedMapViews,
    currentMapViewSnapshot,
    saveMapView,
    applyMapView,
    deleteMapView,
    transformFromSync,
    applySynchronizedZoom,
    broadcastCursor,
    resizeCanvas,
    resetView
  }
}
