import * as d3 from 'd3'
import { nextTick, onMounted, onUnmounted, watch } from 'vue'

import { calLatestBaseTime } from '../utils/initTime'
import { LAYER_TYPE_OPTIONS } from '../utils/elementSelectorConfig'
import {
  DEFAULT_FC_HOURS,
  DRAW_TOOLS,
  SHEAR_COLORS,
  projectionOptions,
  systemTabs,
  troughShearOptions,
  multiMapModeOptions,
  multiForecastIntervalOptions,
  multiForecastPanelCountOptions,
  multiInitIntervalOptions,
  multiInitPanelCountOptions,
  multiElementPanelCountOptions,
  sliderOpts
} from './weatherView/constants'
import {
  formatNumber,
  normalizeFcHour,
  parseInitTime,
  formatInitTime,
  getTileZoom,
  renderScaleForZoom
} from './weatherView/helpers'
import { createWeatherViewStore } from './weatherView/useWeatherViewState'
import { useMapProjection } from './weatherView/useMapProjection'
import { useWeatherData } from './weatherView/useWeatherData'
import { useMapRenderer } from './weatherView/useMapRenderer'
import { useMapDrawings } from './weatherView/useMapDrawings'
import { useMultiMap } from './weatherView/useMultiMap'
import { useElementConfig } from './weatherView/useElementConfig'
import { useMultiMapPopup } from './useMultiMapPopup'

