// useWeatherView 的模块级常量与选项数组。
// 这些值不含响应式状态，供各子模块复用；从原 useWeatherView.js 原样抽出。
import { reactive } from 'vue'

export const DEFAULT_FC_HOURS = [
  '000', '003', '006', '009', '012', '015', '018', '021', '024',
  '027', '030', '033', '036', '039', '042', '045', '048', '051',
  '054', '057', '060', '063', '066', '069', '072', '078', '084',
  '090', '096', '102', '108', '114', '120', '126', '132', '138',
  '144', '150', '156', '162', '168', '174', '180', '186', '192',
  '198', '204', '210', '216', '222', '228', '234', '240'
]
export const DEFAULT_LEVELS = ['200', '500', '700', '850', '925', '950', '1000']
export const VORTEX_TRACK_LEVELS = new Set(['850', '925', '950', '1000', 'surface'])
export const COLD_FRONT_LEVELS = new Set(['850', '925', '950', '1000'])
export const DEFAULT_MAP_BOUNDS = { lon_min: 60, lon_max: 150, lat_min: 0, lat_max: 60 }
export const DEFAULT_MAP_CENTER = [105, 30]
export const DEFAULT_MAP_SCALE = 3

// 系统内置的地理视图默认配置：用户尚未保存任何视图（首次使用）时作为默认项展示。
// 一旦用户保存/删除过视图，则以用户 localStorage 中的列表为准，不再注入这些默认值。
export const DEFAULT_MAP_VIEWS = [
  { name: '中国', center: [105.87156370370164, 29.30487062388457], k: 2.999999999999999 },
  { name: '华南', center: [113.18672686219357, 21.25273087528488], k: 10.189154957362078 },
  { name: '广东', center: [113.75328674707802, 21.9864611572074], k: 20.49162514538987 },
  { name: '西太', center: [125.08646629276387, 18.218169869991247], k: 5.06640532454269 },
]
export const TROUGH_DEFAULT_COLOR = '#8B4513'
export const SHEAR_COLORS = reactive({
  shear_u_left: TROUGH_DEFAULT_COLOR,
  shear_u_right: TROUGH_DEFAULT_COLOR,
  shear_v_up: TROUGH_DEFAULT_COLOR,
  shear_v_down: TROUGH_DEFAULT_COLOR
})
export const LAYER_COMBINATION_STORAGE_KEY = 'weather-view-layer-combinations'
export const MULTI_ELEMENT_CONFIGURATION_STORAGE_KEY = 'weather-view-multi-element-configurations'
export const MULTI_ELEMENT_FORECAST_CONFIGURATION_STORAGE_KEY = 'weather-view-multi-element-forecast-configurations'
export const MAP_VIEW_STORAGE_KEY = 'weather-view-saved-map-views'
export const FILL_LAYER_TYPES = new Set(['wind_speed_fill', 'vort_fill', 'rhum_fill', 'surface_speed_fill'])
export const WIND_OVERLAY_LAYER_TYPES = new Set([
  'wind_quiver',
  'wind_barb',
  'wind_streamline',
  'surface_quiver',
  'surface_barb',
  'surface_streamline'
])

// 等值线图层是预渲染的 SVG 图像，绘制时整体乘以 zoomTransform.k，
// 因此放大系数越小、线条被压缩得越细。为保证不同放大系数下等值线的视觉线宽一致，
// 当 k 小于参考放大系数时，通过多方向偏移重绘（形态学膨胀）补偿线宽。
export const CONTOUR_REFERENCE_ZOOM = 6
// 在最小放大系数处额外补偿的“半线宽”（屏幕像素），随 k 接近参考值线性衰减到 0。
export const CONTOUR_MAX_DILATION_PX = 1.1
// 八方向单位偏移（对角线归一化到单位圆），配合膨胀半径生成更粗的线条。
export const CONTOUR_DILATION_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]
]

