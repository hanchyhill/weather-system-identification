import { onMounted, onUnmounted, watch } from 'vue'

const POPUP_QUERY_KEY = 'workspace'
const POPUP_QUERY_VALUE = 'multi-map'
const POPUP_MODE_QUERY_KEY = 'multi-map-mode'
const CHANNEL_NAME = 'weather-view-multi-map-popup'
const READY_MESSAGE = 'weather-view-multi-map-ready'
const STATE_MESSAGE = 'weather-view-multi-map-state'

function isValidMultiMapMode(mode, options) {
  return options.some((option) => option.value === mode)
}

/**
 * 主视图与独立多图窗口之间的单向状态同步。
 *
 * 多图窗口保持自己的画布、请求和局部交互状态；主视图是时间、要素和天气系统
 * 显示设置的权威来源，因此不会把弹窗中的临时面板操作反向覆盖回主窗口。
 */
export function useMultiMapPopup({
  applyInitAndFcHour,
  fcHour,
  initTime,
  level,
  multiElementPanelCount,
  multiForecastInterval,
  multiForecastPanelCount,
  multiInitInterval,
  multiInitPanelCount,
  multiMapMode,
  multiMapModeOptions,
  multiMapSyncState,
  openMultiMap,
  projectionName,
  selectedLayerTypes,
  systemControls,
  mapViewSnapshot,
  zoomTransform
}) {
  const browserWindow = typeof window === 'undefined' ? null : window
  const params = new URLSearchParams(browserWindow?.location.search || '')
  const isMultiMapPopup = params.get(POPUP_QUERY_KEY) === POPUP_QUERY_VALUE
  const requestedMode = params.get(POPUP_MODE_QUERY_KEY)
  let channel = null

  function snapshot(fallbackMode = '') {
    return {
      initTime: initTime.value,
      fcHour: fcHour.value,
      level: level.value,
      selectedLayerTypes: [...selectedLayerTypes.value],
      projectionName: projectionName.value,
      mapView: mapViewSnapshot(),
      multiMapMode: multiMapMode.value || fallbackMode || 'forecast',
      multiInitInterval: multiInitInterval.value,
      multiInitPanelCount: multiInitPanelCount.value,
      multiForecastInterval: multiForecastInterval.value,
      multiForecastPanelCount: multiForecastPanelCount.value,
      multiElementPanelCount: multiElementPanelCount.value,
      systemControls: Object.fromEntries(
        Object.entries(systemControls).map(([key, value]) => [key, value.value])
      )
    }
  }

  function post(message) {
    channel?.postMessage(message)
  }

  function sendState(fallbackMode = '') {
    if (!isMultiMapPopup) post({ type: STATE_MESSAGE, state: snapshot(fallbackMode) })
  }

  function applyState(state) {
    if (!state || typeof state !== 'object') return

    const nextInitTime = String(state.initTime || '').trim()
    if (nextInitTime) applyInitAndFcHour(nextInitTime, state.fcHour)
    else if (state.fcHour != null) fcHour.value = String(state.fcHour).padStart(3, '0')

    if (state.level != null) level.value = String(state.level)
    if (Array.isArray(state.selectedLayerTypes) && state.selectedLayerTypes.length) {
      selectedLayerTypes.value = state.selectedLayerTypes.map(String)
    }
    if (state.projectionName) projectionName.value = state.projectionName

    const scalarState = {
      multiInitInterval,
      multiInitPanelCount,
      multiForecastInterval,
      multiForecastPanelCount,
      multiElementPanelCount
    }
    Object.entries(scalarState).forEach(([key, target]) => {
      if (state[key] != null) target.value = state[key]
    })
    Object.entries(systemControls).forEach(([key, target]) => {
      if (state.systemControls?.[key] != null) target.value = state.systemControls[key]
    })

    const nextMode = isValidMultiMapMode(state.multiMapMode, multiMapModeOptions)
      ? state.multiMapMode
      : (isValidMultiMapMode(requestedMode, multiMapModeOptions) ? requestedMode : 'forecast')
    openMultiMap(nextMode)
    if (state.mapView?.center && Number.isFinite(Number(state.mapView.k))) {
      multiMapSyncState.zoom = { ...state.mapView, source: 'main-map-window' }
    }
  }

  function receive(message, source = null) {
    if (!message || typeof message !== 'object') return
    if (message.type === READY_MESSAGE && !isMultiMapPopup) {
      const mode = isValidMultiMapMode(message.mode, multiMapModeOptions) ? message.mode : ''
      const state = snapshot(mode)
      if (source) source.postMessage({ type: STATE_MESSAGE, state }, browserWindow?.location.origin)
      else post({ type: STATE_MESSAGE, state })
    } else if (message.type === STATE_MESSAGE && isMultiMapPopup) {
      applyState(message.state)
    }
  }

  function announceReady() {
    if (!browserWindow) return
    const message = { type: READY_MESSAGE, mode: requestedMode }
    if (channel) post(message)
    else browserWindow.opener?.postMessage(message, browserWindow.location.origin)
  }

  function openMultiMapWindow(mode = multiMapMode.value || 'forecast') {
    if (!browserWindow) return false
    const targetMode = isValidMultiMapMode(mode, multiMapModeOptions) ? mode : 'forecast'
    const url = new URL(browserWindow.location.href)
    url.searchParams.set(POPUP_QUERY_KEY, POPUP_QUERY_VALUE)
    url.searchParams.set(POPUP_MODE_QUERY_KEY, targetMode)
    url.hash = ''

    // 铺满当前屏幕的可用区域（排除任务栏等系统占用）。availLeft/availTop 只有
    // Firefox 实现，缺失时退回 0；不给 left/top 浏览器会自行摆放，导致窗口偏到一侧。
    const screen = browserWindow.screen || {}
    const width = screen.availWidth || screen.width || 1600
    const height = screen.availHeight || screen.height || 900
    const left = Number.isFinite(screen.availLeft) ? screen.availLeft : 0
    const top = Number.isFinite(screen.availTop) ? screen.availTop : 0

    const popup = browserWindow.open(
      url.toString(),
      'weather-view-multi-map',
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
    if (popup) {
      // 部分浏览器会忽略打开时的尺寸参数（或按上次记忆的大小复用同名窗口），
      // 打开后再显式摆一次位置和大小。
      try {
        popup.moveTo(left, top)
        popup.resizeTo(width, height)
      } catch {
        // 跨域或被策略拒绝时忽略，窗口仍可用，只是尺寸沿用浏览器默认。
      }
      popup.focus()
    }
    return Boolean(popup)
  }

  function receiveWindowMessage(event) {
    if (!browserWindow || event.origin !== browserWindow.location.origin) return
    receive(event.data, event.source)
  }

  if (isMultiMapPopup) {
    const initialMode = isValidMultiMapMode(requestedMode, multiMapModeOptions) ? requestedMode : 'forecast'
    openMultiMap(initialMode)
  }

  if (browserWindow) {
    onMounted(() => {
      if ('BroadcastChannel' in browserWindow) {
        channel = new browserWindow.BroadcastChannel(CHANNEL_NAME)
        channel.onmessage = (event) => receive(event.data)
      }
      browserWindow.addEventListener('message', receiveWindowMessage)
      if (isMultiMapPopup) announceReady()
    })

    onUnmounted(() => {
      browserWindow.removeEventListener('message', receiveWindowMessage)
      channel?.close()
      channel = null
    })
  }

  if (!isMultiMapPopup && browserWindow) {
    watch([
      initTime,
      fcHour,
      level,
      selectedLayerTypes,
      projectionName,
      zoomTransform,
      multiMapMode,
      multiInitInterval,
      multiInitPanelCount,
      multiForecastInterval,
      multiForecastPanelCount,
      multiElementPanelCount,
      ...Object.values(systemControls)
    ], () => sendState(), { deep: true, flush: 'post' })
  }

  return {
    isMultiMapPopup,
    openMultiMapWindow
  }
}
