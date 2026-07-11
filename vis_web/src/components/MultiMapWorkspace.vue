<script setup>
import { ChevronLeft, ChevronRight, Pencil, Plus, Save, Settings, Trash2, X } from 'lucide-vue-next'
import { NButton, NButtonGroup, NInput, NModal, NPopover, NSelect, NTooltip } from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'
import ElementSelector from './ElementSelector.vue'
import ForecastSlider from './ForecastSlider.vue'
import MultiMapPanel from './MultiMapPanel.vue'

const {
  canShiftMultiForecastBackward,
  canShiftMultiForecastForward,
  closeMultiMap,
  activeMultiElementConfigurationName,
  applyMultiElementConfiguration,
  createMultiElementConfiguration,
  deleteMultiElementConfiguration,
  multiInitInterval,
  multiInitIntervalOptions,
  multiInitPanelCount,
  multiInitPanelCountOptions,
  multiMapMode,
  multiMapModeOptions,
  multiMapPanels,
  multiForecastInterval,
  multiForecastIntervalOptions,
  multiForecastPanelCount,
  multiForecastPanelCountOptions,
  multiElementConfigurationName,
  multiElementConfigurations,
  multiElementPanelCount,
  multiElementPanelCountOptions,
  renameMultiElementConfiguration,
  saveMultiElementConfiguration,
  setMultiInitInterval,
  setMultiInitPanelCount,
  setMultiElementPanelCount,
  setMultiForecastInterval,
  setMultiForecastPanelCount,
  shiftMultiForecastPage,
  updateMultiElementPanel
} = useWeatherViewContext()

const modeLabel = computed(() => (
  multiMapModeOptions.find((option) => option.value === multiMapMode.value)?.label || '多图模式'
))
const isForecastMode = computed(() => multiMapMode.value === 'forecast')
const isInitMode = computed(() => multiMapMode.value === 'init')
const isElementMode = computed(() => multiMapMode.value === 'element')
const activeElementPanelIndex = ref(0)
const showElementSettings = ref(false)
const showSaveConfigurationDialog = ref(false)
const showDeleteConfigurationDialog = ref(false)
const configurationNameDraft = ref('')
const configurationPendingDeletion = ref(null)
const activeElementKey = computed(() => (
  multiMapPanels.value[activeElementPanelIndex.value]?.elementKey || ''
))
const multiElementConfigurationOptions = computed(() => multiElementConfigurations.value.map((configuration) => ({
  label: configuration.name,
  value: configuration.name
})))
const gridStyle = computed(() => {
  const count = multiMapPanels.value.length
  const columns = count === 8 ? 4 : count === 6 || count === 9 ? 3 : 2
  return {
    '--multi-map-columns': columns,
    '--multi-map-rows': Math.ceil(count / columns),
    '--multi-map-panel-count': count
  }
})

const syncState = reactive({
  cursor: null,
  zoom: null
})

function resetSyncState() {
  syncState.cursor = null
  syncState.zoom = null
}

function close() {
  resetSyncState()
  closeMultiMap()
}

function activateElementPanel(index) {
  if (isElementMode.value) activeElementPanelIndex.value = index
}

function applyElementToActivePanel(element, elementKey) {
  if (!isElementMode.value) return
  updateMultiElementPanel(activeElementPanelIndex.value, element, elementKey)
}

function selectMultiElementConfiguration(configuration) {
  applyMultiElementConfiguration(configuration)
  activeElementPanelIndex.value = 0
}

function selectMultiElementConfigurationByName(name) {
  const configuration = multiElementConfigurations.value.find((item) => item.name === name)
  if (configuration) selectMultiElementConfiguration(configuration)
}

function createNewMultiElementConfiguration() {
  createMultiElementConfiguration()
  activeElementPanelIndex.value = 0
}

function requestSaveMultiElementConfiguration() {
  configurationNameDraft.value = multiElementConfigurationName.value.trim() || '配置1'
  showSaveConfigurationDialog.value = true
}

function confirmSaveMultiElementConfiguration() {
  const name = configurationNameDraft.value.trim()
  if (!name) return
  saveMultiElementConfiguration(name)
  showSaveConfigurationDialog.value = false
}

function renameActiveMultiElementConfiguration() {
  const nextName = multiElementConfigurationName.value.trim()
  if (!activeMultiElementConfigurationName.value || !nextName) return
  renameMultiElementConfiguration(activeMultiElementConfigurationName.value, nextName)
}

function requestDeleteMultiElementConfiguration(configuration) {
  configurationPendingDeletion.value = configuration
  showDeleteConfigurationDialog.value = true
}