// SVG 图层按其固有像素尺寸栅格化后再随 zoomTransform.k 放大绘制，放大系数越大越模糊。
// 为在高放大系数下保持清晰，按放大系数动态提高栅格化“采样倍率”（超采样），
// 即用更大的宽高重新栅格化同一份矢量 SVG。倍率按区间取整以避免频繁重载。
// 采样倍率封顶 2 倍：3 倍会让位图像素数达 9 倍，高放大系数下重栅格化/绘制明显卡顿；
// 2 倍在清晰度与性能之间更平衡，并把提升阈值适当抬高，减少高倍率下的重载与内存占用。
export const RENDER_SCALE_MAX = 2

// 多图子画布以单图默认画布为分辨率基准。子图只需要生成与其实际显示面积相称的
// backing store / SVG 位图，避免把 960×640 单图的采样预算原样复制到每个小面板。
export const MULTI_MAP_REFERENCE_SIZE = { width: 960, height: 640 }
export const MULTI_MAP_RENDER_SCALES = [0.5, 0.75, 1, 1.5, RENDER_SCALE_MAX]

// —— 手绘图形（多常用天气图元）——
// 每个图形以经纬度存储，随地图平移缩放。kind：line/box/point；render 决定样式。
export const DRAW_TOOLS = [
  // 几何图形类
  { key: 'ellipse-blue', label: '蓝色椭圆', group: 'geom', kind: 'box', render: 'ellipse', color: '#2563eb' },
  { key: 'ellipse-red', label: '红色椭圆', group: 'geom', kind: 'box', render: 'ellipse', color: '#dc2626' },
  { key: 'rect-blue', label: '蓝色矩形', group: 'geom', kind: 'box', render: 'rect', color: '#2563eb' },
  { key: 'rect-red', label: '红色矩形', group: 'geom', kind: 'box', render: 'rect', color: '#dc2626' },
  // 线类型
  { key: 'trough', label: '槽线', group: 'line', kind: 'line', render: 'trough', color: '#8b5e3c' },
  { key: 'shear', label: '切变线', group: 'line', kind: 'line', render: 'shear', color: '#dc2626' },
  { key: 'convergence', label: '辐合线', group: 'line', kind: 'line', render: 'convergence', color: '#111827' },
  { key: 'arrow-red', label: '红色箭头线', group: 'line', kind: 'line', render: 'arrow', color: '#dc2626' },
  { key: 'arrow-blue', label: '蓝色箭头线', group: 'line', kind: 'line', render: 'arrow', color: '#2563eb' },
  { key: 'block-arrow-red', label: '红色粗箭头线', group: 'line', kind: 'line', render: 'block-arrow', color: '#dc2626' },
  { key: 'block-arrow-blue', label: '蓝色粗箭头线', group: 'line', kind: 'line', render: 'block-arrow', color: '#2563eb' },
  { key: 'cold-front', label: '冷锋', group: 'line', kind: 'line', render: 'cold', color: '#2563eb' },
  { key: 'warm-front', label: '暖锋', group: 'line', kind: 'line', render: 'warm', color: '#dc2626' },
  // 标注类
  { key: 'label-L', label: 'L（红）', group: 'label', kind: 'point', render: 'text', text: 'L', color: '#dc2626' },
  { key: 'label-D', label: 'D（红）', group: 'label', kind: 'point', render: 'text', text: 'D', color: '#dc2626' },
  { key: 'label-H', label: 'H（蓝）', group: 'label', kind: 'point', render: 'text', text: 'H', color: '#2563eb' },
  { key: 'label-G', label: 'G（蓝）', group: 'label', kind: 'point', render: 'text', text: 'G', color: '#2563eb' },
  { key: 'thunderstorm', label: '雷暴标记', group: 'label', kind: 'point', render: 'text', text: '☈', color: '#dc2626' },
  { key: 'typhoon', label: '台风标记', group: 'label', kind: 'point', render: 'text', text: '🌀', color: '#dc2626' },
  // 工具：删除
  { key: 'erase', label: '删除图形', group: 'tool', kind: 'erase', color: '#ef4444' }
]

