<script setup>
import { Globe2, Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import { NButton, NInput, NModal, NPopover, NTooltip } from 'naive-ui'
import { ref } from 'vue'

import { useWeatherViewContext } from '../context/weatherViewContext'

const props = defineProps({
  applyView: {
    type: Function,
    default: null
  },
  saveView: {
    type: Function,
    default: null
  }
})

const {
  applyMapView,
  deleteMapView,
  restoreDefaultMapViews,
  saveMapView,
  savedMapViews
} = useWeatherViewContext()

const showSaveDialog = ref(false)
const viewNameDraft = ref('')

function openSaveDialog() {
  viewNameDraft.value = ''
  showSaveDialog.value = true
}

function confirmSave() {
  if (!(props.saveView || saveMapView)(viewNameDraft.value)) return
  showSaveDialog.value = false
}

function applySelectedView(view) {
  const apply = props.applyView || applyMapView
  apply(view)
}

function formatCoordinate(value) {
  return `${Number(value).toFixed(2)}°`
}
</script>

<template>
  <n-popover trigger="hover" placement="right-start" :show-arrow="false" style="width: 248px;">
    <template #trigger>
      <n-tooltip trigger="hover" placement="right">
        <template #trigger>
          <button type="button" class="map-view-fab" aria-label="地理视图">
            <Globe2 :size="20" />
          </button>
        </template>
        地理视图
      </n-tooltip>
    </template>

    <div class="map-view-popover">
      <div class="map-view-header">
        <strong>地理视图</strong>
        <span>选择已保存的地图范围</span>
      </div>

      <div v-if="savedMapViews.length" class="map-view-list">
        <div v-for="view in savedMapViews" :key="view.name" class="map-view-item">
          <button type="button" class="map-view-apply" @click="applySelectedView(view)">
            <strong>{{ view.name }}</strong>
            <span>中心 {{ formatCoordinate(view.center[0]) }}E，{{ formatCoordinate(view.center[1]) }}N · {{ view.k.toFixed(2) }}×</span>
          </button>
          <n-tooltip trigger="hover">
            <template #trigger>
              <button
                type="button"
                class="map-view-delete"
                :aria-label="`删除视图 ${view.name}`"
                @click.stop="deleteMapView(view.name)"
              >
                <Trash2 :size="14" />
              </button>
            </template>
            删除
          </n-tooltip>
        </div>
      </div>
      <p v-else class="map-view-empty">还没有保存的地理视图。</p>

      <button type="button" class="map-view-restore" @click="restoreDefaultMapViews">
        <RotateCcw :size="16" />
        恢复默认地理视图配置
      </button>
      <button type="button" class="map-view-save" @click="openSaveDialog">
        <Plus :size="16" />
        保存当前视图
      </button>
    </div>
  </n-popover>

  <n-modal
    v-model:show="showSaveDialog"
    preset="card"
    title="保存地理视图"
    style="width: 400px; max-width: 92vw;"
  >
    <n-input
      v-model:value="viewNameDraft"
      autofocus
      placeholder="视图名称，如 华东区域"
      @keyup.enter="confirmSave"
    />
    <template #footer>
      <div class="map-view-dialog-actions">
        <n-button size="small" @click="showSaveDialog = false">取消</n-button>
        <n-button size="small" type="primary" :disabled="!viewNameDraft.trim()" @click="confirmSave">保存</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.map-view-fab {
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

.map-view-fab:hover {
  color: #fff;
  background: #1f7a8c;
  border-color: #1f7a8c;
}

.map-view-popover,
.map-view-list {
  display: grid;
  gap: 6px;
}

.map-view-header {
  display: grid;
  gap: 2px;
  margin-bottom: 4px;
}

.map-view-header strong {
  color: #172033;
  font-size: 14px;
}

.map-view-header span,
.map-view-empty,
.map-view-apply span {
  color: #667487;
  font-size: 12px;
}

.map-view-empty {
  margin: 4px 0 8px;
}

.map-view-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.map-view-apply {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #fff;
  color: #384456;
  text-align: left;
  cursor: pointer;
}

.map-view-apply:hover {
  border-color: #1f7a8c;
  background: rgba(31, 122, 140, 0.08);
}

.map-view-apply strong,
.map-view-apply span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-view-apply strong {
  font-size: 13px;
}

.map-view-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #7a8698;
  cursor: pointer;
}

.map-view-delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.map-view-save,
.map-view-restore {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
  padding: 8px;
  border: 1px dashed #1f7a8c;
  border-radius: 8px;
  background: rgba(31, 122, 140, 0.05);
  color: #1f7a8c;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.map-view-save:hover {
  background: rgba(31, 122, 140, 0.12);
}

.map-view-restore {
  margin-top: 0;
  border-style: solid;
  border-color: #d7dee7;
  background: #fff;
  color: #526173;
}

.map-view-restore:hover {
  border-color: #1f7a8c;
  background: rgba(31, 122, 140, 0.08);
  color: #1f7a8c;
}

.map-view-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