function confirmDeleteMultiElementConfiguration() {
  const configuration = configurationPendingDeletion.value
  if (configuration) deleteMultiElementConfiguration(configuration.name)
  configurationPendingDeletion.value = null
  showDeleteConfigurationDialog.value = false
}

watch(multiMapMode, (mode) => {
  if (mode) {
    resetSyncState()
    activeElementPanelIndex.value = 0
  }
})

watch(multiMapPanels, (panels) => {
  if (activeElementPanelIndex.value >= panels.length) {
    activeElementPanelIndex.value = Math.max(0, panels.length - 1)
  }
})
</script>

<template>
  <section class="multi-map-workspace">
    <header class="multi-map-header">
      <div class="multi-map-heading">
        <strong>{{ modeLabel }}</strong>
        <div v-if="isInitMode" class="multi-map-controls">
          <div class="multi-map-control-group">
            <span>起报间隔</span>
            <n-button-group size="small">
              <n-button
                v-for="option in multiInitIntervalOptions"
                :key="option.value"
                :type="multiInitInterval === option.value ? 'primary' : 'default'"
                @click="setMultiInitInterval(option.value)"
              >
                {{ option.label }}
              </n-button>
            </n-button-group>
          </div>
          <div class="multi-map-control-group">
            <span>子图数量</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiInitPanelCountOptions"
                :key="count"
                :type="multiInitPanelCount === count ? 'primary' : 'default'"
                @click="setMultiInitPanelCount(count)"
              >
                {{ count }} 图
              </n-button>
            </n-button-group>
          </div>
        </div>
        <div v-if="isElementMode" class="multi-map-controls multi-element-controls">
          <div class="multi-map-control-group">
            <span>子图数量</span>
            <n-button-group size="small">
              <n-button
                v-for="count in multiElementPanelCountOptions"
                :key="count"
                :type="multiElementPanelCount === count ? 'primary' : 'default'"
                @click="setMultiElementPanelCount(count)"
              >
                {{ count }} 图
              </n-button>
            </n-button-group>
          </div>
          <n-button size="small" secondary @click="showElementSettings = true">
            <template #icon><Settings :size="15" /></template>
            设置
          </n-button>
          <n-button size="small" secondary @click="requestSaveMultiElementConfiguration">
            <template #icon><Save :size="15" /></template>
            保存配置
          </n-button>
          <n-popover v-if="multiElementConfigurations.length" trigger="hover" placement="bottom-start" :show-arrow="false">
            <template #trigger>
              <n-button size="small" secondary>
                {{ activeMultiElementConfigurationName || '选择配置' }}
              </n-button>
            </template>
            <div class="multi-element-configuration-menu">
              <n-button
                v-for="configuration in multiElementConfigurations"
                :key="configuration.name"
                size="small"
                block
                :type="activeMultiElementConfigurationName === configuration.name ? 'primary' : 'default'"
                @click="selectMultiElementConfiguration(configuration)"
              >
                {{ configuration.name }}
              </n-button>
            </div>
          </n-popover>
          <ElementSelector
            header-trigger
            wide
            :active-element-key="activeElementKey"
            :selection-handler="applyElementToActivePanel"
          />
        </div>
        <div v-if="isForecastMode" class="multi-forecast-controls">
          <n-button-group size="small">
            <n-button
              v-for="option in multiForecastIntervalOptions"
              :key="option.value"
              :type="multiForecastInterval === option.value ? 'primary' : 'default'"
              @click="setMultiForecastInterval(option.value)"
            >
              {{ option.label }}
            </n-button>
          </n-button-group>
          <n-button-group size="small">
            <n-button
              v-for="count in multiForecastPanelCountOptions"
              :key="count"
              :type="multiForecastPanelCount === count ? 'primary' : 'default'"
              @click="setMultiForecastPanelCount(count)"
            >
              {{ count }} 图
            </n-button>
          </n-button-group>
          <n-button-group size="small">
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button secondary :disabled="!canShiftMultiForecastBackward" @click="shiftMultiForecastPage(-1)">
                  <ChevronLeft :size="16" />
                </n-button>
              </template>
              向前切换一组时效
            </n-tooltip>
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button secondary :disabled="!canShiftMultiForecastForward" @click="shiftMultiForecastPage(1)">
                  <ChevronRight :size="16" />
                </n-button>
              </template>
              向后切换一组时效
            </n-tooltip>
          </n-button-group>
        </div>
      </div>
      <n-button size="small" secondary @click="close">
        <template #icon><X :size="15" /></template>
        退出多图
      </n-button>
    </header>

    <ForecastSlider />

    <n-modal
      v-model:show="showElementSettings"
      preset="card"
      title="多要素配置设置"
      style="width: 760px; max-width: 94vw;"
    >
      <div class="multi-element-settings">
        <div class="multi-element-configuration-row">
          <n-select
            :value="activeMultiElementConfigurationName || null"
            size="small"
            clearable
            placeholder="选择已保存配置"
            :options="multiElementConfigurationOptions"
            @update:value="selectMultiElementConfigurationByName"
          />
          <n-button size="small" secondary @click="createNewMultiElementConfiguration">
            <template #icon><Plus :size="15" /></template>
            新建配置
          </n-button>
        </div>
        <div class="multi-element-save-row">
          <n-input v-model:value="multiElementConfigurationName" size="small" placeholder="配置名称，如 配置1" />
          <n-button
            size="small"
            secondary
            :disabled="!activeMultiElementConfigurationName || multiElementConfigurationName === activeMultiElementConfigurationName"
            @click="renameActiveMultiElementConfiguration"
          >
            <template #icon><Pencil :size="15" /></template>
            重命名
          </n-button>
          <n-button size="small" type="primary" @click="requestSaveMultiElementConfiguration">
            <template #icon><Save :size="15" /></template>
            保存配置
          </n-button>
        </div>
        <div class="multi-element-count-row">
          <span>子图数量</span>
          <n-button-group size="small">
            <n-button
              v-for="count in multiElementPanelCountOptions"
              :key="count"
              :type="multiElementPanelCount === count ? 'primary' : 'default'"
              @click="setMultiElementPanelCount(count)"
            >
              {{ count }} 图
            </n-button>
          </n-button-group>
        </div>
        <p>逐一点击下方子图，再通过元素选择器指定该子图的层次和图层组合。</p>
        <div class="multi-element-panel-settings">
          <button
            v-for="(panel, index) in multiMapPanels"
            :key="panel.id"
            type="button"
            :class="{ active: activeElementPanelIndex === index }"
            @click="activateElementPanel(index)"
          >
            <strong>子图 {{ index + 1 }}</strong>
            <span>{{ panel.title }}</span>
            <small>{{ panel.level === 'surface' ? '地面' : `${panel.level} hPa` }}｜{{ panel.selectedLayerTypes.join(' + ') }}</small>
          </button>
        </div>
        <div class="multi-element-picker-row">
          <span>当前编辑：子图 {{ activeElementPanelIndex + 1 }}</span>
          <ElementSelector
            header-trigger
            :active-element-key="activeElementKey"
            :selection-handler="applyElementToActivePanel"
          />
        </div>
        <div v-if="multiElementConfigurations.length" class="multi-element-saved-configs">
          <span>已保存配置</span>
          <div>
            <div
              v-for="configuration in multiElementConfigurations"
              :key="configuration.name"
              class="multi-element-saved-config"
            >
              <n-button
                size="small"
                :type="activeMultiElementConfigurationName === configuration.name ? 'primary' : 'default'"
                @click="selectMultiElementConfiguration(configuration)"
              >
                {{ configuration.name }}
              </n-button>
              <n-button
                size="small"
                tertiary
                circle
                type="error"
                :aria-label="`删除${configuration.name}`"
                @click="requestDeleteMultiElementConfiguration(configuration)"
              >
                <template #icon><Trash2 :size="13" /></template>
              </n-button>
            </div>
          </div>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="showSaveConfigurationDialog"
      preset="card"
      title="保存多要素配置"
      style="width: 400px; max-width: 92vw;"
    >
      <n-input v-model:value="configurationNameDraft" autofocus placeholder="配置名称，如 配置1" @keyup.enter="confirmSaveMultiElementConfiguration" />
      <template #footer>
        <div class="multi-element-dialog-actions">
          <n-button size="small" @click="showSaveConfigurationDialog = false">取消</n-button>
          <n-button size="small" type="primary" @click="confirmSaveMultiElementConfiguration">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showDeleteConfigurationDialog"
      preset="card"
      title="删除多要素配置"
      style="width: 400px; max-width: 92vw;"
    >
      <p class="multi-element-confirm-copy">确定删除“{{ configurationPendingDeletion?.name }}”吗？此操作无法撤销。</p>
      <template #footer>
        <div class="multi-element-dialog-actions">
          <n-button size="small" @click="showDeleteConfigurationDialog = false">取消</n-button>
          <n-button size="small" type="error" @click="confirmDeleteMultiElementConfiguration">删除</n-button>
        </div>
      </template>
    </n-modal>

    <div class="multi-map-grid" :style="gridStyle">
      <MultiMapPanel
        v-for="(panel, index) in multiMapPanels"
        :key="panel.id"
        :panel="{ ...panel, syncId: panel.id, syncState }"
        :active="isElementMode && activeElementPanelIndex === index"
        @activate="activateElementPanel(index)"
      />
    </div>
  </section>
</template>
