import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const weatherViewUrl = pathToFileURL(resolve(testDirectory, '../src/composables/useWeatherView.js')).href

// useWeatherView 是装配层；这里用 Node 原生 loader 替代 Vue/D3 和各实现模块，
// 验证重构后模块之间的接线与 watch/lifecycle 行为，而不需要浏览器或网络。
const mockSources = {
  d3: `
    export function zoom() {
      const behavior = {
        scaleExtent() { return behavior },
        filter() { return behavior },
        on() { return behavior }
      }
      return behavior
    }
    export function select() {
      return { call() {}, on() {} }
    }
  `,
  vue: `
    export function nextTick() { return Promise.resolve() }
    export function onMounted(callback) { globalThis.__weatherViewHarness.mounted.push(callback) }
    export function onUnmounted(callback) { globalThis.__weatherViewHarness.unmounted.push(callback) }
    export function watch(sources, callback, options) {
      globalThis.__weatherViewHarness.watchers.push({ sources, callback, options })
    }
  `,
  '../utils/initTime': `export function calLatestBaseTime() { return '2026070412' }`,
  '../utils/elementSelectorConfig': `export const LAYER_TYPE_OPTIONS = [{ label: '风羽', value: 'wind_barb' }]`,
  './weatherView/constants': `
    export const DEFAULT_FC_HOURS = ['000', '006']
    export const DRAW_TOOLS = []
    export const SHEAR_COLORS = {}
    export const projectionOptions = []
    export const systemTabs = []
    export const troughShearOptions = []
    export const multiMapModeOptions = []
    export const multiForecastIntervalOptions = []
    export const multiForecastPanelCountOptions = []
    export const multiInitIntervalOptions = []
    export const multiInitPanelCountOptions = []
    export const multiElementPanelCountOptions = []
    export const sliderOpts = {}
  `,
  './weatherView/helpers': `
    export function formatNumber(value) { return String(value) }
    export function normalizeFcHour(value) { return String(Number(value)).padStart(3, '0') }
    export function parseInitTime(value) {
      const match = String(value || '').match(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})$/)
      if (!match) return null
      const [, year, month, day, hour] = match
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour)))
      return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? date : null
    }
    export function padTimePart(value) { return String(value).padStart(2, '0') }
    export function getTileZoom() { return 0 }
    export function renderScaleForZoom() { return 1 }
  `,
  './weatherView/useWeatherViewState': `export function createWeatherViewStore(initialView) { return globalThis.__weatherViewHarness.createStore(initialView) }`,
  './weatherView/useMapProjection': `export function useMapProjection() { return globalThis.__weatherViewHarness.projection }`,
  './weatherView/useWeatherData': `export function useWeatherData() { return globalThis.__weatherViewHarness.data }`,
  './weatherView/useMapRenderer': `export function useMapRenderer() { return globalThis.__weatherViewHarness.renderer }`,
  './weatherView/useMapDrawings': `export function useMapDrawings() { return globalThis.__weatherViewHarness.drawings }`,
  './weatherView/useMultiMap': `export function useMultiMap() { return globalThis.__weatherViewHarness.multiMap }`,
  './weatherView/useElementConfig': `export function useElementConfig() { return globalThis.__weatherViewHarness.elementConfig }`
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === weatherViewUrl && Object.hasOwn(mockSources, specifier)) {
      return { shortCircuit: true, url: `weather-view-test:${encodeURIComponent(specifier)}` }
    }
    if (specifier.startsWith('.') && !extname(specifier)) {
      return nextResolve(`${specifier}.js`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('weather-view-test:')) {
      const specifier = decodeURIComponent(url.slice('weather-view-test:'.length))
      return { shortCircuit: true, format: 'module', source: mockSources[specifier] }
    }
    return nextLoad(url, context)
  }
})

const { useWeatherView } = await import(weatherViewUrl)
const { useMapProjection } = await import('../src/composables/weatherView/useMapProjection.js')
const { DEFAULT_MAP_VIEWS, MAP_VIEW_STORAGE_KEY } = await import('../src/composables/weatherView/constants.js')

function ref(value) {
  return { value }
}