export const DEFAULT_SHEAR_FILTERS = {
  shear_u_left: true,
  shear_u_right: true,
  shear_v_up: true,
  shear_v_down: true
}
export const LEVEL_SHEAR_DEFAULTS = {
  '1000': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '950': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '925': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '850': { shear_u_left: true, shear_u_right: true, shear_v_up: false, shear_v_down: false },
  '500': { shear_u_left: false, shear_u_right: false, shear_v_up: true, shear_v_down: true },
  '200': { shear_u_left: false, shear_u_right: false, shear_v_up: true, shear_v_down: true }
}

export const projectionOptions = [
  { label: '等经纬度', value: 'equirectangular' },
  { label: '墨卡托', value: 'mercator' },
  { label: '兰伯特', value: 'lambert' }
]

export const systemTabs = [
  { label: '槽线', value: 'trough' },
  { label: '冷锋', value: 'coldFront' },
  { label: '涡旋', value: 'vortex' },
  { label: '急流轴', value: 'jet' }
]

export const troughShearOptions = [
  { label: 'U 左切变', value: 'shear_u_left' },
  { label: 'U 右切变', value: 'shear_u_right' },
  { label: 'V 上切变', value: 'shear_v_up' },
  { label: 'V 下切变', value: 'shear_v_down' }
]

export const fallbackLayerOptions = [
  { label: '高度场等值线', value: 'hght_contour' },
  { label: '风矢量', value: 'wind_quiver' },
  { label: '风羽', value: 'wind_barb' },
  { label: '风速填色', value: 'wind_speed_fill' },
  { label: '流线', value: 'wind_streamline' },
  { label: '气温等值线', value: 'temp_contour' },
  { label: '相对涡度填色', value: 'vort_fill' },
  { label: '相对湿度填色', value: 'rhum_fill' },
  { label: '地面风矢量', value: 'surface_quiver' },
  { label: '地面风羽', value: 'surface_barb' },
  { label: '地面风速填色', value: 'surface_speed_fill' },
  { label: '地面流线', value: 'surface_streamline' },
  { label: '海平面气压等值线', value: 'mslp_contour' }
]

export const multiMapModeOptions = [
  { value: 'init', label: '多起报', description: '比较当前与前 3 个起报时次', group: 'single' },
  { value: 'forecast', label: '多时效', description: '比较相邻的 4 个预报时效', group: 'single' },
  { value: 'element', label: '多要素', description: '比较当前层次的 4 个要素组合', group: 'single' },
  { value: 'element_forecast', label: '多要素，多时效', description: '按行比较要素、按列比较预报时效', group: 'dual' },
  { value: 'init_forecast', label: '多起报，多时效', description: '按行比较起报、按列比较预报时效', group: 'dual' },
  { value: 'element_init', label: '多要素，多起报', description: '按行比较要素、按列比较起报时次', group: 'dual' }
]

export const multiForecastIntervalOptions = [
  { value: '24', label: '24h' },
  { value: '6', label: '6h' },
  { value: '48', label: '48h' },
  { value: 'continuous', label: '连续' }
]
export const multiForecastPanelCountOptions = [4, 6, 8, 9]
export const multiInitIntervalOptions = [
  { value: '12', label: '12小时' },
  { value: '24', label: '24小时' }
]
export const multiInitPanelCountOptions = [4, 6, 8, 9]
export const multiElementPanelCountOptions = [4, 6, 8, 9]

export const sliderOpts = {
  width: 'auto',
  lazy: true,
  dragOnClick: true,
  process: false,
  tooltipStyle: { minWidth: '90px', backgroundColor: '#1f7a8c', borderColor: '#1f7a8c' },
  tooltip: 'always'
}
