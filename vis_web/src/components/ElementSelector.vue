<script setup>
import { GripVertical, LayoutGrid, Plus, RotateCcw, Settings, Trash2 } from 'lucide-vue-next'
import {
  NButton,
  NColorPicker,
  NInput,
  NModal,
  NPopover,
  NSelect,
  NTabPane,
  NTabs
} from 'naive-ui'
import { computed, reactive, ref } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'
import { cellKey } from '../utils/elementSelectorConfig'

const {
  elementConfig,
  activeElementKey,
  applyElementSelection,
  setCellElements,
  addElementLevel,
  removeElementLevel,
  addSingleLayerGroup,
  removeSingleLayerGroup,
  setSingleLayerGroupElements,
  resetElementConfig,
  reorderElementLevels,
  reorderSingleLayerGroups,
  elementLayerTypeOptions
} = useWeatherViewContext()

const props = defineProps({
  activeElementKey: {
    type: String,
    default: null
  },
  selectionHandler: {
    type: Function,
    default: null
  },
  headerTrigger: Boolean,
  wide: Boolean
})

const showConfig = ref(false)

const columns = computed(() => elementConfig.value.columns)
const levels = computed(() => elementConfig.value.levels)
const singleLayerGroups = computed(() => elementConfig.value.singleLayerGroups)
const selectedElementKey = computed(() => props.activeElementKey ?? activeElementKey.value)

const layerSelectOptions = elementLayerTypeOptions.map((option) => ({
  label: `${option.label}（${option.value}）`,
  value: option.value
}))

function levelSelectOptions() {
  return levels.value.map((lvl) => ({ label: lvl.label, value: lvl.value }))
}

function columnSelectOptions() {
  return columns.value.map((col) => ({ label: col.label, value: col.key }))
}

function cellElements(levelValue, columnKey) {
  return elementConfig.value.cells[cellKey(levelValue, columnKey)] || []
}

// 网格要素标识：单元格 key + 序号。
function gridElementId(levelValue, columnKey, index) {
  return `${cellKey(levelValue, columnKey)}#${index}`
}

function singleElementId(groupKey, index) {
  return `single:${groupKey}#${index}`
}

function pickGrid(levelValue, columnKey, index, element) {
  applySelection(element, gridElementId(levelValue, columnKey, index))
}

function pickSingle(groupKey, index, element) {
  applySelection(element, singleElementId(groupKey, index))
}

function applySelection(element, elementKey) {
  if (props.selectionHandler) {
    props.selectionHandler(element, elementKey)
    return
  }
  applyElementSelection(element, elementKey)
}

function layerTip(element) {
  if (!element.layers?.length) return element.label
  return `${element.label}｜${element.layers.join(' + ')}`
}

// —— 配置编辑器的本地表单状态 —— //
const newLevel = reactive({ value: '', label: '' })

const gridForm = reactive({ level: '500', column: 'geopotential', label: '', layers: [] })
const gridEditElements = computed(() => {
  if (!gridForm.level || !gridForm.column) return []
  return cellElements(gridForm.level, gridForm.column)
})

const newGroup = reactive({ title: '', color: '#93c5fd' })
const groupForm = reactive({}) // groupKey -> { label, level, layers }

function groupFormState(groupKey) {
  if (!groupForm[groupKey]) {
    groupForm[groupKey] = { label: '', level: 'surface', layers: [] }
  }
  return groupForm[groupKey]
}

function submitLevel() {
  if (!newLevel.value.trim()) return
  addElementLevel({ value: newLevel.value.trim(), label: newLevel.label.trim() || newLevel.value.trim() })
  newLevel.value = ''
  newLevel.label = ''
}

function submitGridElement() {
  if (!gridForm.level || !gridForm.column || !gridForm.label.trim()) return
  const list = cellElements(gridForm.level, gridForm.column).map((el) => ({ ...el }))
  list.push({
    label: gridForm.label.trim(),
    level: gridForm.level,
    layers: [...gridForm.layers]
  })
  setCellElements(gridForm.level, gridForm.column, list)
  gridForm.label = ''
  gridForm.layers = []
}

function removeGridElement(index) {
  const list = cellElements(gridForm.level, gridForm.column).filter((_, i) => i !== index)
  setCellElements(gridForm.level, gridForm.column, list)
}

function submitGroup() {
  if (!newGroup.title.trim()) return
  addSingleLayerGroup({ title: newGroup.title.trim(), color: newGroup.color })
  newGroup.title = ''
}

