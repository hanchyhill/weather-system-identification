import { feature } from 'topojson-client'

const MAP_DATA_URLS = {
  world: '/map-data/110m.json',
  china: '/map-data/bou2_4l.topo.simplify.json'
}

let baseFeaturesPromise = null

/**
 * 按需读取底图数据，避免将近 1 MB 的 TopoJSON 内联进应用脚本。
 * 多个地图面板共用同一个 Promise，因此只会发起一次请求和一次转换。
 */
export function loadBaseFeatures() {
  if (!baseFeaturesPromise) {
    baseFeaturesPromise = Promise.all(
      Object.values(MAP_DATA_URLS).map(async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`底图加载失败: ${response.status}`)
        return response.json()
      })
    ).then(([worldTopo, chinaTopo]) => ({
      world: feature(worldTopo, worldTopo.objects.land),
      china: feature(chinaTopo, chinaTopo.objects.bou2_4l)
    }))
  }
  return baseFeaturesPromise
}
