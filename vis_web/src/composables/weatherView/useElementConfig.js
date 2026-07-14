// 要素选择器配置的增删改与拖拽排序，以及单图图层组合的保存/应用/删除、图层类型切换与要素应用。
// 均从原 useWeatherView.js 迁出，改为读 store。
import { cellKey, defaultElementConfig, persistElementConfig } from '../../utils/elementSelectorConfig'
import { LAYER_COMBINATION_STORAGE_KEY } from './constants'
import { layerLabel } from './helpers'

export function useElementConfig(store) {
  const {
    elementConfig,
    activeElementKey,
    selectedLayerTypes,
    layerType,
    level,
    activeLayerCombinationName,
    layerCombinationName,
    savedLayerCombinations,
    sanitizeLayerSelection,
    setSelectedLayerTypes
  } = store

  // —— 图层组合（单图）——
  function persistLayerCombinations() {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      LAYER_COMBINATION_STORAGE_KEY,
      JSON.stringify(savedLayerCombinations.value)
    )
  }

  function saveLayerCombination() {
    const name = layerCombinationName.value.trim() || activeLayerCombinationName.value.trim()
    const layers = sanitizeLayerSelection(selectedLayerTypes.value)
    if (!name || !layers.length) return

    const existingIndex = savedLayerCombinations.value.findIndex((item) => item.name === name)
    const record = { name, layers }
    if (existingIndex >= 0) {
      savedLayerCombinations.value.splice(existingIndex, 1, record)
    } else {
      savedLayerCombinations.value.push(record)
    }
    activeLayerCombinationName.value = name
    layerCombinationName.value = name
    persistLayerCombinations()
  }

  function applyLayerCombination(combination) {
    const next = setSelectedLayerTypes(combination.layers)
    layerType.value = next[0] || layerType.value
    activeLayerCombinationName.value = combination.name
    layerCombinationName.value = combination.name
  }

  function deleteLayerCombination(name) {
    savedLayerCombinations.value = savedLayerCombinations.value.filter((item) => item.name !== name)
    persistLayerCombinations()
  }

  function handleLayerTypeChange(value) {
    layerType.value = value
    setSelectedLayerTypes([value])
    activeLayerCombinationName.value = layerLabel(value)
    layerCombinationName.value = layerLabel(value)
    activeElementKey.value = ''
  }

  // 应用一个「要素」：切换层次并设置图层组合。id 用于在选择器中高亮当前项。
  function applyElementSelection(element, id) {
    if (!element) return
    const nextLevel = String(element.level || '')
    if (nextLevel) level.value = nextLevel

    const layers = Array.isArray(element.layers) ? element.layers : []
    if (layers.length) {
      const next = setSelectedLayerTypes(layers)
      layerType.value = next[0] || layerType.value
    }
    activeLayerCombinationName.value = element.label || activeLayerCombinationName.value
    layerCombinationName.value = element.label || layerCombinationName.value
    activeElementKey.value = id || ''
  }

  // —— 元素选择器配置的增删改（供配置界面调用），改动后立即持久化 —— //
  function commitElementConfig(nextConfig) {
    elementConfig.value = nextConfig
    persistElementConfig(nextConfig)
  }

  function cloneElementConfig() {
    return JSON.parse(JSON.stringify(elementConfig.value))
  }

  // 设置某个单元格（层次×列）的要素列表。
  function setCellElements(levelValue, columnKey, elements) {
    const next = cloneElementConfig()
    const key = cellKey(levelValue, columnKey)
    const list = (elements || [])
      .map((el) => ({
        label: String(el.label || '').trim(),
        level: String(el.level || levelValue),
        layers: Array.isArray(el.layers) ? el.layers.map(String).filter(Boolean) : []
      }))
      .filter((el) => el.label)
    if (list.length) next.cells[key] = list
    else delete next.cells[key]
    commitElementConfig(next)
  }

  // 新增 / 删除垂直层次行。
  function addElementLevel(levelDef) {
    const value = String(levelDef?.value || '').trim()
    if (!value) return
    const next = cloneElementConfig()
    if (next.levels.some((lvl) => lvl.value === value)) return
    next.levels.push({ value, label: String(levelDef.label || value) })
    commitElementConfig(next)
  }

  function removeElementLevel(levelValue) {
    const next = cloneElementConfig()
    next.levels = next.levels.filter((lvl) => lvl.value !== levelValue)
    Object.keys(next.cells).forEach((key) => {
      if (key.startsWith(`${levelValue}|`)) delete next.cells[key]
    })
    commitElementConfig(next)
  }

  // 新增 / 删除单层要素分组集合。
  function addSingleLayerGroup(group) {
    const key = String(group?.key || '').trim()
    const title = String(group?.title || '').trim()
    if (!title) return
    const next = cloneElementConfig()
    const finalKey = key || `group_${next.singleLayerGroups.length + 1}`
    next.singleLayerGroups.push({
      key: finalKey,
      title,
      color: String(group.color || '#e2e8f0'),
      elements: []
    })
    commitElementConfig(next)
  }

  function removeSingleLayerGroup(groupKey) {
    const next = cloneElementConfig()
    next.singleLayerGroups = next.singleLayerGroups.filter((group) => group.key !== groupKey)
    commitElementConfig(next)
  }

  // 设置某个单层分组的要素列表。
  function setSingleLayerGroupElements(groupKey, elements) {
    const next = cloneElementConfig()
    const group = next.singleLayerGroups.find((item) => item.key === groupKey)
    if (!group) return
    group.elements = (elements || [])
      .map((el) => ({
        label: String(el.label || '').trim(),
        level: String(el.level || 'surface'),
        layers: Array.isArray(el.layers) ? el.layers.map(String).filter(Boolean) : []
      }))
      .filter((el) => el.label)
    commitElementConfig(next)
  }

  function resetElementConfig() {
    commitElementConfig(defaultElementConfig())
  }

  // 拖拽排序：垂直层次 / 单层要素集合。
  function reorderElementLevels(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    const next = cloneElementConfig()
    if (fromIndex >= next.levels.length || toIndex >= next.levels.length) return
    const [moved] = next.levels.splice(fromIndex, 1)
    next.levels.splice(toIndex, 0, moved)
    commitElementConfig(next)
  }

  function reorderSingleLayerGroups(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    const next = cloneElementConfig()
    if (fromIndex >= next.singleLayerGroups.length || toIndex >= next.singleLayerGroups.length) return
    const [moved] = next.singleLayerGroups.splice(fromIndex, 1)
    next.singleLayerGroups.splice(toIndex, 0, moved)
    commitElementConfig(next)
  }

  return {
    saveLayerCombination,
    applyLayerCombination,
    deleteLayerCombination,
    handleLayerTypeChange,
    applyElementSelection,
    commitElementConfig,
    setCellElements,
    addElementLevel,
    removeElementLevel,
    addSingleLayerGroup,
    removeSingleLayerGroup,
    setSingleLayerGroupElements,
    resetElementConfig,
    reorderElementLevels,
    reorderSingleLayerGroups
  }
}
