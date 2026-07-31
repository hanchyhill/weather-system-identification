// 与 src/draw/svg_layer_rendering.py 中的填色色阶保持一致。
// 这里仅描述前端色标展示；实际图像仍由 Python 端预渲染的 SVG 提供。

const WIND_COLORS = [
  '#ffffff', '#ededed', '#dbdbdb', '#cbcbcb', '#b9b9b9', '#5f9fd3', '#7fb3d9',
  '#9fc7e0', '#bfdbe7', '#c7e5d3', '#cff0bf', '#d7fbab', '#f7eb8b', '#f7d884',
  '#f9c67e', '#fab478', '#fba171', '#fb8e6a', '#fd7c64', '#fe695d', '#ff5757',
  '#ebabd7', '#efbadf', '#f3c9e8', '#f7d7f2', '#fbe7fb', '#f3c9d3', '#ebacab',
  '#e38e83'
]

const WIND_HIGH_COLORS = [
  '#6fd069', '#ade780', '#fbfbaa', '#f6bc6d', '#f66d4d', '#d65144',
  '#7b342d', '#b449f7', '#cb73ef', '#e7a4fd', '#fcdcfe'
]

const RHUM_COLORS = [
  '#8a5014', '#9c611f', '#ac7029', '#be8135', '#c8954c', '#d3ac67', '#ddc17f',
  '#e6cf97', '#eedbac', '#f6e8c5', '#f6ecd4', '#f5f2e5', '#f4f5f5', '#e6f5d1',
  '#c7e8a2', '#a5d575', '#80bc49', '#5fa034', '#418326', '#1a3512'
]

// 与 Python 端 COLOR_ARR_VORT 逐档对应（低值 2 档蓝 + 高值 6 档黄橙红），
// 共 8 档。改动任一端都要同步另一端，否则图例与填色对不上。
const VORT_COLORS = [
  '#abd9e9', '#4575b4',
  '#ffff2a', '#ffbe00', '#ff6b00', '#ff1600', '#a80000', '#530200'
]

const RAIN_24_COLORS = ['#a5f18f', '#3cb83e', '#23baff', '#0004fd', '#ff00f2', '#91003d', '#f0d013', '#fe5e00', '#8915da']
const RAIN_SHORT_COLORS = ['#a5f18f', '#3cb93c', '#00ffff', '#0000ff', '#ff0000', '#320032', '#fb00fb']

function legend(type, title, unit, colors, ticks) {
  return { type, title, unit, colors, ticks }
}

function windLegend(type, level) {
  if (level !== 'surface' && Number(level) <= 500) {
    return legend(type, '风速', 'm/s', WIND_HIGH_COLORS, [
      { label: '12', offset: 0 }, { label: '20.7', offset: 27 }, { label: '32.6', offset: 55 },
      { label: '41.0', offset: 73 }, { label: '50.9', offset: 91 }, { label: '61.2+', offset: 100 }
    ])
  }
  return legend(type, '风速', 'm/s', WIND_COLORS, [
    { label: '0', offset: 0 }, { label: '6', offset: 10 }, { label: '9', offset: 14 },
    { label: '12', offset: 36 }, { label: '15', offset: 57 }, { label: '18', offset: 79 },
    { label: '22+', offset: 100 }
  ])
}

/** 返回当前图层组合需要展示的全部色标。 */
export function colorLegendsForLayers(layerTypes, level) {
  const layers = Array.isArray(layerTypes) ? layerTypes.map(String) : []
  return layers.flatMap((type) => {
    if (type === 'wind_speed_fill' || type === 'surface_speed_fill') return [windLegend(type, String(level))]
    if (type === 'vort_fill') {
      // 8 档等宽渲染，故刻度按档序号 /8 定位：0.15 是第 2 档边界 -> 25%。
      return [legend(type, '相对涡度', '10⁻⁵ s⁻¹', VORT_COLORS, [
        { label: '0.05', offset: 0 }, { label: '0.15', offset: 25 }, { label: '0.45', offset: 50 },
        { label: '0.75', offset: 75 }, { label: '1.0+', offset: 100 }
      ])]
    }
    if (type === 'rhum_fill') {
      return [legend(type, '相对湿度', '%', RHUM_COLORS, [
        { label: '0', offset: 0 }, { label: '20', offset: 20 }, { label: '40', offset: 40 },
        { label: '60', offset: 60 }, { label: '80', offset: 80 }, { label: '100', offset: 100 }
      ])]
    }
    if (type === 'rain_24h_fill') {
      return [legend(type, '24小时累计降水', 'mm', RAIN_24_COLORS, [
        { label: '0.1', offset: 0 }, { label: '10', offset: 13 }, { label: '25', offset: 25 },
        { label: '50', offset: 38 }, { label: '100', offset: 50 }, { label: '250', offset: 63 },
        { label: '400', offset: 75 }, { label: '600', offset: 88 }, { label: '900+', offset: 100 }
      ])]
    }
    if (type === 'rain_6h_fill' || type === 'rain_3h_fill') {
      const hours = type === 'rain_6h_fill' ? '6' : '3'
      return [legend(type, `${hours}小时累计降水`, 'mm', RAIN_SHORT_COLORS, [
        { label: '1', offset: 0 }, { label: '10', offset: 17 }, { label: '20', offset: 33 },
        { label: '30', offset: 50 }, { label: '50', offset: 67 }, { label: '80', offset: 83 },
        { label: '100+', offset: 100 }
      ])]
    }
    // Python 端仅在 500 hPa 高度场中绘制这两档半透明填色。
    if (type === 'hght_contour' && String(level) === '500') {
      return [legend(type, '位势高度', 'dagpm', ['#ffff0080', '#ffa50080'], [
        { label: '586', offset: 0 }, { label: '588+', offset: 100 }
      ])]
    }
    return []
  })
}
