<script setup>
import { Save, Settings, Trash2 } from 'lucide-vue-next'
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NInputNumber,
  NPopover,
  NSelect,
  NSwitch,
  NTag,
  NTooltip
} from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'
import PushSubscribeButton from './PushSubscribeButton.vue'
import { loadPrefetchOptions } from '../utils/prefetchOptions'
import {
  EMPTY_PREFETCH_STATUS,
  isServiceWorkerSupported,
  requestPrefetchStatus,
  subscribePrefetchStatus
} from '../utils/swClient'

const swSupported = isServiceWorkerSupported()
const swPrefetchStatus = ref({
  ...EMPTY_PREFETCH_STATUS,
  state: loadPrefetchOptions().enabled ? 'idle' : 'disabled'
})
const SW_STATE_LABELS = {
  disabled: '未启用', idle: '空闲', manifest: '读取 Manifest', prefetching: '预加载中',
  paused: '前台请求暂停', complete: '已完成', storage_limited: '存储受限', error: '失败'
}
const swStateLabel = computed(() => (
  swSupported ? (SW_STATE_LABELS[swPrefetchStatus.value.state] || '空闲') : '未启用'
))
let unsubscribePrefetchStatus = null
onMounted(() => {
  unsubscribePrefetchStatus = subscribePrefetchStatus((next) => { swPrefetchStatus.value = next })
  requestPrefetchStatus()
})
onBeforeUnmount(() => unsubscribePrefetchStatus?.())

const {
  activeSystemTab,
  activeLayerCombinationName,
  applyLayerCombination,
  deleteLayerCombination,
  errorMessage,
  fcHour,
  fcHourOptions,
  handleLayerTypeChange,
  isVortexTrackLevel,
  jetLineWidth,
  jetMinAvgWindSpeed,
  jetMinAxisLength,
  jetMinMaxWindSpeed,
  layerCombinationName,
  layerCombinationOptions,
  layerOptions,
  layerStatus,
  layerType,
  level,
  levelOptions,
  loadingState,
  saveLayerCombination,
  savedLayerCombinations,
  selectedLayerLabels,
  selectedLayerTypes,
  SHEAR_COLORS,
  showHistoricalVortexTracks,
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
  showOnlyActiveVortexTracks,
  systemTabs,
  troughLineWidth,
  troughMinLength,
  troughMinWindSpeed,
  troughShearFilters,
  troughShearOptions,
  visibleJetAxisCount,
  visibleColdFrontCount,
  visibleTroughCount,
  visibleVortexCenterCount,
  visibleVortexTrackCount,
  vortexMinVorticity,
  vortexMinWindSpeed,
  vortexTrackMinWindSpeed
} = useWeatherViewContext()

</script>