function submitGroupElement(groupKey) {
  const form = groupFormState(groupKey)
  if (!form.label.trim()) return
  const group = singleLayerGroups.value.find((item) => item.key === groupKey)
  const list = (group?.elements || []).map((el) => ({ ...el }))
  list.push({
    label: form.label.trim(),
    level: form.level.trim() || 'surface',
    layers: [...form.layers]
  })
  setSingleLayerGroupElements(groupKey, list)
  form.label = ''
  form.layers = []
}

function removeGroupElement(groupKey, index) {
  const group = singleLayerGroups.value.find((item) => item.key === groupKey)
  const list = (group?.elements || []).filter((_, i) => i !== index)
  setSingleLayerGroupElements(groupKey, list)
}

function handleReset() {
  resetElementConfig()
}

// —— 拖拽排序（原生 HTML5 drag） —— //
const dragLevelIndex = ref(-1)
const dragGroupIndex = ref(-1)

function onLevelDrop(toIndex) {
  if (dragLevelIndex.value >= 0) reorderElementLevels(dragLevelIndex.value, toIndex)
  dragLevelIndex.value = -1
}

function onGroupDrop(toIndex) {
  if (dragGroupIndex.value >= 0) reorderSingleLayerGroups(dragGroupIndex.value, toIndex)
  dragGroupIndex.value = -1
}

function openConfig() {
  showConfig.value = true
}

defineExpose({ openConfig })
</script>