// 天气可视化主 composable：装配核心 store 与各行为模块，集中 watch 与生命周期，
// 返回与拆分前完全一致的 context（供各组件通过 provide/inject 消费）。
export function useWeatherView(initialView = {}) {
  const store = createWeatherViewStore(initialView)

  const {
    runtime,
    syncState,
    syncId,
    compactView,
    multiMapLoadCoordinator,
    multiMapLoadGeneration,
    multiMapPanelId,
    canvasRef,
    shellRef,
    canvasSize,
    zoomTransform,
    activeSvgLayers,
    initTime,
    fcHour,
    level,
    selectedLayerTypes,
    projectionName,
    multiMapMode,
    multiMapSyncState,
    multiInitInterval,
    multiInitPanelCount,
    multiForecastInterval,
    multiForecastPanelCount,
    multiElementPanelCount,
    showControlRail,
    drawMode,
    showSvgLayer,
    showTrough,
    showColdFronts,
    showJetAxes,
    showRawPoints,
    showVortexCenters,
    showVortexTracks,
    showWarmOnlyTracks,
    showWarmOnlyCenters,
    showTooltip,
    showTileDebug,
    showGraticule,
    troughMinLength,
    troughMinWindSpeed,
    troughLineWidth,
    jetMinAxisLength,
    jetMinAvgWindSpeed,
    jetMinMaxWindSpeed,
    jetLineWidth,
    showJetArrowHeads,
    vortexMinWindSpeed,
    vortexMinVorticity,
    vortexTrackMinWindSpeed,
    showFutureVortexTracks,
    showOnlyFutureVortexTracks,
    showOnlyActiveVortexTracks,
    troughShearFilters,
    selectedLayerHasTiles,
    buildProjection,
    requestDraw
  } = store

  const projection = useMapProjection(store)
  // 多图描述符在切换模式时需要读取单图当前视角；挂到 store 可避免模块间构造顺序耦合。
  store.currentMapViewSnapshot = projection.currentMapViewSnapshot
  const data = useWeatherData(store)
  const renderer = useMapRenderer(store)
  const drawings = useMapDrawings(store)
  const multiMap = useMultiMap(store)
  const elementConfig = useElementConfig(store)

  // 跨模块函数挂到 store，供其它模块在运行期调用（打破构造期顺序依赖）。
  store.drawMap = renderer.drawMap
  store.drawDrawings = drawings.drawDrawings
  store.findShapeIndexNear = drawings.findShapeIndexNear
  store.broadcastCursor = projection.broadcastCursor

  const { applySynchronizedZoom, transformFromSync, applyDefaultView, resizeCanvas } = projection
  const { loadWorld, loadManifest, loadActiveLayer, loadVisibleTileDelta, loadTrough, loadColdFronts, loadJetAxes, loadVortexCenters, cancelPreload } = data
  const { handleMouseMove, handleMouseLeave, clearHoverState } = renderer
  const { handleDrawKeydown } = drawings
  const { openMultiMap } = multiMap

  const multiMapPopup = useMultiMapPopup({
    applyInitAndFcHour,
    initTime,
    fcHour,
    level,
    selectedLayerTypes,
    projectionName,
    zoomTransform,
    multiMapMode,
    multiMapSyncState,
    multiMapModeOptions,
    multiInitInterval,
    multiInitPanelCount,
    multiForecastInterval,
    multiForecastPanelCount,
    multiElementPanelCount,
    openMultiMap,
    mapViewSnapshot: projection.currentMapViewSnapshot,
    systemControls: {
      showSvgLayer,
      showTrough,
      showColdFronts,
      showJetAxes,
      showRawPoints,
      showVortexCenters,
      showVortexTracks,
      showWarmOnlyTracks,
      showWarmOnlyCenters,
      showTooltip,
      showTileDebug,
      showGraticule,
      troughMinLength,
      troughMinWindSpeed,
      troughLineWidth,
      jetMinAxisLength,
      jetMinAvgWindSpeed,
      jetMinMaxWindSpeed,
      jetLineWidth,
      showJetArrowHeads,
      vortexMinWindSpeed,
      vortexMinVorticity,
      vortexTrackMinWindSpeed,
      showFutureVortexTracks,
      showOnlyFutureVortexTracks,
      showOnlyActiveVortexTracks
    }
  })

  // 切换起报时次时优先保持有效时间不变。新起报缺少对应时效时，保留原预报时效。
  function applyInitTime(nextInitTime, { forceManifest = false } = {}) {
    const next = String(nextInitTime || '').trim()
    const currentDate = parseInitTime(initTime.value)
    const nextDate = parseInitTime(next)
    if (!currentDate || !nextDate) return false

    const currentFcHour = normalizeFcHour(fcHour.value)
    const targetFcHour = Number(currentFcHour) - ((nextDate.getTime() - currentDate.getTime()) / (60 * 60 * 1000))
    const preferredFcHour = Number.isFinite(targetFcHour) && targetFcHour >= 0
      ? normalizeFcHour(targetFcHour)
      : null

    initTime.value = next
    loadManifest({
      preferredFcHour,
      fallbackFcHour: currentFcHour,
      ...(forceManifest ? { forceRefresh: true } : {})
    })
    return true
  }

  // —— 起报时次导航（需触发 loadManifest）——
  function shiftInitTime(deltaHours) {
    const date = parseInitTime(initTime.value)
    if (!date) return

    const next = new Date(date.getTime() + deltaHours * 60 * 60 * 1000)
    applyInitTime(formatInitTime(next))
  }

  // 点击“刷新”时重新对齐到最新起报时次（含后端绘图滞后一小时的补偿），再重新加载。
  function refreshToLatest() {
    applyInitTime(calLatestBaseTime(), { forceManifest: true })
  }

  // 多时次选择器：同时指定起报时次与预报时效并重新加载。
  // 先同步更新 fcHour 与 initTime（界面即时反映），loadManifest 会在获取到
  // 新起报的 manifest 后按已设好的 fcHour 加载对应要素/天气系统数据。
  function applyInitAndFcHour(initTimeStr, fcHourStr) {
    const nextInitTime = String(initTimeStr || '').trim()
    if (!parseInitTime(nextInitTime)) return

    if (fcHourStr != null && fcHourStr !== '') {
      fcHour.value = normalizeFcHour(fcHourStr)
    }
    initTime.value = nextInitTime
    loadManifest()
  }

  // 左侧面板显隐会改变工作区宽度：等 DOM/布局更新后显式重算画布尺寸并重绘，
  // 不完全依赖 ResizeObserver（display:none/网格列收起时其触发不稳定）。
  watch(showControlRail, () => {
    nextTick(() => requestAnimationFrame(resizeCanvas))
  })

  watch(
    () => syncState?.zoom,
    (snapshot) => {
      if (snapshot?.source === syncId) return
      applySynchronizedZoom(snapshot)
    }
  )

  watch(
    () => syncState?.cursor,
    () => requestDraw()
  )

  watch([
    multiMapMode,
    initTime,
    fcHour,
    level,
    selectedLayerTypes,
    multiInitInterval,
    multiInitPanelCount,
    multiForecastInterval,
    multiForecastPanelCount,
    multiElementPanelCount
  ], () => {
    if (multiMapMode.value) openMultiMap(multiMapMode.value)
  }, { deep: true })

  // 连续快速切换预报时效（拖动滑块/滚轮/连点箭头）时，用去抖合并这些变化：
  // 仅在停止后加载“最终时效”的图层与天气系统，跳过中间时效的加载与渲染，
  // 消除天气系统显示慢半拍的问题。JSON 加载器内另有 loadId 防过期守卫作为兜底。
  watch([fcHour, level], () => {
    if (runtime.fcReloadTimer) clearTimeout(runtime.fcReloadTimer)
    runtime.fcReloadTimer = setTimeout(async () => {
      runtime.fcReloadTimer = null
      await loadActiveLayer()
      await loadTrough()
      await loadColdFronts()
      await loadJetAxes()
      await loadVortexCenters()
    }, 150)
  })

  watch(selectedLayerTypes, async () => {
    await loadActiveLayer()
  }, { deep: true })

  watch(projectionName, async () => {
    await loadActiveLayer()
  })

  // 多图子画布跨过分辨率档位时才重新栅格化 SVG。同一档内的布局变化只触发 canvas
  // 重绘；短去抖用于合并窗口拖动和网格重排产生的一串 ResizeObserver 回调。
  watch(
    () => [canvasSize.width, canvasSize.height],
    () => {
      if (!compactView || !activeSvgLayers.value.length) return
      const nextTileZoom = getTileZoom(zoomTransform.value.k, true, canvasSize)
      const nextRenderScale = renderScaleForZoom(zoomTransform.value.k, true, canvasSize)
      if (nextTileZoom === runtime.loadedTileZoom && nextRenderScale === runtime.loadedRenderScale) return
      if (runtime.resolutionReloadTimer) clearTimeout(runtime.resolutionReloadTimer)
      runtime.resolutionReloadTimer = setTimeout(() => {
        runtime.resolutionReloadTimer = null
        loadActiveLayer()
      }, 120)
    }
  )

  watch([
    showSvgLayer,
    showTrough,
    showColdFronts,
    showJetAxes,
    showRawPoints,
    showVortexCenters,
    showVortexTracks,
    showWarmOnlyTracks,
    showWarmOnlyCenters,
    showTooltip,
    showTileDebug,
    showGraticule,
    troughMinLength,
    troughMinWindSpeed,
    troughLineWidth,
    jetMinAxisLength,
    jetMinAvgWindSpeed,
    jetMinMaxWindSpeed,
    jetLineWidth,
    showJetArrowHeads,
    vortexMinWindSpeed,
    vortexMinVorticity,
    vortexTrackMinWindSpeed,
    showFutureVortexTracks,
    showOnlyFutureVortexTracks,
    showOnlyActiveVortexTracks
  ], () => {
    clearHoverState()
    requestDraw()
  })

  watch(troughShearFilters, () => {
    clearHoverState()
    requestDraw()
  }, { deep: true })

  let resizeObserver = null

  onMounted(async () => {
    await nextTick()
    resizeObserver = new ResizeObserver(resizeCanvas)
    if (shellRef.value) resizeObserver.observe(shellRef.value)

    runtime.zoomBehavior = d3.zoom()
      .scaleExtent([0.6, 40])
      .filter((event) => {
        // 绘图模式下屏蔽鼠标拖拽/双击引发的平移与缩放，仅保留滚轮缩放，避免与绘图冲突。
        if (drawMode.value && event.type !== 'wheel') return false
        return (!event.ctrlKey || event.type === 'wheel') && !event.button
      })
      .on('zoom', (event) => {
        zoomTransform.value = event.transform
        if (syncState && syncId && !runtime.applyingSynchronizedZoom) {
          const projectionInstance = buildProjection()
          const viewportCenter = event.transform.invert([canvasSize.width / 2, canvasSize.height / 2])
          const center = projectionInstance.invert(viewportCenter)
          syncState.zoom = {
            x: event.transform.x,
            y: event.transform.y,
            k: event.transform.k,
            center: center && Number.isFinite(center[0]) && Number.isFinite(center[1])
              ? [center[0], center[1]]
              : null,
            source: syncId
          }
        }
        const nextTileZoom = getTileZoom(event.transform.k, compactView, canvasSize)
        const nextRenderScale = renderScaleForZoom(event.transform.k, compactView, canvasSize)
        const tileZoomChanged = selectedLayerHasTiles() && nextTileZoom !== runtime.loadedTileZoom
        const renderScaleChanged = nextRenderScale !== runtime.loadedRenderScale && activeSvgLayers.value.length > 0
        if (tileZoomChanged || renderScaleChanged) {
          loadActiveLayer()
        } else if (selectedLayerHasTiles()) {
          loadVisibleTileDelta()
        }
        requestDraw()
      })

    d3.select(canvasRef.value).call(runtime.zoomBehavior)
    window.addEventListener('keydown', handleDrawKeydown)
    resizeCanvas()
    if (transformFromSync(syncState?.zoom)) {
      applySynchronizedZoom(syncState.zoom)
    } else {
      applyDefaultView()
    }
    await Promise.all([loadWorld(), loadManifest()])
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
    window.removeEventListener('keydown', handleDrawKeydown)
    // 卸载（含多图切换页导致子图 remount）时取消预加载，中止在途预取、释放并发名额。
    cancelPreload()
    multiMapLoadCoordinator?.disposePanel(multiMapPanelId, multiMapLoadGeneration)
    if (runtime.fcReloadTimer) {
      clearTimeout(runtime.fcReloadTimer)
      runtime.fcReloadTimer = null
    }
    if (runtime.resolutionReloadTimer) {
      clearTimeout(runtime.resolutionReloadTimer)
      runtime.resolutionReloadTimer = null
    }
    if (canvasRef.value) d3.select(canvasRef.value).on('.zoom', null)
  })

  const context = {
    activeSystemTab: store.activeSystemTab,
    applyInitAndFcHour,
    applyInitTime,
    applyMapView: projection.applyMapView,
    DEFAULT_FC_HOURS,
    canvasRef,
    changeFcHour: store.changeFcHour,
    fcHour,
    fcHourIndex: store.fcHourIndex,
    fcHourOptions: store.fcHourOptions,
    DRAW_TOOLS,
    drawMode,
    activeDrawTool: store.activeDrawTool,
    setDrawTool: drawings.setDrawTool,
    exitDrawMode: drawings.exitDrawMode,
    finishCurrentLine: drawings.finishCurrentLine,
    undoDrawing: drawings.undoDrawing,
    clearDrawings: drawings.clearDrawings,
    closeMultiMap: multiMap.closeMultiMap,
    hasDrawings: drawings.hasDrawings,
    draftPointCount: drawings.draftPointCount,
    handleCanvasPointerDown: drawings.handleCanvasPointerDown,
    handleCanvasPointerUp: drawings.handleCanvasPointerUp,
    handleCanvasClick: drawings.handleCanvasClick,
    handleCanvasDblClick: drawings.handleCanvasDblClick,
    handleCanvasContextMenu: drawings.handleCanvasContextMenu,
    forecastValidTimeLabel: store.forecastValidTimeLabel,
    forecastValidTimeBjtLabel: store.forecastValidTimeBjtLabel,
    formatNumber,
    getSliderTooltip: store.getSliderTooltip,
    handleMouseLeave,
    handleMouseMove,
    handleLayerTypeChange: elementConfig.handleLayerTypeChange,
    hoverJetLine: store.hoverJetLine,
    hoverLine: store.hoverLine,
    hoverVortexCenter: store.hoverVortexCenter,
    hoverVortexTrack: store.hoverVortexTrack,
    initTime,
    isVortexTrackLevel: store.isVortexTrackLevel,
    jetLineWidth,
    jetMinAvgWindSpeed,
    jetMinAxisLength,
    jetMinMaxWindSpeed,
    activeLayerCombinationName: store.activeLayerCombinationName,
    applyLayerCombination: elementConfig.applyLayerCombination,
    deleteLayerCombination: elementConfig.deleteLayerCombination,
    deleteMapView: projection.deleteMapView,
    activeMultiElementConfigurationName: store.activeMultiElementConfigurationName,
    applyMultiElementConfiguration: multiMap.applyMultiElementConfiguration,
    deleteMultiElementConfiguration: multiMap.deleteMultiElementConfiguration,
    createMultiElementConfiguration: multiMap.createMultiElementConfiguration,
    activeMultiElementForecastConfigurationName: store.activeMultiElementForecastConfigurationName,
    applyMultiElementForecastConfiguration: multiMap.applyMultiElementForecastConfiguration,
    deleteMultiElementForecastConfiguration: multiMap.deleteMultiElementForecastConfiguration,
    createMultiElementForecastConfiguration: multiMap.createMultiElementForecastConfiguration,
    elementConfig: store.elementConfig,
    activeElementKey: store.activeElementKey,
    applyElementSelection: elementConfig.applyElementSelection,
    setCellElements: elementConfig.setCellElements,
    addElementLevel: elementConfig.addElementLevel,
    removeElementLevel: elementConfig.removeElementLevel,
    addSingleLayerGroup: elementConfig.addSingleLayerGroup,
    removeSingleLayerGroup: elementConfig.removeSingleLayerGroup,
    setSingleLayerGroupElements: elementConfig.setSingleLayerGroupElements,
    resetElementConfig: elementConfig.resetElementConfig,
    reorderElementLevels: elementConfig.reorderElementLevels,
    reorderSingleLayerGroups: elementConfig.reorderSingleLayerGroups,
    elementLayerTypeOptions: LAYER_TYPE_OPTIONS,
    layerOptions: store.layerOptions,
    layerCombinationName: store.layerCombinationName,
    layerCombinationOptions: store.layerCombinationOptions,
    layerStatus: store.layerStatus,
    layerType: store.layerType,
    level,
    levelOptions: store.levelOptions,
    loadManifest,
    loadingState: store.loadingState,
    showControlRail,
    multiMapMode,
    isMultiMapPopup: multiMapPopup.isMultiMapPopup,
    multiMapSyncState,
    multiMapModeOptions,
    multiMapPanels: store.multiMapPanels,
    multiInitInterval,
    multiInitIntervalOptions,
    multiInitPanelCount,
    multiInitPanelCountOptions,
    multiForecastInterval,
    multiForecastIntervalOptions,
    multiForecastPanelCount,
    multiForecastPanelCountOptions,
    multiElementConfigurationName: store.multiElementConfigurationName,
    multiElementConfigurations: store.multiElementConfigurations,
    multiElementPanelCount,
    multiElementPanelCountOptions,
    multiElementForecastConfigurationName: store.multiElementForecastConfigurationName,
    multiElementForecastConfigurations: store.multiElementForecastConfigurations,
    multiElementForecastRows: store.multiElementForecastRows,
    mouseGeo: store.mouseGeo,
    openMultiMap,
    openMultiMapWindow: multiMapPopup.openMultiMapWindow,
    projectionName,
    projectionOptions,
    refreshToLatest,
    refreshMultiMapData: multiMap.refreshMultiMapData,
    resetView: projection.resetView,
    restoreDefaultMapViews: projection.restoreDefaultMapViews,
    saveLayerCombination: elementConfig.saveLayerCombination,
    saveMapView: projection.saveMapView,
    savedLayerCombinations: store.savedLayerCombinations,
    savedMapViews: store.savedMapViews,
    scrollForecastSlider: store.scrollForecastSlider,
    setMultiInitInterval: multiMap.setMultiInitInterval,
    setMultiInitPanelCount: multiMap.setMultiInitPanelCount,
    setMultiForecastInterval: multiMap.setMultiForecastInterval,
    setMultiForecastPanelCount: multiMap.setMultiForecastPanelCount,
    setMultiElementConfigurationName: multiMap.setMultiElementConfigurationName,
    setMultiElementPanelCount: multiMap.setMultiElementPanelCount,
    setMultiElementForecastConfigurationName: multiMap.setMultiElementForecastConfigurationName,
    shiftInitTime,
    shiftMultiForecastPage: multiMap.shiftMultiForecastPage,
    selectedLayerLabels: store.selectedLayerLabels,
    selectedLayerTypes,
    saveMultiElementConfiguration: multiMap.saveMultiElementConfiguration,
    renameMultiElementConfiguration: multiMap.renameMultiElementConfiguration,
    updateMultiElementPanel: multiMap.updateMultiElementPanel,
    saveMultiElementForecastConfiguration: multiMap.saveMultiElementForecastConfiguration,
    renameMultiElementForecastConfiguration: multiMap.renameMultiElementForecastConfiguration,
    updateMultiElementForecastPanel: multiMap.updateMultiElementForecastPanel,
    canShiftMultiForecastBackward: multiMap.canShiftMultiForecastBackward,
    canShiftMultiForecastForward: multiMap.canShiftMultiForecastForward,
    SHEAR_COLORS,
    shellRef,
    showFutureVortexTracks,
    showHistoricalVortexTracks: store.showHistoricalVortexTracks,
    showJetArrowHeads,
    showJetAxes,
    showColdFronts,
    showRawPoints,
    showSvgLayer,
    showTileDebug,
    showGraticule,
    showTooltip,
    showTrough,
    showVortexCenters,
    showVortexTracks,
    showWarmOnlyCenters,
    showWarmOnlyTracks,
    showOnlyFutureVortexTracks,
    showOnlyActiveVortexTracks,
    filteredFcHourCount: store.filteredFcHourCount,
    sliderFcHours: store.sliderFcHours,
    sliderIndexCount: store.sliderIndexCount,
    sliderOpts,
    markSlider: store.markSlider,
    systemTabs,
    troughLineWidth,
    troughShearFiltersByLevel: store.troughShearFiltersByLevel,
    troughMinLength,
    troughMinWindSpeed,
    troughShearFilters,
    troughShearOptions,
    visibleJetAxisCount: store.visibleJetAxisCount,
    visibleColdFrontCount: store.visibleColdFrontCount,
    visibleTroughCount: store.visibleTroughCount,
    visibleVortexCenterCount: store.visibleVortexCenterCount,
    visibleVortexTrackCount: store.visibleVortexTrackCount,
    vortexMinVorticity,
    vortexMinWindSpeed,
    vortexTrackMinWindSpeed,
    zoomTransform,
    errorMessage: store.errorMessage,
    preloading: store.preloading
  }

  return context
}
