// 元素选择器（要素表格）配置。
// 结构完全对照 gdmo-lab / OceanTyphoon.vue 的「元素选择器」：
//   左侧「高空要素」网格：行 = 垂直层次，列 = 综合/位势/温度/风/湿度/水汽/位温/散度/涡度。
//   右侧「单层要素」面板：若干个彩色分组，每组内若干要素按钮。
// 每个要素（element）描述一次「层次 + 图层组合」的应用：
//   { label: 显示名, level: 层次值, layers: [图层类型...] }
// 本项目暂时没有的要素直接留空单元格；用户可通过配置界面自由增删。

// 与本项目真实存在的图层类型（fallbackLayerOptions）对应的可选项。
export const LAYER_TYPE_OPTIONS = [
  { label: '高度场等值线', value: 'hght_contour' },
  { label: '风矢量', value: 'wind_quiver' },
  { label: '风羽', value: 'wind_barb' },
  { label: '风速填色', value: 'wind_speed_fill' },
  { label: '流线', value: 'wind_streamline' },
  { label: '气温等值线', value: 'temp_contour' },
  { label: '相对涡度填色', value: 'vort_fill' },
  { label: '相对湿度填色', value: 'rhum_fill' },
  { label: '海平面气压等值线', value: 'mslp_contour' },
  { label: '地面风矢量', value: 'surface_quiver' },
  { label: '地面风羽', value: 'surface_barb' },
  { label: '地面风速填色', value: 'surface_speed_fill' },
  { label: '地面流线', value: 'surface_streamline' },
  { label: '24小时累计降水', value: 'rain_24h_fill' },
  { label: '6小时累计降水', value: 'rain_6h_fill' },
  { label: '3小时累计降水', value: 'rain_3h_fill' }
]

// 高空要素表的列定义（与 OceanTyphoon 表头一致，颜色沿用其 tailwind 底色）。
export const DEFAULT_UPPER_COLUMNS = [
  { key: 'overview', label: '综合要素', color: '' },
  { key: 'geopotential', label: '位势', color: '#fde047' },
  { key: 'temperature', label: '温度', color: '#fca5a5' },
  { key: 'wind', label: '风', color: '#93c5fd' },
  { key: 'humidity', label: '湿度', color: '#86efac' },
  { key: 'watervapor', label: '水汽', color: '#86efac' },
  { key: 'theta', label: '位温', color: '#fca5a5' },
  { key: 'divergence', label: '散度', color: '#93c5fd' },
  { key: 'vorticity', label: '涡度', color: '#93c5fd' }
]

// 左侧垂直层次（行）。'surface' 展示为「地面」。
export const DEFAULT_UPPER_LEVELS = [
  { value: '200', label: '200hPa' },
  { value: '500', label: '500hPa' },
  { value: '700', label: '700hPa' },
  { value: '850', label: '850hPa' },
  { value: '925', label: '925hPa' },
  { value: '950', label: '950hPa' },
  { value: '1000', label: '1000hPa' },
  { value: 'surface', label: '地面' }
]

// 单元格 key：`${levelValue}|${columnKey}`。
export function cellKey(levelValue, columnKey) {
  return `${levelValue}|${columnKey}`
}

// 生成默认单元格：仅在本项目有真实数据的位置放置可点击要素，其余留空。
function buildDefaultCells() {
  const cells = {}
  const put = (level, column, elements) => {
    cells[cellKey(level, column)] = elements
  }
  const upperLevels = ['200', '500', '700', '850', '925', '950', '1000']

  upperLevels.forEach((lvl) => {
    // 综合要素：高度场 + 风羽。
    put(lvl, 'overview', [{ label: `${lvl}形势`, level: lvl, layers: ['hght_contour', 'wind_barb'] }])
    // 位势：高度场。
    put(lvl, 'geopotential', [{ label: `${lvl}高度场`, level: lvl, layers: ['hght_contour'] }])
    // 温度：气温等值线。
    put(lvl, 'temperature', [{ label: `${lvl}温度`, level: lvl, layers: ['temp_contour'] }])
    // 风：风羽 / 风速填色 / 流线。
    put(lvl, 'wind', [
      { label: `${lvl}风羽`, level: lvl, layers: ['wind_barb'] },
      { label: `${lvl}风速填色`, level: lvl, layers: ['wind_speed_fill'] },
      { label: `${lvl}流线`, level: lvl, layers: ['wind_streamline'] }
    ])
    // 湿度：相对湿度填色。
    put(lvl, 'humidity', [{ label: `${lvl}相对湿度`, level: lvl, layers: ['rhum_fill'] }])
    // 涡度：相对涡度填色。
    put(lvl, 'vorticity', [{ label: `${lvl}涡度`, level: lvl, layers: ['vort_fill'] }])
    // 水汽 / 位温 / 散度：本项目暂无数据，留空。
  })

  // 地面行：把地面风放到「风」列。
  put('surface', 'wind', [
    { label: '地面风矢量', level: 'surface', layers: ['surface_quiver'] },
    { label: '地面风羽', level: 'surface', layers: ['surface_barb'] },
    { label: '地面风速填色', level: 'surface', layers: ['surface_speed_fill'] },
    { label: '地面流线', level: 'surface', layers: ['surface_streamline'] }
  ])

  return cells
}

