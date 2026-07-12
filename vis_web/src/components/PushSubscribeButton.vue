<script setup>
// 全局设置入口：实时更新订阅/预取策略与本地配置备份。
import { Download, Settings, Upload } from 'lucide-vue-next'
import { NButton, NCard, NCheckbox, NCheckboxGroup, NModal, NSwitch, NTabPane, NTabs, NTooltip } from 'naive-ui'
import { onMounted, ref } from 'vue'

import { exportSavedConfigurations, importSavedConfigurations } from '../utils/configBackup'
import { LAYER_TYPE_OPTIONS, DEFAULT_UPPER_LEVELS as LEVEL_OPTIONS } from '../utils/elementSelectorConfig'
import { recentInitTimes } from '../utils/initTime'
import {
  getNotificationPermission,
  getSubscriptionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush
} from '../utils/pushClient'
import { DEFAULT_PREFETCH_OPTIONS, loadPrefetchOptions, savePrefetchOptions } from '../utils/prefetchOptions'
import { prefetchInitTimes, setPrefetchOptions } from '../utils/swClient'

const Z_LEVEL_OPTIONS = [
  { value: 0, label: 'z0 · 概览' },
  { value: 1, label: 'z1 · 中等' },
  { value: 2, label: 'z2 · 精细' }
]

const showDialog = ref(false)
const supported = ref(false)
const subscribed = ref(false)
const permission = ref('default')
const busy = ref(false)
const message = ref('')
const activeTab = ref('updates')
const fileInput = ref(null)
const backupMessage = ref('')
const importedBackup = ref(false)

// 预取策略（本地副本，弹窗内编辑，「保存并应用」时落盘 + 下发）
const zLevels = ref([...DEFAULT_PREFETCH_OPTIONS.zLevels])
const layerTypes = ref([])
const levels = ref([])

function loadLocal() {
  const options = loadPrefetchOptions()
  zLevels.value = options.zLevels
  layerTypes.value = options.layerTypes
  levels.value = options.levels
}

async function refreshState() {
  supported.value = isPushSupported()
  permission.value = getNotificationPermission()
  subscribed.value = supported.value ? await getSubscriptionState() : false
}

onMounted(async () => {
  loadLocal()
  await refreshState()
})

async function openDialog() {
  loadLocal()
  await refreshState()
  showDialog.value = true
}

async function onToggleSubscription(value) {
  if (busy.value || !supported.value) return
  busy.value = true
  message.value = ''
  try {
    if (value) {
      await subscribeToPush()
      subscribed.value = true
      message.value = '已开启：新起报数据就绪时会通知并预加载'
    } else {
      await unsubscribeFromPush()
      subscribed.value = false
      message.value = '已关闭订阅'
    }
  } catch (error) {
    message.value = error && error.message ? error.message : '操作失败'
    permission.value = getNotificationPermission()
    // 失败时回退开关到真实状态
    subscribed.value = await getSubscriptionState()
  } finally {
    busy.value = false
  }
}

function applySettings() {
  const options = {
    zLevels: zLevels.value.length ? zLevels.value : [...DEFAULT_PREFETCH_OPTIONS.zLevels],
    layerTypes: layerTypes.value,
    levels: levels.value
  }
  savePrefetchOptions(options)
  setPrefetchOptions(options) // 下发给 SW 持久化（供 push 唤醒时用）
  prefetchInitTimes(recentInitTimes(2), options) // 立即按新策略预取
  message.value = '预取策略已保存并开始加载'
}

function exportConfigurations() {
  const backup = exportSavedConfigurations()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `weather-system-config-${date}.json`
  link.click()
  URL.revokeObjectURL(url)
  backupMessage.value = `已导出 ${Object.keys(backup.configurations).length} 项配置`
}

function openImportPicker() {
  fileInput.value?.click()
}

async function importConfigurations(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  importedBackup.value = false
  try {
    const imported = importSavedConfigurations(JSON.parse(await file.text()))
    backupMessage.value = `已导入 ${imported} 项配置，刷新页面后生效`
    importedBackup.value = true
  } catch (error) {
    backupMessage.value = error instanceof Error ? error.message : '导入配置失败'
  }
}

