# SVG 图像瓦片式加载改造计划

## 概要

- 将后端 SVG 产物从“每个天气图层一张 SVG”改造为四叉树瓦片。
- 固定使用 3 级瓦片方案，范围为 `60E-150E, 0N-60N`。
- 前端优先读取 manifest 中的瓦片记录；若遇到旧版单张 SVG 记录，仍保持兼容显示。
- 实施顺序先改造 `src/draw/generate_svg_layers.py`，再改造 `vis_web` 的按缩放等级加载逻辑。

## 瓦片方案

- 投影：`PlateCarree`。
- 范围：经度 `60-150E`，纬度 `0-60N`。
- 原点：西北角；`x` 从西向东递增，`y` 从北向南递增。
- 层级：
  - `z=0`：`1 x 1`，单瓦片 `90 x 60` 度。
  - `z=1`：`2 x 2`，单瓦片 `45 x 30` 度。
  - `z=2`：`4 x 4`，单瓦片 `22.5 x 15` 度。
- 瓦片范围计算公式：
  - `n = 2 ** z`
  - `tile_lon_size = 90 / n`
  - `tile_lat_size = 60 / n`
  - `lon_min = 60 + x * tile_lon_size`
  - `lon_max = 60 + (x + 1) * tile_lon_size`
  - `lat_max = 60 - y * tile_lat_size`
  - `lat_min = 60 - (y + 1) * tile_lat_size`

## 后端改造

- 新增 `src/draw/svg_layer_config.py`。
  - 定义 `TILE_SCHEME`，包含瓦片范围、原点、层级和每层瓦片数量。
  - 将主要绘图参数从 `generate_svg_layers.py` 中抽离出来。
  - 提供 `style_for(layer_type, level, z)`，用于按图层类型、气压层和瓦片层级获取绘图参数。
  - 配置项覆盖风矢量/风羽密度、平滑参数、流线密度、等值线间隔、等值线范围、颜色、线宽、填色分级、色标和 `extend` 模式。

- 改造 `src/draw/generate_svg_layers.py`。
  - 将 `DEFAULT_BOUNDS` 改为 `(60.0, 150.0, 0.0, 60.0)`。
  - 新增 `Tile` 数据结构，字段包括 `z`、`x`、`y` 和 `bounds`。
  - 新增基于四叉树方案的瓦片遍历函数。
  - 新增 `--tile-levels` 参数，默认值为 `0 1 2`。
  - 保留 `--bounds`，用于覆盖完整生成范围。
  - 保留 `--skip` 和 `--sigma` 作为命令行兜底参数，但优先使用 `svg_layer_config.py` 中的配置。
  - 输出路径改为：
    `data/products/{init_time}/{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg`

- 更新图层生成流程。
  - 每个预报时效、气压层和图层类型只打开一次所需 NetCDF 字段。
  - 在同一数据字段基础上循环所有瓦片，并按瓦片 bounds 分块渲染。
  - `--skip-existing` 按单个瓦片生效，支持断点续生成。
  - 日志中补充 `fc_hour`、`level`、`layer_type`、`z`、`x`、`y`。

- 更新绘图函数。
  - 所有 `draw_*` 函数增加 `style` 参数。
  - 将硬编码参数替换为配置值，例如 `skip=8`、流线 `density=1.45`、等值线间隔 `2`、颜色、线宽和风羽长度。
  - 单位转换和科学计算逻辑仍保留在绘图模块中，例如温度 K 转摄氏度、气压 Pa 转 hPa、涡度放大系数等。

## Manifest 改造

- 顶层新增 `tile_scheme` 字段：

```json
{
  "type": "quadtree",
  "projection": "PlateCarree",
  "bounds": {
    "lon_min": 60,
    "lon_max": 150,
    "lat_min": 0,
    "lat_max": 60
  },
  "origin": "northwest",
  "levels": [0, 1, 2],
  "tile_count": {
    "0": [1, 1],
    "1": [2, 2],
    "2": [4, 4]
  }
}
```

- 每个产品记录增加按缩放层级分组的 `tiles` 字段：