function createHarness() {
  const calls = []
  const callable = (name, value) => (...args) => {
    calls.push([name, ...args])
    return value
  }
  const store = {
    runtime: {},
    compactView: false,
    canvasRef: ref(null),
    shellRef: ref(null),
    canvasSize: { width: 800, height: 500 },
    zoomTransform: ref({}),
    activeSvgLayers: ref([]),
    initTime: ref('2026070412'),
    fcHour: ref('000'),
    level: ref('500'),
    selectedLayerTypes: ref(['wind_barb']),
    projectionName: ref('equirectangular'),
    multiMapMode: ref(''),
    multiInitInterval: ref('12'),
    multiInitPanelCount: ref(4),
    multiForecastInterval: ref('24'),
    multiForecastPanelCount: ref(4),
    multiElementPanelCount: ref(4),
    showControlRail: ref(true),
    drawMode: ref(false),
    showSvgLayer: ref(true),
    showTrough: ref(true),
    showColdFronts: ref(true),
    showJetAxes: ref(true),
    showRawPoints: ref(false),
    showVortexCenters: ref(true),
    showVortexTracks: ref(true),
    showWarmOnlyTracks: ref(false),
    showWarmOnlyCenters: ref(false),
    showTooltip: ref(true),
    showTileDebug: ref(false),
    troughMinLength: ref(0),
    troughMinWindSpeed: ref(0),
    troughLineWidth: ref(1),
    jetMinAxisLength: ref(0),
    jetMinAvgWindSpeed: ref(0),
    jetMinMaxWindSpeed: ref(0),
    jetLineWidth: ref(1),
    showJetArrowHeads: ref(true),
    vortexMinWindSpeed: ref(0),
    vortexMinVorticity: ref(0),
    vortexTrackMinWindSpeed: ref(0),
    showFutureVortexTracks: ref(true),
    showOnlyFutureVortexTracks: ref(false),
    showOnlyActiveVortexTracks: ref(false),
    troughShearFilters: ref({}),
    selectedLayerHasTiles: () => false,
    buildProjection: () => ({ invert: () => null }),
    requestDraw: callable('requestDraw'),
    changeFcHour: callable('changeFcHour'),
    fcHourIndex: ref(0),
    fcHourOptions: ref([]),
    activeSystemTab: ref('trough'),
    activeDrawTool: ref(null),
    forecastValidTimeLabel: ref(''),
    forecastValidTimeBjtLabel: ref(''),
    getSliderTooltip: callable('getSliderTooltip'),
    scrollForecastSlider: callable('scrollForecastSlider'),
    layerOptions: ref([]),
    layerCombinationName: ref(''),
    layerCombinationOptions: ref([]),
    layerStatus: ref(''),
    layerType: ref('wind_barb'),
    levelOptions: ref([]),
    loadingState: ref('idle'),
    errorMessage: ref(''),
    preloading: ref(false),
    ...Object.fromEntries([
      'hoverJetLine', 'hoverLine', 'hoverVortexCenter', 'hoverVortexTrack',
      'activeLayerCombinationName', 'savedLayerCombinations', 'savedMapViews',
      'activeMultiElementConfigurationName', 'activeMultiElementForecastConfigurationName',
      'elementConfig', 'activeElementKey', 'multiMapPanels', 'multiElementConfigurationName',
      'multiElementConfigurations', 'multiElementForecastConfigurationName',
      'multiElementForecastConfigurations', 'multiElementForecastRows', 'mouseGeo',
      'selectedLayerLabels', 'showHistoricalVortexTracks', 'sliderIndexCount', 'markSlider',
      'visibleJetAxisCount', 'visibleColdFrontCount', 'visibleTroughCount',
      'visibleVortexCenterCount', 'visibleVortexTrackCount', 'isVortexTrackLevel'
    ].map((key) => [key, ref(null)]))
  }

  return {
    calls,
    store,
    watchers: [],
    mounted: [],
    unmounted: [],
    createStore(initialView) {
      this.initialView = initialView
      return store
    },
    projection: {
      applySynchronizedZoom: callable('applySynchronizedZoom'),
      transformFromSync: () => false,
      applyDefaultView: callable('applyDefaultView'),
      resizeCanvas: callable('resizeCanvas'),
      broadcastCursor: callable('broadcastCursor'),
      applyMapView: callable('applyMapView'),
      deleteMapView: callable('deleteMapView'),
      resetView: callable('resetView'),
      restoreDefaultMapViews: callable('restoreDefaultMapViews'),
      saveMapView: callable('saveMapView')
    },
    data: Object.fromEntries([
      'loadWorld', 'loadManifest', 'loadActiveLayer', 'loadVisibleTileDelta', 'loadTrough',
      'loadColdFronts', 'loadJetAxes', 'loadVortexCenters', 'cancelPreload'
    ].map((name) => [name, callable(name)])),
    renderer: {
      drawMap: callable('drawMap'),
      handleMouseMove: callable('handleMouseMove'),
      handleMouseLeave: callable('handleMouseLeave'),
      clearHoverState: callable('clearHoverState')
    },
    drawings: {
      drawDrawings: callable('drawDrawings'), findShapeIndexNear: callable('findShapeIndexNear'),
      setDrawTool: callable('setDrawTool'), exitDrawMode: callable('exitDrawMode'),
      finishCurrentLine: callable('finishCurrentLine'), undoDrawing: callable('undoDrawing'),
      clearDrawings: callable('clearDrawings'), hasDrawings: ref(false), draftPointCount: ref(0),
      handleCanvasPointerDown: callable('handleCanvasPointerDown'), handleCanvasPointerUp: callable('handleCanvasPointerUp'),
      handleCanvasClick: callable('handleCanvasClick'), handleCanvasDblClick: callable('handleCanvasDblClick'),
      handleCanvasContextMenu: callable('handleCanvasContextMenu'), handleDrawKeydown: callable('handleDrawKeydown')
    },
    multiMap: [
      'openMultiMap', 'closeMultiMap', 'applyMultiElementConfiguration', 'deleteMultiElementConfiguration',
      'createMultiElementConfiguration', 'applyMultiElementForecastConfiguration',
      'deleteMultiElementForecastConfiguration', 'createMultiElementForecastConfiguration',
      'setMultiInitInterval', 'setMultiInitPanelCount', 'setMultiForecastInterval', 'setMultiForecastPanelCount',
      'setMultiElementConfigurationName', 'setMultiElementPanelCount', 'setMultiElementForecastConfigurationName',
      'shiftMultiForecastPage', 'saveMultiElementConfiguration', 'renameMultiElementConfiguration',
      'updateMultiElementPanel', 'saveMultiElementForecastConfiguration', 'renameMultiElementForecastConfiguration',
      'updateMultiElementForecastPanel', 'canShiftMultiForecastBackward', 'canShiftMultiForecastForward'
    ].reduce((api, name) => ({ ...api, [name]: callable(name) }), {}),
    elementConfig: [
      'handleLayerTypeChange', 'applyLayerCombination', 'deleteLayerCombination', 'applyElementSelection',
      'setCellElements', 'addElementLevel', 'removeElementLevel', 'addSingleLayerGroup',
      'removeSingleLayerGroup', 'setSingleLayerGroupElements', 'resetElementConfig',
      'reorderElementLevels', 'reorderSingleLayerGroups', 'saveLayerCombination'
    ].reduce((api, name) => ({ ...api, [name]: callable(name) }), {})
  }
}