function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div class="push-subscribe">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="small"
          tertiary
          circle
          @click="openDialog"
        >
          <Settings :size="16" />
        </n-button>
      </template>
      全局设置
    </n-tooltip>

    <n-modal v-model:show="showDialog">
      <n-card class="push-dialog" title="全局设置" :bordered="false" size="small" role="dialog">
        <n-tabs v-model:value="activeTab" type="line" animated>
          <n-tab-pane name="updates" tab="实时更新">
            <template v-if="!supported">
              <p class="push-note">当前环境不支持实时推送（需通过 https 或 localhost 访问）。</p>
            </template>
            <template v-else>
              <div class="push-row">
                <div>
                  <div class="push-row__title">订阅新起报通知</div>
                  <div class="push-row__desc">数据就绪时通知你，并在后台预加载最新起报</div>
                </div>
                <n-switch
                  :value="subscribed"
                  :disabled="busy || permission === 'denied'"
                  @update:value="onToggleSubscription"
                />
              </div>
              <p v-if="permission === 'denied'" class="push-note push-note--warn">
                通知权限已被拒绝，请在浏览器站点设置里手动允许后重试。
              </p>

              <div class="push-divider"></div>

              <div class="push-section">
                <div class="push-section__title">预加载瓦片层次</div>
                <div class="push-section__desc">层次越高越清晰、数量越多。默认 z0 + z1。</div>
                <n-checkbox-group v-model:value="zLevels">
                  <n-checkbox v-for="opt in Z_LEVEL_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label" />
                </n-checkbox-group>
              </div>

              <div class="push-section">
                <div class="push-section__title">预加载要素</div>
                <div class="push-section__desc">不勾选表示全部要素。</div>
                <n-checkbox-group v-model:value="layerTypes" class="push-grid">
                  <n-checkbox v-for="opt in LAYER_TYPE_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label" />
                </n-checkbox-group>
              </div>

              <div class="push-section">
                <div class="push-section__title">预加载气压层</div>
                <div class="push-section__desc">不勾选表示全部层次。</div>
                <n-checkbox-group v-model:value="levels" class="push-grid">
                  <n-checkbox v-for="opt in LEVEL_OPTIONS" :key="opt.value" :value="opt.value" :label="opt.label" />
                </n-checkbox-group>
              </div>
            </template>
          </n-tab-pane>

          <n-tab-pane name="backup" tab="配置备份">
            <div class="backup-section">
              <div class="backup-section__title">导出配置</div>
              <p>导出本浏览器中已保存的要素选择器、图层组合、多图配置、地理视图和预取策略。</p>
              <n-button size="small" type="primary" @click="exportConfigurations">
                <template #icon><Download :size="15" /></template>
                导出配置
              </n-button>
            </div>

            <div class="backup-section">
              <div class="backup-section__title">导入配置</div>
              <p>选择此前导出的 JSON 文件。导入会覆盖备份中包含的同类配置。</p>
              <input ref="fileInput" class="backup-file-input" type="file" accept="application/json,.json" @change="importConfigurations" />
              <n-button size="small" @click="openImportPicker">
                <template #icon><Upload :size="15" /></template>
                导入配置
              </n-button>
            </div>

            <p v-if="backupMessage" class="backup-message">{{ backupMessage }}</p>
            <n-button v-if="importedBackup" size="small" type="primary" @click="reloadPage">立即刷新并应用</n-button>
          </n-tab-pane>
        </n-tabs>

        <template #footer>
          <div class="push-footer">
            <span class="push-footer__msg">{{ activeTab === 'updates' ? message : '' }}</span>
            <div class="push-footer__actions">
              <n-button size="small" @click="showDialog = false">关闭</n-button>
              <n-button v-if="activeTab === 'updates' && supported" size="small" type="primary" @click="applySettings">保存并应用</n-button>
            </div>
          </div>
        </template>
      </n-card>
    </n-modal>
  </div>
</template>

<style scoped>
.push-subscribe {
  display: inline-flex;
}

.push-dialog {
  width: 460px;
  max-width: 92vw;
  max-height: 82vh;
  overflow: auto;
}

.push-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.push-row__title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.push-row__desc,
.push-section__desc {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}

.push-divider {
  height: 1px;
  margin: 14px 0;
  background: #e5e7eb;
}

.push-section {
  margin-bottom: 14px;
}

.push-section__title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 6px;
}

.push-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin-top: 6px;
}

.push-note {
  font-size: 13px;
  color: #6b7280;
}

.push-note--warn {
  margin-top: 8px;
  color: #b45309;
}

.push-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.push-footer__msg {
  font-size: 12px;
  color: #2563eb;
}

.push-footer__actions {
  display: flex;
  gap: 8px;
}

.backup-section {
  display: grid;
  gap: 8px;
  padding: 12px 0;
}

.backup-section + .backup-section {
  border-top: 1px solid #e5e7eb;
}

.backup-section__title {
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}

.backup-section p,
.backup-message {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.backup-file-input {
  display: none;
}

.backup-message {
  color: #2563eb;
}
</style>
