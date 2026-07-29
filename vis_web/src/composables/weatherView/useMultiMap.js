// 多图对比：面板描述符构造（多起报/多时效/多要素及其组合矩阵）、三套配置的
// 加载/持久化/增删改查，以及 openMultiMap/closeMultiMap。均从原 useWeatherView.js 迁出。
import { computed } from 'vue'

import { cellKey } from '../../utils/elementSelectorConfig'
import { calLatestBaseTime } from '../../utils/initTime'
import {
  MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY,
  MULTI_ELEMENT_FORECAST_CONFIGURATION_STORAGE_KEY,
  multiMapModeOptions,
  multiInitIntervalOptions,
  multiInitPanelCountOptions,
  multiForecastIntervalOptions,
  multiForecastPanelCountOptions,
  multiElementPanelCountOptions
} from './constants'
import { normalizeFcHour, shiftedInitTime } from './helpers'

export function useMultiMap(store) {
  const {
    initTime,
    fcHour,
    level,
    selectedLayerTypes,
    projectionName,
    activeLayerCombinationName,
    selectedLayerLabels,
    activeElementKey,
    elementConfig,
    multiMapMode,
    showControlRail,
    multiMapSyncState,
    multiMapPanels,
    multiInitInterval,
    multiInitPanelCount,
    multiForecastInterval,
    multiForecastPanelCount,
    multiElementPanelCount,
    multiElementConfigurations,
    multiElementConfigurationName,
    activeMultiElementConfigurationName,
    multiElementForecastRows,
    multiElementForecastConfigurations,
    multiElementForecastConfigurationName,
    activeMultiElementForecastConfigurationName,
    sliderFcHours
  } = store

  function panelView(overrides = {}) {
    return {
      initTime: initTime.value,
      fcHour: fcHour.value,
      level: level.value,
      selectedLayerTypes: [...selectedLayerTypes.value],
      projectionName: projectionName.value,
      compact: true,
      showPanelTitle: true,
      valid: true,
      ...overrides
    }
  }

  // 每次切到另一种多图模式时，都以当前第一张子图作为数据基准。
  // 这也覆盖多要素场景：第一张图的要素/层次会成为新模式的起点。
  function adoptFirstPanelAsBase() {
    const firstPanel = multiMapPanels.value[0]
    if (!firstPanel) return

    if (firstPanel.initTime) initTime.value = firstPanel.initTime
    if (firstPanel.fcHour) fcHour.value = normalizeFcHour(firstPanel.fcHour)
    if (firstPanel.level) level.value = String(firstPanel.level)
    if (Array.isArray(firstPanel.selectedLayerTypes) && firstPanel.selectedLayerTypes.length) {
      selectedLayerTypes.value = [...firstPanel.selectedLayerTypes]
    }
    if (firstPanel.projectionName) projectionName.value = firstPanel.projectionName
  }

  function initializeMultiMapView(isModeChange) {
    if (!isModeChange) return
    if (multiMapMode.value && multiMapPanels.value.length) adoptFirstPanelAsBase()

    const snapshot = multiMapSyncState.zoom || store.currentMapViewSnapshot?.()
    if (snapshot) {
      multiMapSyncState.zoom = { ...snapshot, source: 'multi-map-base' }
    }
  }

  function multiForecastDescriptors() {
    const hours = sliderFcHours.value
    const startIndex = Math.max(0, hours.indexOf(normalizeFcHour(fcHour.value)))
    const panelCount = multiForecastPanelCount.value

    if (multiForecastInterval.value === 'continuous') {
      return Array.from({ length: panelCount }, (_, index) => {
        const value = hours[startIndex + index] || null
        return { value, valid: Boolean(value) }
      })
    }

    const interval = Number(multiForecastInterval.value)
    const startHour = Number(fcHour.value)
    return Array.from({ length: panelCount }, (_, index) => {
      const value = normalizeFcHour(startHour + (interval * index))
      return { value, valid: hours.includes(value) }
    })
  }

  // 计算某个预报时效子图在“翻页”后会落到的预报时效（供多图协调式预加载使用）。
  // 翻页步长与 shiftMultiForecastPage 一致：连续模式按索引位移 panelCount，间隔模式按
  // interval×panelCount 位移。directions 指定预取方向（1=下一页、-1=上一页）：单轴时效对比
  // 预取前后两页；双轴（要素×时效）子图数量翻倍，仅预取下一页以减轻主线程与网络压力。
  // 仅返回滑块时效列表内实际存在的值；各子图只预取自己这几个时效，N 个子图的并集恰好覆盖
  // 相邻页整组，跨子图重叠由共享缓存自动去重。
  function pagePreloadFcHours(panelFcHour, directions = [1, -1]) {
    if (!panelFcHour) return []
    const hours = sliderFcHours.value
    const panelCount = multiForecastPanelCount.value
    const targets = []

    if (multiForecastInterval.value === 'continuous') {
      const idx = hours.indexOf(normalizeFcHour(panelFcHour))
      if (idx < 0) return []
      for (const direction of directions) {
        const value = hours[idx + (panelCount * direction)]
        if (value && !targets.includes(value)) targets.push(value)
      }
      return targets
    }

    const offset = Number(multiForecastInterval.value) * panelCount
    for (const direction of directions) {
      const value = normalizeFcHour(Number(panelFcHour) + (offset * direction))
      if (hours.includes(value) && !targets.includes(value)) targets.push(value)
    }
    return targets
  }

  // 多起报对比保持首图的有效时间不变：每向前一个起报间隔，预报时效同步增加。
  // 例如 2025071012 起报 +000h、12 小时前起报 +012h，均对应 2025071012。
  function multiInitDescriptors() {
    const interval = Number(multiInitInterval.value)
    const startFcHour = Number(fcHour.value)

    return Array.from({ length: multiInitPanelCount.value }, (_, index) => ({
      initTime: shiftedInitTime(initTime.value, -interval * index),
      fcHour: normalizeFcHour(startFcHour + interval * index)
    }))
  }

  // 多起报、多时效：每一列以当前预报时效为基准向后延伸；每一行向前移动起报时次，
  // 同一列各行同步增加预报时效，从而保持相同的真实有效时间。
  function multiInitForecastPanelViews() {
    const initDescriptors = multiInitDescriptors()
    const forecastDescriptors = multiForecastDescriptors()
    const startFcHour = Number(fcHour.value)

    return initDescriptors.flatMap(({ initTime: panelInitTime, fcHour: rowFcHour }, rowIndex) => (
      forecastDescriptors.map(({ value, valid }, columnIndex) => {
        const offset = value ? Number(value) - startFcHour : 0
        const panelFcHour = normalizeFcHour(Number(rowFcHour) + offset)
        return panelView({
          id: `init-forecast-${panelInitTime}-${panelFcHour}-${rowIndex}-${columnIndex}`,
          title: `${panelInitTime} 起报｜+${panelFcHour} h`,
          initTime: panelInitTime,
          fcHour: panelFcHour,
          preloadFcHours: pagePreloadFcHours(panelFcHour, [1]),
          showPanelTitle: false,
          valid
        })
      })
    ))
  }

  function setMultiInitInterval(value) {
    if (!multiInitIntervalOptions.some((option) => option.value === value)) return
    multiInitInterval.value = value
    if (multiMapMode.value === 'element_init') activeMultiElementForecastConfigurationName.value = ''
  }

  function setMultiInitPanelCount(value) {
    const count = Number(value)
    if (!multiInitPanelCountOptions.includes(count)) return
    multiInitPanelCount.value = count
    if (multiMapMode.value === 'element_init') activeMultiElementForecastConfigurationName.value = ''
  }

  function setMultiForecastInterval(value) {
    if (!multiForecastIntervalOptions.some((option) => option.value === value)) return
    multiForecastInterval.value = value
    if (['element_forecast', 'element_init'].includes(multiMapMode.value)) activeMultiElementForecastConfigurationName.value = ''
  }

  function setMultiForecastPanelCount(value) {
    const count = Number(value)
    if (!multiForecastPanelCountOptions.includes(count)) return
    multiForecastPanelCount.value = count
    if (['element_forecast', 'element_init'].includes(multiMapMode.value)) activeMultiElementForecastConfigurationName.value = ''
  }

  function setMultiElementPanelCount(value) {
    const count = Number(value)
    if (!multiElementPanelCountOptions.includes(count)) return
    multiElementPanelCount.value = count
  }

  function shiftMultiForecastPage(direction) {
    if (!['forecast', 'element_forecast', 'init_forecast'].includes(multiMapMode.value)) return
    const hours = sliderFcHours.value
    const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
    if (startIndex < 0) return

    if (multiForecastInterval.value === 'continuous') {
      const nextIndex = startIndex + (Number(direction) * multiForecastPanelCount.value)
      if (nextIndex >= 0 && nextIndex < hours.length) fcHour.value = hours[nextIndex]
      return
    }

    const offset = Number(multiForecastInterval.value) * multiForecastPanelCount.value
    const nextValue = normalizeFcHour(Number(fcHour.value) + (Number(direction) * offset))
    if (hours.includes(nextValue)) fcHour.value = nextValue
  }

  const canShiftMultiForecastBackward = computed(() => {
    const hours = sliderFcHours.value
    const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
    if (startIndex < 0) return false
    if (multiForecastInterval.value === 'continuous') {
      return startIndex - multiForecastPanelCount.value >= 0
    }
    const nextValue = normalizeFcHour(Number(fcHour.value) - (Number(multiForecastInterval.value) * multiForecastPanelCount.value))
    return hours.includes(nextValue)
  })

  const canShiftMultiForecastForward = computed(() => {
    const hours = sliderFcHours.value
    const startIndex = hours.indexOf(normalizeFcHour(fcHour.value))
    if (startIndex < 0) return false
    if (multiForecastInterval.value === 'continuous') {
      return startIndex + multiForecastPanelCount.value < hours.length
    }
    const nextValue = normalizeFcHour(Number(fcHour.value) + (Number(multiForecastInterval.value) * multiForecastPanelCount.value))
    return hours.includes(nextValue)
  })

  function normalizeMultiElementDescriptor(element, fallbackLabel = '') {
    const layers = Array.isArray(element?.layers)
      ? element.layers
      : element?.selectedLayerTypes
    return {
      label: String(element?.label || element?.title || fallbackLabel).trim() || fallbackLabel,
      level: String(element?.level || level.value),
      layers: Array.isArray(layers) ? layers.map(String).filter(Boolean) : [],
      elementKey: String(element?.elementKey || '')
    }
  }

  function multiElementCandidates() {
    const current = {
      label: activeLayerCombinationName.value || selectedLayerLabels.value,
      level: level.value,
      layers: [...selectedLayerTypes.value],
      elementKey: activeElementKey.value
    }
    const candidates = [current]
    const seen = new Set([`${current.level}|${current.layers.join(',')}`])

    const addElement = (element) => {
      const descriptor = normalizeMultiElementDescriptor(element)
      const key = `${descriptor.level}|${descriptor.layers.join(',')}`
      if (!descriptor.layers.length || seen.has(key)) return
      candidates.push(descriptor)
      seen.add(key)
    }

    const preferredCells = elementConfig.value.columns.map((column) => (
      elementConfig.value.cells[cellKey(level.value, column.key)] || []
    ))
    const allCells = Object.values(elementConfig.value.cells)
    const singleLayerElements = elementConfig.value.singleLayerGroups.flatMap((group) => group.elements || [])

    for (const elements of [...preferredCells, ...allCells, singleLayerElements]) {
      for (const element of elements) {
        const before = candidates.length
        addElement(element)
        if (candidates.length === before) continue
        if (candidates.length >= multiElementPanelCountOptions[multiElementPanelCountOptions.length - 1]) return candidates
      }
    }

    return candidates
  }

  function multiElementPanels() {
    const existing = multiMapMode.value === 'element'
      ? multiMapPanels.value.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
      : []
    const candidates = multiElementCandidates()
    const descriptors = [...existing]

    for (let index = descriptors.length; index < multiElementPanelCount.value; index += 1) {
      const fallback = candidates[index % candidates.length] || normalizeMultiElementDescriptor({}, `配置${index + 1}`)
      descriptors.push({ ...fallback, layers: [...fallback.layers] })
    }

    return descriptors.slice(0, multiElementPanelCount.value)
  }

  function defaultMultiElementPanels() {
    const candidates = multiElementCandidates()
    return Array.from({ length: multiElementPanelCount.value }, (_, index) => {
      const fallback = candidates[index % candidates.length] || normalizeMultiElementDescriptor({}, `配置${index + 1}`)
      return { ...fallback, layers: [...fallback.layers] }
    })
  }

  function multiElementPanelView(element, index) {
    const descriptor = normalizeMultiElementDescriptor(element, `配置${index + 1}`)
    return panelView({
      id: `element-${initTime.value}-${fcHour.value}-${index}-${descriptor.level}-${descriptor.layers.join('-')}-${descriptor.elementKey}`,
      title: descriptor.label || `配置${index + 1}`,
      level: descriptor.level,
      selectedLayerTypes: [...descriptor.layers],
      elementKey: descriptor.elementKey
    })
  }

  function updateMultiElementPanel(index, element, elementKey = '') {
    if (multiMapMode.value !== 'element' || !multiMapPanels.value[index]) return
    const panels = multiMapPanels.value.map((panel, panelIndex) => (
      panelIndex === index
        ? multiElementPanelView({ ...element, elementKey }, panelIndex)
        : panel
    ))
    multiMapPanels.value = panels
    activeMultiElementConfigurationName.value = ''
  }

  function defaultMultiElementForecastRows() {
    return [
      { label: '500hPa天气形势', level: '500', layers: ['hght_contour', 'wind_barb'], elementKey: '' },
      { label: '925hPa天气形势', level: '925', layers: ['hght_contour', 'wind_barb'], elementKey: '' },
      { label: '地面风羽', level: 'surface', layers: ['surface_barb'], elementKey: '' }
    ]
  }

  function multiElementForecastPanelViews() {
    const descriptors = multiForecastDescriptors()
    const rows = multiElementForecastRows.value.length
      ? multiElementForecastRows.value
      : defaultMultiElementForecastRows()

    return rows.flatMap((row, rowIndex) => {
      const element = normalizeMultiElementDescriptor(row, `要素${rowIndex + 1}`)
      return descriptors.map(({ value, valid }, columnIndex) => panelView({
        id: `element-forecast-${initTime.value}-${multiForecastInterval.value}-${rowIndex}-${columnIndex}-${value || 'invalid'}-${element.level}-${element.layers.join('-')}-${element.elementKey}`,
        title: value ? `${element.label}｜+${value} h` : `${element.label}｜无可用时效`,
        level: element.level,
        selectedLayerTypes: [...element.layers],
        elementKey: element.elementKey,
        fcHour: value || fcHour.value,
        preloadFcHours: pagePreloadFcHours(value, [1]),
        showPanelTitle: false,
        valid
      }))
    })
  }

  function multiElementInitPanelViews() {
    const initDescriptors = multiInitDescriptors()
    const rows = multiElementForecastRows.value.length
      ? multiElementForecastRows.value
      : defaultMultiElementForecastRows()

    return rows.flatMap((row, rowIndex) => {
      const element = normalizeMultiElementDescriptor(row, `要素${rowIndex + 1}`)
      return initDescriptors.map(({ initTime: panelInitTime, fcHour: panelFcHour }, columnIndex) => panelView({
        id: `element-init-${panelInitTime}-${panelFcHour}-${rowIndex}-${columnIndex}-${element.level}-${element.layers.join('-')}-${element.elementKey}`,
        title: `${element.label}｜${panelInitTime} 起报`,
        initTime: panelInitTime,
        fcHour: panelFcHour,
        level: element.level,
        selectedLayerTypes: [...element.layers],
        elementKey: element.elementKey,
        showPanelTitle: false
      }))
    })
  }

  function updateMultiElementForecastPanel(index, element, elementKey = '') {
    if (!['element_forecast', 'element_init'].includes(multiMapMode.value) || !multiMapPanels.value[index]) return
    const columnCount = multiMapMode.value === 'element_init'
      ? multiInitPanelCount.value
      : multiForecastPanelCount.value
    const rowIndex = Math.floor(index / columnCount)
    if (!multiElementForecastRows.value[rowIndex]) return

    multiElementForecastRows.value = multiElementForecastRows.value.map((row, currentRowIndex) => (
      currentRowIndex === rowIndex
        ? normalizeMultiElementDescriptor({ ...element, elementKey }, `要素${rowIndex + 1}`)
        : row
    ))
    activeMultiElementForecastConfigurationName.value = ''
    openMultiMap(multiMapMode.value)
  }

  function setMultiElementConfigurationName(value) {
    multiElementConfigurationName.value = String(value || '')
  }

  function nextMultiElementConfigurationName() {
    let index = 1
    while (multiElementConfigurations.value.some((configuration) => configuration.name === `配置${index}`)) {
      index += 1
    }
    return `配置${index}`
  }

  function createMultiElementConfiguration() {
    multiMapPanels.value = defaultMultiElementPanels().map(multiElementPanelView)
    multiMapMode.value = 'element'
    activeMultiElementConfigurationName.value = ''
    multiElementConfigurationName.value = nextMultiElementConfigurationName()
  }

  function loadMultiElementConfigurations() {
    if (typeof window === 'undefined') return []
    try {
      const parsed = JSON.parse(window.localStorage.getItem(MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY) || '[]')
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((configuration) => configuration?.name && Array.isArray(configuration.panels))
        .map((configuration) => ({
          name: String(configuration.name),
          panels: configuration.panels.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
        }))
        .filter((configuration) => configuration.panels.length)
    } catch {
      return []
    }
  }

  function persistMultiElementConfigurations() {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY,
      JSON.stringify(multiElementConfigurations.value)
    )
  }

  function saveMultiElementConfiguration(nameOverride = '') {
    if (multiMapMode.value !== 'element' || !multiMapPanels.value.length) return
    const name = String(nameOverride || multiElementConfigurationName.value).trim() || nextMultiElementConfigurationName()
    const record = {
      name,
      panels: multiMapPanels.value.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
    }
    const existingIndex = multiElementConfigurations.value.findIndex((configuration) => configuration.name === name)
    if (existingIndex >= 0) multiElementConfigurations.value.splice(existingIndex, 1, record)
    else multiElementConfigurations.value.push(record)

    activeMultiElementConfigurationName.value = name
    multiElementConfigurationName.value = name
    persistMultiElementConfigurations()
  }

  function renameMultiElementConfiguration(currentName, nextName) {
    const from = String(currentName || '').trim()
    const to = String(nextName || '').trim()
    if (!from || !to || from === to) return false
    const currentIndex = multiElementConfigurations.value.findIndex((configuration) => configuration.name === from)
    if (currentIndex < 0 || multiElementConfigurations.value.some((configuration) => configuration.name === to)) return false

    const configuration = multiElementConfigurations.value[currentIndex]
    multiElementConfigurations.value.splice(currentIndex, 1, { ...configuration, name: to })
    if (activeMultiElementConfigurationName.value === from) activeMultiElementConfigurationName.value = to
    if (multiElementConfigurationName.value === from) multiElementConfigurationName.value = to
    persistMultiElementConfigurations()
    return true
  }

  function applyMultiElementConfiguration(configuration) {
    if (!configuration?.name || !Array.isArray(configuration.panels) || !configuration.panels.length) return
    const panels = configuration.panels.map((panel, index) => normalizeMultiElementDescriptor(panel, `配置${index + 1}`))
    if (multiElementPanelCountOptions.includes(panels.length)) {
      multiElementPanelCount.value = panels.length
    }
    multiMapPanels.value = panels.map(multiElementPanelView)
    multiMapMode.value = 'element'
    activeMultiElementConfigurationName.value = configuration.name
    multiElementConfigurationName.value = configuration.name
  }

  function deleteMultiElementConfiguration(name) {
    multiElementConfigurations.value = multiElementConfigurations.value.filter((configuration) => configuration.name !== name)
    if (activeMultiElementConfigurationName.value === name) activeMultiElementConfigurationName.value = ''
    persistMultiElementConfigurations()
  }

  function setMultiElementForecastConfigurationName(value) {
    multiElementForecastConfigurationName.value = String(value || '')
  }

  function nextMultiElementForecastConfigurationName() {
    let index = 1
    while (multiElementForecastConfigurations.value.some((configuration) => configuration.name === `配置${index}`)) {
      index += 1
    }
    return `配置${index}`
  }

  function createMultiElementForecastConfiguration() {
    multiElementForecastRows.value = defaultMultiElementForecastRows()
    const mode = multiMapMode.value === 'element_init' ? 'element_init' : 'element_forecast'
    multiMapMode.value = mode
    activeMultiElementForecastConfigurationName.value = ''
    multiElementForecastConfigurationName.value = nextMultiElementForecastConfigurationName()
    openMultiMap(mode)
  }

  function loadMultiElementForecastConfigurations() {
    if (typeof window === 'undefined') return []
    try {
      const parsed = JSON.parse(window.localStorage.getItem(MULTI_ELEMENT_FORECAST_CONFIGURATION_STORAGE_KEY) || '[]')
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((configuration) => configuration?.name && Array.isArray(configuration.rows))
        .map((configuration) => ({
          name: String(configuration.name),
          rows: configuration.rows.map((row, index) => normalizeMultiElementDescriptor(row, `要素${index + 1}`)),
          forecastInterval: ['6', '24', '48', 'continuous'].includes(String(configuration.forecastInterval))
            ? String(configuration.forecastInterval)
            : '24',
          forecastPanelCount: [4, 6, 8, 9].includes(Number(configuration.forecastPanelCount))
            ? Number(configuration.forecastPanelCount)
            : 4
        }))
        .filter((configuration) => configuration.rows.length)
    } catch {
      return []
    }
  }

  function persistMultiElementForecastConfigurations() {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      MULTI_ELEMENT_FORECAST_CONFIGURATION_STORAGE_KEY,
      JSON.stringify(multiElementForecastConfigurations.value)
    )
  }

  function saveMultiElementForecastConfiguration(nameOverride = '') {
    if (!['element_forecast', 'element_init'].includes(multiMapMode.value) || !multiElementForecastRows.value.length) return
    const name = String(nameOverride || multiElementForecastConfigurationName.value).trim()
      || nextMultiElementForecastConfigurationName()
    const record = {
      name,
      rows: multiElementForecastRows.value.map((row, index) => normalizeMultiElementDescriptor(row, `要素${index + 1}`)),
      forecastInterval: multiForecastInterval.value,
      forecastPanelCount: multiForecastPanelCount.value
    }
    const existingIndex = multiElementForecastConfigurations.value.findIndex((configuration) => configuration.name === name)
    if (existingIndex >= 0) multiElementForecastConfigurations.value.splice(existingIndex, 1, record)
    else multiElementForecastConfigurations.value.push(record)

    activeMultiElementForecastConfigurationName.value = name
    multiElementForecastConfigurationName.value = name
    persistMultiElementForecastConfigurations()
  }

  function renameMultiElementForecastConfiguration(currentName, nextName) {
    const from = String(currentName || '').trim()
    const to = String(nextName || '').trim()
    if (!from || !to || from === to) return false
    const currentIndex = multiElementForecastConfigurations.value.findIndex((configuration) => configuration.name === from)
    if (currentIndex < 0 || multiElementForecastConfigurations.value.some((configuration) => configuration.name === to)) return false

    const configuration = multiElementForecastConfigurations.value[currentIndex]
    multiElementForecastConfigurations.value.splice(currentIndex, 1, { ...configuration, name: to })
    if (activeMultiElementForecastConfigurationName.value === from) activeMultiElementForecastConfigurationName.value = to
    if (multiElementForecastConfigurationName.value === from) multiElementForecastConfigurationName.value = to
    persistMultiElementForecastConfigurations()
    return true
  }

  function applyMultiElementForecastConfiguration(configuration) {
    if (!configuration?.name || !Array.isArray(configuration.rows) || !configuration.rows.length) return
    multiElementForecastRows.value = configuration.rows.map((row, index) => normalizeMultiElementDescriptor(row, `要素${index + 1}`))
    const mode = multiMapMode.value === 'element_init' ? 'element_init' : 'element_forecast'
    if (mode === 'element_forecast' && multiForecastIntervalOptions.some((option) => option.value === configuration.forecastInterval)) {
      multiForecastInterval.value = configuration.forecastInterval
    }
    if (mode === 'element_forecast' && multiForecastPanelCountOptions.includes(Number(configuration.forecastPanelCount))) {
      multiForecastPanelCount.value = Number(configuration.forecastPanelCount)
    }
    multiMapMode.value = mode
    activeMultiElementForecastConfigurationName.value = configuration.name
    multiElementForecastConfigurationName.value = configuration.name
    openMultiMap(mode)
  }

  function deleteMultiElementForecastConfiguration(name) {
    multiElementForecastConfigurations.value = multiElementForecastConfigurations.value.filter((configuration) => configuration.name !== name)
    if (activeMultiElementForecastConfigurationName.value === name) activeMultiElementForecastConfigurationName.value = ''
    persistMultiElementForecastConfigurations()
  }

  function openMultiMap(mode) {
    if (!multiMapModeOptions.some((option) => option.value === mode)) return
    const isModeChange = multiMapMode.value !== mode
    // 从单图进入多图时先收起识别面板，避免压缩默认的多图对比视野；多图内部切换不改变用户选择。
    if (!multiMapMode.value) showControlRail.value = false
    initializeMultiMapView(isModeChange)

    // 该矩阵模式默认以 4 个起报行和 4 个预报时效列打开；
    // 同一模式内修改控制项时不会触发重置。
    if (mode === 'init_forecast' && isModeChange) {
      multiInitPanelCount.value = 4
      multiForecastPanelCount.value = 4
    }

    if (mode === 'init') {
      multiMapPanels.value = multiInitDescriptors().map((descriptor, index) => {
        const { initTime: panelInitTime, fcHour: panelFcHour } = descriptor
        return panelView({
          id: `init-${panelInitTime}-${panelFcHour}-${index}`,
          title: `${panelInitTime} 起报`,
          initTime: panelInitTime,
          fcHour: panelFcHour
        })
      })
    } else if (mode === 'forecast') {
      multiMapPanels.value = multiForecastDescriptors().map(({ value, valid }, index) => panelView({
        id: `forecast-${initTime.value}-${multiForecastInterval.value}-${index}-${value || 'invalid'}`,
        title: value ? `+${value} h` : '无可用时效',
        fcHour: value || fcHour.value,
        preloadFcHours: pagePreloadFcHours(value),
        showPanelTitle: false,
        valid
      }))
    } else if (mode === 'element') {
      multiMapPanels.value = multiElementPanels().map(multiElementPanelView)
    } else if (mode === 'element_forecast') {
      multiMapPanels.value = multiElementForecastPanelViews()
    } else if (mode === 'init_forecast') {
      multiMapPanels.value = multiInitForecastPanelViews()
    } else {
      multiMapPanels.value = multiElementInitPanelViews()
    }

    multiMapMode.value = mode
  }

  function closeMultiMap() {
    multiMapMode.value = null
    multiMapPanels.value = []
  }

  function refreshMultiMapData() {
    if (!multiMapMode.value) return
    const latestInitTime = calLatestBaseTime()
    const changed = initTime.value !== latestInitTime
    initTime.value = latestInitTime
    if (!changed) openMultiMap(multiMapMode.value)
  }

  // 用本模块的加载器填充 store 中初始为空的三处配置状态（store 无法直接依赖本模块）。
  multiElementConfigurations.value = loadMultiElementConfigurations()
  multiElementForecastRows.value = defaultMultiElementForecastRows()
  multiElementForecastConfigurations.value = loadMultiElementForecastConfigurations()

  return {
    panelView,
    multiForecastDescriptors,
    pagePreloadFcHours,
    multiInitDescriptors,
    multiInitForecastPanelViews,
    setMultiInitInterval,
    setMultiInitPanelCount,
    setMultiForecastInterval,
    setMultiForecastPanelCount,
    setMultiElementPanelCount,
    shiftMultiForecastPage,
    canShiftMultiForecastBackward,
    canShiftMultiForecastForward,
    normalizeMultiElementDescriptor,
    multiElementCandidates,
    multiElementPanels,
    defaultMultiElementPanels,
    multiElementPanelView,
    updateMultiElementPanel,
    defaultMultiElementForecastRows,
    multiElementForecastPanelViews,
    multiElementInitPanelViews,
    updateMultiElementForecastPanel,
    setMultiElementConfigurationName,
    createMultiElementConfiguration,
    saveMultiElementConfiguration,
    renameMultiElementConfiguration,
    applyMultiElementConfiguration,
    deleteMultiElementConfiguration,
    setMultiElementForecastConfigurationName,
    createMultiElementForecastConfiguration,
    saveMultiElementForecastConfiguration,
    renameMultiElementForecastConfiguration,
    applyMultiElementForecastConfiguration,
    deleteMultiElementForecastConfiguration,
    openMultiMap,
    refreshMultiMapData,
    closeMultiMap
  }
}