```json
{
  "init_time": "2026070100",
  "fc_hour": "024",
  "level": 500,
  "layer_type": "wind_speed_fill",
  "bounds": {
    "lon_min": 60,
    "lon_max": 150,
    "lat_min": 0,
    "lat_max": 60
  },
  "projection": "PlateCarree",
  "status": "generated",
  "tiles": {
    "0": [
      {
        "z": 0,
        "x": 0,
        "y": 0,
        "path": "024/500/wind_speed_fill/0/0/0.svg",
        "bounds": {
          "lon_min": 60,
          "lon_max": 150,
          "lat_min": 0,
          "lat_max": 60
        },
        "status": "generated"
      }
    ]
  }
}
```

- 默认不再生成旧版单张 SVG 产物。
- 前端继续支持旧版仅包含 `path` 的产品记录。
- manifest 回填逻辑需要同时识别两种路径：
  - 旧路径：`{fc_hour}/{level}/{layer_type}.svg`
  - 新路径：`{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg`

## 前端改造

- 更新 `vis_web/src/composables/useWeatherView.js`。
  - 新增 `getTileZoom(k)`，固定阈值为：
    - `k <= 5`：使用 `z=0`
    - `5 < k <= 8`：使用 `z=1`
    - `k > 8`：使用 `z=2`
  - 新增瓦片记录辅助函数：
    - `hasTiles(record)`
    - `tilesForRecord(record, z)`
    - `tileUrl(tile)`
    - `isTileVisible(tile, projection, canvasSize, zoomTransform)`
  - 更新 `loadActiveLayer()`，使其支持两种加载方式：
    - 对新瓦片记录，加载当前缩放等级下可见的瓦片。
    - 对旧单图记录，继续加载原单张 SVG。
  - 继续复用现有 `SvgImageCache`，以瓦片 URL 作为缓存键。
  - 记录当前已加载的瓦片缩放等级；只有当缩放跨过瓦片等级阈值，或选中图层、预报时效、气压层、起报时间、manifest 变化时才重新加载。

- 更新绘制行为。
  - `activeSvgLayers` 同时支持旧结构 `{ image, record }` 和新结构 `{ tiles: [{ image, bounds, path }] }`。
  - `drawWeatherLayers()` 按既有图层优先级绘制每个图层中的所有已加载瓦片。
  - 每个瓦片按自身地理范围绘制：
    - 左上角：`[bounds.lon_min, bounds.lat_max]`
    - 右下角：`[bounds.lon_max, bounds.lat_min]`
  - 保持现有填色图层透明度策略不变。

- 更新地图范围。
  - `buildProjection()` 和经纬网范围优先读取 `manifest.tile_scheme.bounds`。
  - 旧数据缺少 `tile_scheme` 时使用默认范围。
  - 新默认范围为 `60-150E, 0-60N`。

- 本阶段不迁移参考项目中的 Lambert/WebWorker 重投影体系。
  - 只借鉴缩放等级选择、瓦片可见性过滤和瓦片图像缓存思路。

## 测试计划

- Python 语法检查：
  - `uv run python -m py_compile src/draw/generate_svg_layers.py src/draw/svg_layer_config.py`
- 后端冒烟测试：
  - 使用单个预报时效、单个气压层执行 `--tile-levels 0 1 2 --overwrite`。
  - 确认每个生成图层有 `21` 个 SVG 文件。
  - 确认 `z=0` 有 `1` 个瓦片，`z=1` 有 `4` 个瓦片，`z=2` 有 `16` 个瓦片。
- Manifest 校验：
  - 确认存在 `tile_scheme`，且范围符合约定。
  - 确认每个瓦片产品包含 `tiles.0`、`tiles.1`、`tiles.2`。
  - 确认每个 tile 的 `bounds` 与四叉树公式一致。
- 前端构建：
  - `cd vis_web && pnpm build`
- 前端手工验证：
  - 启动 Vite 开发服务。
  - 确认旧版单张 SVG manifest 仍能显示。
  - 确认瓦片 manifest 在缩放跨阈值时分别加载 `z=0`、`z=1`、`z=2`。
  - 确认同一缩放等级内平移不会不必要地重新加载所有产品。
  - 确认多选 SVG 图层仍保持填色层和叠加层的绘制顺序。

## 默认假设

- 新后端产物默认只生成瓦片 SVG；如需同时生成旧版单张 SVG，可后续增加兼容模式。
- `data/products` 中已有的旧版单张 SVG 数据可以继续保留，并由前端兼容读取。
- 新的固定生产范围为 `60E-150E, 0N-60N`。
- 初版实现保留现有 canvas 绘制架构，不引入 worker 重投影。