<template>
  <aside class="control-rail">
    <div class="brand-block">
      <div class="brand-heading" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <h1>天气系统识别</h1>
        <PushSubscribeButton />
      </div>
      <p>SVG 图层与天气系统交互查看</p>
    </div>

    <section class="control-section two-column">
      <div>
        <label>预报时效</label>
        <n-select v-model:value="fcHour" size="small" :options="fcHourOptions" />
      </div>
      <div>
        <label>气压层</label>
        <n-select v-model:value="level" size="small" :options="levelOptions" />
      </div>
    </section>

    <section class="control-section">
      <label>天气图组合</label>
      <div class="inline-control layer-combo-row">
        <n-select
          :value="layerType"
          size="small"
          :options="layerOptions"
          @update:value="handleLayerTypeChange"
        />
        <n-popover trigger="click" placement="right-start" :width="304">
          <template #trigger>
            <n-button size="small" secondary circle>
              <Settings :size="16" />
            </n-button>
          </template>
          <div class="layer-popover">
            <div class="layer-popover-header">
              <strong>{{ activeLayerCombinationName }}</strong>
              <span>{{ selectedLayerLabels }}</span>
            </div>

            <n-checkbox-group v-model:value="selectedLayerTypes">
              <div class="layer-checkbox-list">
                <n-checkbox
                  v-for="option in layerCombinationOptions"
                  :key="option.value"
                  :value="option.value"
                  :disabled="option.disabled"
                >
                  {{ option.label }}
                </n-checkbox>
              </div>
            </n-checkbox-group>

            <div class="save-combo-row">
              <n-input v-model:value="layerCombinationName" size="small" placeholder="组合名称" />
              <n-tooltip trigger="hover">
                <template #trigger>
                  <n-button size="small" secondary circle @click="saveLayerCombination">
                    <Save :size="15" />
                  </n-button>
                </template>
                保存当前组合
              </n-tooltip>
            </div>

            <div v-if="savedLayerCombinations.length" class="saved-combo-list">
              <div
                v-for="combo in savedLayerCombinations"
                :key="combo.name"
                class="saved-combo-item"
              >
                <button type="button" @click="applyLayerCombination(combo)">{{ combo.name }}</button>
                <n-button size="tiny" tertiary circle @click.stop="deleteLayerCombination(combo.name)">
                  <Trash2 :size="13" />
                </n-button>
              </div>
            </div>
          </div>
        </n-popover>
      </div>
      <p class="selection-summary">{{ selectedLayerLabels }}</p>
    </section>

    <section class="switch-list">
      <label><span>SVG 图层</span><n-switch v-model:value="showSvgLayer" size="small" /></label>
      <label><span>经纬网格</span><n-switch v-model:value="showGraticule" size="small" /></label>
      <label><span>属性提示</span><n-switch v-model:value="showTooltip" size="small" /></label>
      <label><span>瓦片调试</span><n-switch v-model:value="showTileDebug" size="small" /></label>
    </section>

    <section class="system-config">
      <div class="system-tab-list" role="tablist" aria-label="天气系统设置">
        <button
          v-for="option in systemTabs"
          :key="option.value"
          type="button"
          :class="{ active: activeSystemTab === option.value }"
          @click="activeSystemTab = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div v-if="activeSystemTab === 'trough'" class="tab-panel">
        <div class="option-row">
          <span>显示槽线</span>
          <n-switch v-model:value="showTrough" size="small" />
        </div>
        <div class="option-row">
          <span>显示原始点</span>
          <n-switch v-model:value="showRawPoints" size="small" />
        </div>
        <div class="option-list">
          <label>
            <span>最小长度</span>
            <n-input-number v-model:value="troughMinLength" size="small" :min="0" :step="0.5" :precision="2" />
          </label>
          <label>
            <span>最小平均风速</span>
            <n-input-number v-model:value="troughMinWindSpeed" size="small" :min="0" :step="1" :precision="1" />
          </label>
          <label>
            <span>线宽</span>
            <n-input-number v-model:value="troughLineWidth" size="small" :min="0.6" :max="6" :step="0.2" :precision="1" />
          </label>
        </div>
        <div class="filter-grid">
          <label v-for="option in troughShearOptions" :key="option.value">
            <span class="shear-swatch" :style="{ background: SHEAR_COLORS[option.value] }"></span>
            <span>{{ option.label }}</span>
            <n-switch v-model:value="troughShearFilters[option.value]" size="small" />
          </label>
        </div>
      </div>

      <div v-else-if="activeSystemTab === 'coldFront'" class="tab-panel">
        <div class="option-row">
          <span>显示冷锋</span>
          <n-switch v-model:value="showColdFronts" size="small" />
        </div>
        <p class="panel-note">在 850、925、950、1000 hPa 加载温度锋区识别结果，并以蓝线与三角符号绘制。</p>
      </div>

      <div v-else-if="activeSystemTab === 'vortex'" class="tab-panel">
        <div class="option-row">
          <span>涡旋中心 L</span>
          <n-switch v-model:value="showVortexCenters" size="small" />
        </div>
        <div class="option-row">
          <span>涡旋轨迹</span>
          <n-switch v-model:value="showVortexTracks" size="small" :disabled="!isVortexTrackLevel" />
        </div>
        <div class="option-row">
          <span>仅暖心中心</span>
          <n-switch v-model:value="showWarmOnlyCenters" size="small" />
        </div>
        <div class="option-row">
          <span>仅暖心轨迹</span>
          <n-switch v-model:value="showWarmOnlyTracks" size="small" :disabled="!isVortexTrackLevel" />
        </div>
        <div class="option-row">
          <span>历史轨迹</span>
          <n-switch v-model:value="showHistoricalVortexTracks" size="small" :disabled="!isVortexTrackLevel" />
        </div>
        <div class="option-row">
          <span>仅当前活跃轨迹</span>
          <n-switch v-model:value="showOnlyActiveVortexTracks" size="small" :disabled="!isVortexTrackLevel" />
        </div>
        <div class="option-list">
          <label>
            <span>中心最小风速</span>
            <n-input-number v-model:value="vortexMinWindSpeed" size="small" :min="0" :step="1" :precision="1" />
          </label>
          <label>
            <span>中心最小涡度</span>
            <n-input-number v-model:value="vortexMinVorticity" size="small" :min="0" :step="0.00001" :precision="7" />
          </label>
          <label>
            <span>轨迹最小最大风</span>
            <n-input-number v-model:value="vortexTrackMinWindSpeed" size="small" :min="0" :step="1" :precision="1" :disabled="!isVortexTrackLevel" />
          </label>
        </div>
      </div>

      <div v-else class="tab-panel">
        <div class="option-row">
          <span>显示急流轴</span>
          <n-switch v-model:value="showJetAxes" size="small" />
        </div>
        <div class="option-row">
          <span>箭头</span>
          <n-switch v-model:value="showJetArrowHeads" size="small" />
        </div>
        <div class="option-list">
          <label>
            <span>最小轴线长度</span>
            <n-input-number v-model:value="jetMinAxisLength" size="small" :min="0" :step="0.5" :precision="2" />
          </label>
          <label>
            <span>最小平均风速</span>
            <n-input-number v-model:value="jetMinAvgWindSpeed" size="small" :min="0" :step="1" :precision="1" />
          </label>
          <label>
            <span>最小最大风速</span>
            <n-input-number v-model:value="jetMinMaxWindSpeed" size="small" :min="0" :step="1" :precision="1" />
          </label>
          <label>
            <span>线宽</span>
            <n-input-number v-model:value="jetLineWidth" size="small" :min="0.8" :max="8" :step="0.2" :precision="1" />
          </label>
        </div>
      </div>
    </section>

    <section class="status-panel">
      <div><span>地图</span><n-tag size="small" :bordered="false">{{ loadingState.map }}</n-tag></div>
      <div><span>Manifest</span><n-tag size="small" :bordered="false">{{ loadingState.manifest }}</n-tag></div>
      <div><span>SVG</span><n-tag size="small" :bordered="false">{{ loadingState.svg }}</n-tag></div>
      <div><span>槽线</span><n-tag size="small" :bordered="false">{{ loadingState.trough }}</n-tag></div>
      <div><span>急流轴</span><n-tag size="small" :bordered="false">{{ loadingState.jet }}</n-tag></div>
      <div><span>冷锋</span><n-tag size="small" :bordered="false">{{ loadingState.coldFront }}</n-tag></div>
      <div><span>涡旋中心</span><n-tag size="small" :bordered="false">{{ loadingState.vortexCenters }}</n-tag></div>
      <div><span>涡旋轨迹</span><n-tag size="small" :bordered="false">{{ isVortexTrackLevel ? loadingState.vortexTracks : '该层不显示轨迹' }}</n-tag></div>
      <div><span>图层状态</span><n-tag size="small" :bordered="false">{{ layerStatus }}</n-tag></div>
      <div><span>槽线数量</span><strong>{{ visibleTroughCount }}</strong></div>
      <div><span>急流轴数量</span><strong>{{ visibleJetAxisCount }}</strong></div>
      <div><span>冷锋数量</span><strong>{{ visibleColdFrontCount }}</strong></div>
      <div><span>中心数量</span><strong>{{ visibleVortexCenterCount }}</strong></div>
      <div><span>轨迹数量</span><strong>{{ visibleVortexTrackCount }}</strong></div>
    </section>

    <section class="status-panel sw-prefetch-panel">
      <div><span>SW 预加载</span><n-tag size="small" :bordered="false">{{ swSupported ? '支持' : '不支持' }}</n-tag></div>
      <div><span>最新起报时次</span><strong>{{ swPrefetchStatus.initTime || '--' }}</strong></div>
      <div><span>当前状态</span><n-tag size="small" :bordered="false">{{ swStateLabel }}</n-tag></div>
      <div><span>IndexedDB</span><strong>{{ swPrefetchStatus.ready }} / {{ swPrefetchStatus.total }}</strong></div>
      <div><span>本轮下载</span><strong>{{ swPrefetchStatus.downloaded }}</strong></div>
      <div><span>失败</span><strong>{{ swPrefetchStatus.failed }}</strong></div>
    </section>

    <p v-if="errorMessage" class="empty-note">{{ errorMessage }}</p>
  </aside>
</template>