<template>
  <n-popover
    :trigger="headerTrigger ? 'click' : 'hover'"
    :placement="headerTrigger ? 'bottom-start' : 'right-start'"
    :show-arrow="false"
    :style="headerTrigger ? 'max-width: 96vw;' : 'max-width: 96vw; transform: translateY(-110px);'"
  >
    <template #trigger>
      <n-button v-if="headerTrigger" class="es-header-trigger" size="small" type="primary">
        <template #icon><LayoutGrid :size="15" /></template>
        天气要素选择器
      </n-button>
      <button v-else type="button" class="es-fab" aria-label="天气要素选择器">
        <LayoutGrid :size="20" />
      </button>
    </template>

    <div class="es-popover" :class="{ 'es-popover-wide': wide }">
      <div class="es-header">
        <div>
          <strong>天气要素选择器</strong>
          <span>左：高空要素（层次 × 要素）；右：单层要素。点击即切换层次与图层组合。</span>
        </div>
        <n-button size="small" secondary @click="showConfig = true">
          <template #icon><Settings :size="15" /></template>
          配置
        </n-button>
      </div>

      <div class="es-body">
        <!-- 左：高空要素网格 -->
        <div class="es-grid-box">
          <table class="es-grid">
            <thead>
              <tr>
                <th class="es-corner">高空要素</th>
                <th
                  v-for="col in columns"
                  :key="col.key"
                  :style="col.color ? { background: col.color } : null"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lvl in levels" :key="lvl.value">
                <th class="es-row-head">{{ lvl.label }}</th>
                <td v-for="col in columns" :key="col.key">
                  <div class="es-cell">
                    <button
                      v-for="(el, index) in cellElements(lvl.value, col.key)"
                      :key="index"
                      type="button"
                      class="es-el-btn"
                      :class="{ 'es-el-active': selectedElementKey === gridElementId(lvl.value, col.key, index) }"
                      :title="layerTip(el)"
                      @click="pickGrid(lvl.value, col.key, index, el)"
                    >
                      {{ el.label }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 右：单层要素 -->
        <div class="es-single-box">
          <div class="es-single-title">单层要素</div>
          <div class="es-single-groups">
            <div
              v-for="group in singleLayerGroups"
              :key="group.key"
              class="es-single-group"
              :style="{ background: group.color }"
            >
              <div class="es-single-group-title">{{ group.title }}</div>
              <div class="es-single-group-body">
                <button
                  v-for="(el, index) in group.elements"
                  :key="index"
                  type="button"
                  class="es-el-btn"
                  :class="{ 'es-el-active': selectedElementKey === singleElementId(group.key, index) }"
                  :title="layerTip(el)"
                  @click="pickSingle(group.key, index, el)"
                >
                  {{ el.label }}
                </button>
                <span v-if="!group.elements.length" class="es-empty">（空）</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </n-popover>

  <!-- 配置编辑器 -->
  <n-modal
    v-model:show="showConfig"
    preset="card"
    title="天气要素选择器配置"
    style="width: 720px; max-width: 94vw;"
  >
    <template #header-extra>
      <n-button size="small" tertiary @click="handleReset">
        <template #icon><RotateCcw :size="14" /></template>
        重置为默认
      </n-button>
    </template>

    <n-tabs type="line" animated>
      <!-- 垂直层次 -->
      <n-tab-pane name="levels" tab="垂直层次">
        <p class="cfg-muted">拖动 <GripVertical :size="12" style="display:inline;vertical-align:middle;" /> 手柄可调整层次顺序。</p>
        <div class="cfg-list">
          <div
            v-for="(lvl, index) in levels"
            :key="lvl.value"
            class="cfg-row cfg-draggable"
            :class="{ 'cfg-dragging': dragLevelIndex === index }"
            draggable="true"
            @dragstart="dragLevelIndex = index"
            @dragover.prevent
            @drop="onLevelDrop(index)"
            @dragend="dragLevelIndex = -1"
          >
            <GripVertical :size="15" class="cfg-grip" />
            <span class="cfg-tag">{{ lvl.label }}</span>
            <span class="cfg-muted">{{ lvl.value }}</span>
            <n-button size="tiny" tertiary type="error" @click="removeElementLevel(lvl.value)">
              <template #icon><Trash2 :size="13" /></template>
            </n-button>
          </div>
        </div>
        <div class="cfg-form">
          <n-input v-model:value="newLevel.value" size="small" placeholder="层次值，如 300 或 surface" style="width: 220px;" />
          <n-input v-model:value="newLevel.label" size="small" placeholder="显示名（可选）" style="width: 180px;" />
          <n-button size="small" type="primary" @click="submitLevel">
            <template #icon><Plus :size="14" /></template>
            添加层次
          </n-button>
        </div>
      </n-tab-pane>

      <!-- 高空要素放置 -->
      <n-tab-pane name="grid" tab="高空要素放置">
        <div class="cfg-form">
          <n-select
            v-model:value="gridForm.level"
            size="small"
            placeholder="层次"
            :options="levelSelectOptions()"
            style="width: 130px;"
          />
          <n-select
            v-model:value="gridForm.column"
            size="small"
            placeholder="列（要素类别）"
            :options="columnSelectOptions()"
            style="width: 150px;"
          />
        </div>

        <div v-if="gridForm.level && gridForm.column" class="cfg-sub">
          <div class="cfg-list">
            <div v-for="(el, index) in gridEditElements" :key="index" class="cfg-row">
              <span class="cfg-tag">{{ el.label }}</span>
              <span class="cfg-muted">{{ el.layers.join(' + ') || '仅切换层次' }}</span>
              <n-button size="tiny" tertiary type="error" @click="removeGridElement(index)">
                <template #icon><Trash2 :size="13" /></template>
              </n-button>
            </div>
            <p v-if="!gridEditElements.length" class="cfg-muted">该单元格暂无要素。</p>
          </div>
          <div class="cfg-form">
            <n-input v-model:value="gridForm.label" size="small" placeholder="要素名称" style="width: 150px;" />
            <n-select
              v-model:value="gridForm.layers"
              size="small"
              multiple
              placeholder="选择图层（可多选）"
              :options="layerSelectOptions"
              style="min-width: 260px; flex: 1;"
            />
            <n-button size="small" type="primary" @click="submitGridElement">
              <template #icon><Plus :size="14" /></template>
              添加
            </n-button>
          </div>
        </div>
        <p v-else class="cfg-muted">请选择「层次」与「列」以编辑对应单元格。</p>
      </n-tab-pane>

      <!-- 单层要素集合 -->
      <n-tab-pane name="single" tab="单层要素集合">
        <p class="cfg-muted">拖动集合标题栏的 <GripVertical :size="12" style="display:inline;vertical-align:middle;" /> 手柄可调整集合顺序。</p>
        <div class="cfg-groups">
          <div
            v-for="(group, gIndex) in singleLayerGroups"
            :key="group.key"
            class="cfg-group"
            :class="{ 'cfg-dragging': dragGroupIndex === gIndex }"
            @dragover.prevent
            @drop="onGroupDrop(gIndex)"
          >
            <div
              class="cfg-group-head"
              draggable="true"
              @dragstart="dragGroupIndex = gIndex"
              @dragend="dragGroupIndex = -1"
            >
              <GripVertical :size="15" class="cfg-grip" />
              <span class="cfg-swatch" :style="{ background: group.color }"></span>
              <strong>{{ group.title }}</strong>
              <n-button size="tiny" tertiary type="error" @click="removeSingleLayerGroup(group.key)">
                <template #icon><Trash2 :size="13" /></template>
              </n-button>
            </div>
            <div class="cfg-list">
              <div v-for="(el, index) in group.elements" :key="index" class="cfg-row">
                <span class="cfg-tag">{{ el.label }}</span>
                <span class="cfg-muted">{{ el.level }}｜{{ el.layers.join(' + ') || '仅切换层次' }}</span>
                <n-button size="tiny" tertiary type="error" @click="removeGroupElement(group.key, index)">
                  <template #icon><Trash2 :size="13" /></template>
                </n-button>
              </div>
            </div>
            <div class="cfg-form">
              <n-input v-model:value="groupFormState(group.key).label" size="small" placeholder="要素名称" style="width: 130px;" />
              <n-input v-model:value="groupFormState(group.key).level" size="small" placeholder="层次" style="width: 90px;" />
              <n-select
                v-model:value="groupFormState(group.key).layers"
                size="small"
                multiple
                placeholder="图层"
                :options="layerSelectOptions"
                style="min-width: 220px; flex: 1;"
              />
              <n-button size="small" secondary @click="submitGroupElement(group.key)">
                <template #icon><Plus :size="14" /></template>
              </n-button>
            </div>
          </div>
        </div>
        <div class="cfg-form cfg-newgroup">
          <n-input v-model:value="newGroup.title" size="small" placeholder="新集合名称，如 降水" style="width: 200px;" />
          <n-color-picker v-model:value="newGroup.color" size="small" :show-alpha="false" style="width: 120px;" />
          <n-button size="small" type="primary" @click="submitGroup">
            <template #icon><Plus :size="14" /></template>
            添加集合
          </n-button>
        </div>
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<style scoped>
.es-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(21, 31, 46, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 24px rgba(22, 33, 47, 0.12);
  backdrop-filter: blur(8px);
  color: #1f7a8c;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.es-fab:hover {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.es-popover {
  display: grid;
  gap: 10px;
  max-width: 92vw;
}

.es-popover-wide {
  width: min(1180px, calc(100vw - 48px));
}

.es-popover-wide .es-body {
  width: 100%;
}

.es-popover-wide .es-grid-box {
  flex: 1 1 auto;
  min-width: 0;
}

.es-popover-wide .es-grid {
  width: 100%;
}

.es-popover-wide .es-single-box {
  min-width: 250px;
}

:deep(.es-header-trigger.n-button) {
  border-color: #0369a1;
  background: #0369a1;
  box-shadow: 0 4px 12px rgba(3, 105, 161, 0.28);
}

:deep(.es-header-trigger.n-button:hover) {
  border-color: #075985;
  background: #075985;
}

.es-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.es-header strong {
  display: block;
  color: #172033;
  font-size: 14px;
}

.es-header span {
  color: #667487;
  font-size: 12px;
}

.es-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  overflow: auto;
}