// 右侧单层要素分组。保留 OceanTyphoon 的分组结构，仅在有数据处放置按钮。
export const DEFAULT_SINGLE_LAYER_GROUPS = [
  {
    key: 'pressure',
    title: '气压',
    color: '#fde047',
    elements: [
      { label: '海平面气压', level: 'surface', layers: ['mslp_contour'] }
    ]
  },
  {
    key: 'wind',
    title: '风',
    color: '#bfdbfe',
    elements: [
      { label: '10m风矢量', level: 'surface', layers: ['surface_quiver'] },
      { label: '10m风羽', level: 'surface', layers: ['surface_barb'] },
      { label: '10m风速填色', level: 'surface', layers: ['surface_speed_fill'] }
    ]
  },
  {
    key: 'precip',
    title: '降水',
    color: '#86efac',
    elements: [
      { label: '24小时累计降水', level: 'surface', layers: ['rain_24h_fill'] },
      { label: '6小时累计降水', level: 'surface', layers: ['rain_6h_fill'] },
      { label: '3小时累计降水', level: 'surface', layers: ['rain_3h_fill'] }
    ]
  },
  { key: 'severe', title: '强天气', color: '#86efac', elements: [] },
  { key: 'temperature', title: '温度', color: '#fca5a5', elements: [] },
  { key: 'humidity', title: '湿度', color: '#a7f3d0', elements: [] },
  { key: 'other', title: '其他', color: '#f9a8d4', elements: [] }
]

export function defaultElementConfig() {
  return {
    columns: DEFAULT_UPPER_COLUMNS.map((col) => ({ ...col })),
    levels: DEFAULT_UPPER_LEVELS.map((lvl) => ({ ...lvl })),
    cells: buildDefaultCells(),
    singleLayerGroups: DEFAULT_SINGLE_LAYER_GROUPS.map((group) => ({
      ...group,
      elements: group.elements.map((el) => ({ ...el, layers: [...el.layers] }))
    }))
  }
}

const STORAGE_KEY = 'weather-view-element-config'

function sanitizeElement(raw) {
  if (!raw || typeof raw !== 'object') return null
  const label = String(raw.label || '').trim()
  const level = String(raw.level || '').trim()
  const layers = Array.isArray(raw.layers) ? raw.layers.map(String).filter(Boolean) : []
  if (!label || !level) return null
  return { label, level, layers }
}

// 读取并规范化配置；任何缺失字段回退到默认，保证结构稳定。
export function normalizeElementConfig(raw) {
  const base = defaultElementConfig()
  if (!raw || typeof raw !== 'object') return base

  const columns = Array.isArray(raw.columns) && raw.columns.length
    ? raw.columns
      .filter((col) => col && col.key)
      .map((col) => ({ key: String(col.key), label: String(col.label || col.key), color: String(col.color || '') }))
    : base.columns

  const levels = Array.isArray(raw.levels) && raw.levels.length
    ? raw.levels
      .filter((lvl) => lvl && lvl.value)
      .map((lvl) => ({ value: String(lvl.value), label: String(lvl.label || lvl.value) }))
    : base.levels

  const cells = {}
  if (raw.cells && typeof raw.cells === 'object') {
    Object.keys(raw.cells).forEach((key) => {
      const list = Array.isArray(raw.cells[key]) ? raw.cells[key].map(sanitizeElement).filter(Boolean) : []
      if (list.length) cells[key] = list
    })
  }

  const singleLayerGroups = Array.isArray(raw.singleLayerGroups) && raw.singleLayerGroups.length
    ? raw.singleLayerGroups
      .filter((group) => group && group.key)
      .map((group) => ({
        key: String(group.key),
        title: String(group.title || group.key),
        color: String(group.color || '#e2e8f0'),
        elements: Array.isArray(group.elements) ? group.elements.map(sanitizeElement).filter(Boolean) : []
      }))
    : base.singleLayerGroups

  return { columns, levels, cells, singleLayerGroups }
}

export function loadElementConfig() {
  if (typeof window === 'undefined') return defaultElementConfig()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultElementConfig()
    return normalizeElementConfig(JSON.parse(raw))
  } catch {
    return defaultElementConfig()
  }
}

export function persistElementConfig(config) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 忽略持久化失败（如隐私模式），不影响运行。
  }
}
