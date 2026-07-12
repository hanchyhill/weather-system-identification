// 用户可配置项均保存在 localStorage；这里集中维护可导入、导出的键，
// 避免把缓存、Service Worker 状态或浏览器推送订阅等非配置数据带入备份。
export const CONFIGURATION_STORAGE_KEYS = [
  'weather-view-element-config',
  'weather-view-layer-combinations',
  'weather-view-multi-element-configurations',
  'weather-view-multi-element-forecast-configurations',
  'weather-view-saved-map-views',
  'weather-prefetch-options'
]

const BACKUP_FORMAT = 'weather-system-identification-config-backup'
const BACKUP_VERSION = 1

export function exportSavedConfigurations() {
  const configurations = {}
  CONFIGURATION_STORAGE_KEYS.forEach((key) => {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return
    try {
      configurations[key] = JSON.parse(raw)
    } catch {
      // 已损坏的配置不能可靠恢复，导出时跳过而不阻断其他配置。
    }
  })

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    configurations
  }
}

export function importSavedConfigurations(backup) {
  if (!backup || backup.format !== BACKUP_FORMAT || !backup.configurations || typeof backup.configurations !== 'object') {
    throw new Error('不是有效的天气系统识别配置备份文件')
  }

  let imported = 0
  CONFIGURATION_STORAGE_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(backup.configurations, key)) return
    window.localStorage.setItem(key, JSON.stringify(backup.configurations[key]))
    imported += 1
  })
  return imported
}