function findWatcher(harness, source) {
  const watcher = harness.watchers.find((item) => {
    if (Array.isArray(source)) {
      return Array.isArray(item.sources)
        && item.sources.length === source.length
        && item.sources.every((entry, index) => entry === source[index])
    }
    return item.sources === source
  })
  assert.ok(watcher, 'expected watcher was not registered')
  return watcher
}

describe('useWeatherView composition root', () => {
  it('preserves the public navigation API and loads the selected init time', () => {
    const harness = createHarness()
    globalThis.__weatherViewHarness = harness
    const view = useWeatherView({ initTime: '2026070412' })

    assert.equal(harness.initialView.initTime, '2026070412')
    assert.equal(harness.store.drawMap, harness.renderer.drawMap)
    assert.equal(harness.store.drawDrawings, harness.drawings.drawDrawings)
    assert.equal(harness.store.broadcastCursor, harness.projection.broadcastCursor)
    assert.equal(view.restoreDefaultMapViews, harness.projection.restoreDefaultMapViews)

    view.shiftInitTime(12)
    assert.equal(view.initTime.value, '2026070500')
    assert.deepEqual(harness.calls.filter(([name]) => name === 'loadManifest'), [['loadManifest']])

    view.applyInitAndFcHour('2026070312', 6)
    assert.equal(view.initTime.value, '2026070312')
    assert.equal(view.fcHour.value, '006')

    const loadCount = harness.calls.filter(([name]) => name === 'loadManifest').length
    view.applyInitAndFcHour('invalid', 12)
    assert.equal(harness.calls.filter(([name]) => name === 'loadManifest').length, loadCount)

    view.refreshToLatest()
    assert.equal(view.initTime.value, '2026070412')
    assert.equal(harness.calls.filter(([name]) => name === 'loadManifest').length, loadCount + 1)
  })

  it('wires state watchers to the extracted behavior modules', async () => {
    const harness = createHarness()
    globalThis.__weatherViewHarness = harness
    useWeatherView()

    assert.equal(harness.watchers.length, 9)

    await findWatcher(harness, [harness.store.fcHour, harness.store.level]).callback()
    assert.deepEqual(
      harness.calls.filter(([name]) => ['loadActiveLayer', 'loadTrough', 'loadColdFronts', 'loadJetAxes', 'loadVortexCenters'].includes(name)).map(([name]) => name),
      ['loadActiveLayer', 'loadTrough', 'loadColdFronts', 'loadJetAxes', 'loadVortexCenters']
    )

    await findWatcher(harness, harness.store.selectedLayerTypes).callback()
    await findWatcher(harness, harness.store.projectionName).callback()
    assert.equal(harness.calls.filter(([name]) => name === 'loadActiveLayer').length, 3)

    harness.store.multiMapMode.value = 'forecast'
    findWatcher(harness, [
      harness.store.multiMapMode, harness.store.initTime, harness.store.fcHour, harness.store.level,
      harness.store.selectedLayerTypes, harness.store.multiInitInterval, harness.store.multiInitPanelCount,
      harness.store.multiForecastInterval, harness.store.multiForecastPanelCount, harness.store.multiElementPanelCount
    ]).callback()
    assert.deepEqual(harness.calls.filter(([name]) => name === 'openMultiMap'), [['openMultiMap', 'forecast']])
  })

  it('routes rendering-only changes through hover cleanup and redraw', () => {
    const harness = createHarness()
    globalThis.__weatherViewHarness = harness
    useWeatherView()

    const visualSources = harness.watchers.find((item) => Array.isArray(item.sources) && item.sources.includes(harness.store.showSvgLayer))
    assert.ok(visualSources)
    visualSources.callback()
    findWatcher(harness, harness.store.troughShearFilters).callback()

    assert.equal(harness.calls.filter(([name]) => name === 'clearHoverState').length, 2)
    assert.equal(harness.calls.filter(([name]) => name === 'requestDraw').length, 2)
  })
})

describe('saved map view defaults', () => {
  it('restores built-in views and persists a fresh copy of their configuration', () => {
    const values = new Map()
    const previousWindow = globalThis.window
    globalThis.window = {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value)
      }
    }

    try {
      const savedMapViews = ref([{ name: '自定义', center: [1, 2], k: 3 }])
      const projection = useMapProjection({
        canvasRef: ref(null),
        canvasSize: { width: 960, height: 640 },
        zoomTransform: ref(null),
        savedMapViews,
        runtime: {},
        buildProjection: () => () => null,
        requestDraw: () => {}
      })

      const restored = projection.restoreDefaultMapViews()
      assert.deepEqual(restored, DEFAULT_MAP_VIEWS)
      assert.deepEqual(JSON.parse(values.get(MAP_VIEW_STORAGE_KEY)), DEFAULT_MAP_VIEWS)
      assert.notEqual(restored, DEFAULT_MAP_VIEWS)
      assert.notEqual(restored[0].center, DEFAULT_MAP_VIEWS[0].center)
    } finally {
      globalThis.window = previousWindow
    }
  })
})