.es-grid-box {
  overflow: auto;
}

.es-grid {
  border-collapse: collapse;
  font-size: 12px;
  color: #384456;
}

.es-grid th,
.es-grid td {
  border: 1px solid #cbd5e1;
  padding: 2px;
  text-align: center;
  vertical-align: top;
}

.es-corner,
.es-row-head {
  background: #f1f5f9;
  font-weight: 600;
  white-space: nowrap;
  padding: 0 8px;
}

.es-grid thead th {
  white-space: nowrap;
  font-weight: 600;
}

.es-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 64px;
  min-height: 20px;
}

.es-el-btn {
  display: inline-block;
  padding: 2px 6px;
  border: 1px solid #0369a1;
  border-radius: 6px;
  background: #e0f2fe;
  color: #075985;
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.es-el-btn:hover {
  background: #0369a1;
  color: #fff;
}

.es-el-active {
  background: #075985;
  color: #fff;
  box-shadow: inset 0 0 0 2px #082f49;
}

.es-single-box {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
}

.es-single-title {
  text-align: center;
  font-weight: 700;
  color: #172033;
  font-size: 13px;
}

.es-single-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.es-single-group {
  border-radius: 6px;
  padding: 5px 6px;
  min-width: 96px;
}

.es-single-group-title {
  text-align: center;
  font-weight: 700;
  font-size: 12px;
  color: #1f2937;
  margin-bottom: 4px;
}

.es-single-group-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
}

.es-empty {
  color: rgba(31, 41, 55, 0.55);
  font-size: 11px;
  text-align: center;
}

/* —— 配置编辑器 —— */
.cfg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.cfg-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cfg-draggable {
  padding: 4px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
}

.cfg-grip {
  color: #9ca3af;
  cursor: grab;
  flex: none;
}

.cfg-grip:active {
  cursor: grabbing;
}

.cfg-dragging {
  opacity: 0.5;
  border-style: dashed;
  border-color: #2563eb;
}

.cfg-tag {
  font-weight: 600;
  color: #1f2937;
}

.cfg-muted {
  color: #6b7280;
  font-size: 12px;
  flex: 1;
}

.cfg-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.cfg-sub {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #d1d5db;
}

.cfg-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 46vh;
  overflow: auto;
  padding-right: 4px;
}

.cfg-group {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
}

.cfg-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cfg-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.cfg-newgroup {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}
</style>
