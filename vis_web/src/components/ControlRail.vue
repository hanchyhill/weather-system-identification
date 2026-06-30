<script setup>
import { RefreshCw } from 'lucide-vue-next'
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NTag,
  NTooltip
} from 'naive-ui'

import { useWeatherViewContext } from '../context/weatherViewContext'

const {
  activeSystemTab,
  errorMessage,
  fcHour,
  fcHourOptions,
  initTime,
  jetLineWidth,
  jetMinAvgWindSpeed,
  jetMinAxisLength,
  jetMinMaxWindSpeed,
  layerOptions,
  layerStatus,
  layerType,
  level,
  levelOptions,
  loadManifest,
  loadingState,
  projectionName,
  projectionOptions,
  SHEAR_COLORS,
  showFutureVortexTracks,
  showJetArrowHeads,
  showJetAxes,
  showRawPoints,
  showSvgLayer,
  showTooltip,
  showTrough,
  showVortexCenters,
  showVortexTracks,
  showWarmOnlyCenters,
  showWarmOnlyTracks,
  systemTabs,
  troughLineWidth,
  troughMinLength,
  troughMinWindSpeed,
  troughShearFilters,
  troughShearOptions,
  visibleJetAxisCount,
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
      <h1>天气系统识别</h1>
      <p>SVG 图层与天气系统交互查看</p>
    </div>

    <section class="control-section">
      <label>起报时次</label>
      <div class="inline-control">
        <n-input v-model:value="initTime" size="small" />
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button size="small" secondary circle @click="loadManifest">
              <RefreshCw :size="16" />
            </n-button>
          </template>
          重新加载 manifest 与槽线
        </n-tooltip>
      </div>
    </section>

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
      <label>图层类型</label>
      <n-select v-model:value="layerType" size="small" :options="layerOptions" />
    </section>

    <section class="control-section">
      <label>投影</label>
      <div class="segmented">
        <button
          v-for="option in projectionOptions"
          :key="option.value"
          :class="{ active: projectionName === option.value }"
          @click="projectionName = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section class="switch-list">
      <label><span>SVG 图层</span><n-switch v-model:value="showSvgLayer" size="small" /></label>
      <label><span>属性提示</span><n-switch v-model:value="showTooltip" size="small" /></label>
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

      <div v-else-if="activeSystemTab === 'vortex'" class="tab-panel">
        <div class="option-row">
          <span>涡旋中心 L</span>
          <n-switch v-model:value="showVortexCenters" size="small" />
        </div>
        <div class="option-row">
          <span>850hPa 轨迹</span>
          <n-switch v-model:value="showVortexTracks" size="small" :disabled="level !== '850'" />
        </div>
        <div class="option-row">
          <span>仅暖心中心</span>
          <n-switch v-model:value="showWarmOnlyCenters" size="small" />
        </div>
        <div class="option-row">
          <span>仅暖心轨迹</span>
          <n-switch v-model:value="showWarmOnlyTracks" size="small" :disabled="level !== '850'" />
        </div>
        <div class="option-row">
          <span>未来轨迹</span>
          <n-switch v-model:value="showFutureVortexTracks" size="small" :disabled="level !== '850'" />
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
            <n-input-number v-model:value="vortexTrackMinWindSpeed" size="small" :min="0" :step="1" :precision="1" :disabled="level !== '850'" />
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
      <div><span>涡旋中心</span><n-tag size="small" :bordered="false">{{ loadingState.vortexCenters }}</n-tag></div>
      <div><span>涡旋轨迹</span><n-tag size="small" :bordered="false">{{ level === '850' ? loadingState.vortexTracks : '仅850hPa显示' }}</n-tag></div>
      <div><span>图层状态</span><n-tag size="small" :bordered="false">{{ layerStatus }}</n-tag></div>
      <div><span>槽线数量</span><strong>{{ visibleTroughCount }}</strong></div>
      <div><span>急流轴数量</span><strong>{{ visibleJetAxisCount }}</strong></div>
      <div><span>中心数量</span><strong>{{ visibleVortexCenterCount }}</strong></div>
      <div><span>轨迹数量</span><strong>{{ visibleVortexTrackCount }}</strong></div>
    </section>

    <p v-if="errorMessage" class="empty-note">{{ errorMessage }}</p>
  </aside>
</template>
