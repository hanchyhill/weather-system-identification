# SVG 瓦片减量与前端降级加载计划

## Summary

- 后端继续使用现有瓦片目录与 manifest 结构，但按图层类型决定实际生成的 z 层级。
- 仅 `wind_barb`、`wind_quiver`、`surface_barb`、`surface_quiver` 生成 `z=0,1,2`。
- 其他图层只生成 `z=0`，并把该 `z=0` SVG 的画布尺寸提升到当前 `z=1` 拼接后的清晰度水平。
- 前端按当前缩放等级请求瓦片；当目标 z 不存在时，自动回退到该图层可用的最高或最近 z，例如在 `z=2` 下用非风场图层的 `z=0` 叠加绘制。

## Key Changes

- 在 `src/draw/generate_svg_layers.py` 增加图层级别规则：
  - 新增常量 `MULTI_Z_LAYER_TYPES = {"wind_barb", "wind_quiver", "surface_barb", "surface_quiver"}`。
  - 新增 `tile_levels_for_layer(layer_type, requested_levels)`：
    - 多层图层返回 `requested_levels` 与 `[0, 1, 2]` 的交集。
    - 其他图层固定返回 `[0]`。
  - `generate_upper_air_layers()` 和 `generate_surface_layers()` 不再共用全局 `tiles = iter_tiles(bounds, args.tile_levels)`，改为每个 `layer_type` 单独计算 `layer_tile_levels` 与 `tiles`。
  - `product_tile_record()` 只记录实际生成的 `tiles`，非多层图层 manifest 中只出现 `tiles.0`。

- 提升非多层图层 `z=0` 输出清晰度：
  - 在 `src/draw/svg_layer_config.py` 中为非多层图层增加或通过 `style_for()` 注入高分辨率 `figure_size`。
  - 默认 `figure_size=(10, 8)` 保持给单瓦片使用。
  - 非多层图层在 `z=0` 使用 `figure_size=(20, 16)`，等价于当前 `z=1` 的 `2x2` 拼接画布尺寸。
  - 不改变地理 bounds、路径、投影和瓦片编号，只改变 SVG intrinsic size/viewBox 级别的绘制尺寸。

- 更新 manifest 语义：
  - 顶层 `tile_scheme.levels` 仍可保留 CLI 请求的 `[0, 1, 2]`，表示系统支持的瓦片层级。
  - 每个产品以自身 `record.tiles` 为准表示实际可用层级。
  - 不新增破坏性字段；可选新增 `available_tile_levels` 到产品记录，值为实际生成层级，例如 `[0]` 或 `[0, 1, 2]`，方便前端调试和状态展示。

- 前端 `vis_web/src/composables/useWeatherView.js` 增加瓦片层级回退：
  - 新增 `availableTileZooms(record)`，从 `record.tiles` 的 key 中读取可用 z。
  - 新增 `resolveTileZoom(record, desiredZ)`：
    - 如果 `desiredZ` 存在，直接使用。
    - 如果不存在，选择小于等于 `desiredZ` 的最大可用 z。
    - 若没有小于等于的 z，则选择最小可用 z。
  - `loadSvgTileLayer()` 和 `loadVisibleTileDelta()` 使用 resolved z，而不是直接使用 `getTileZoom(k)`。
  - `loadedTileZoom` 可继续记录视图期望 z；每个 layer 自己记录实际 `layer.z`，用于增量加载。
  - 在 `z=2` 视图下，风羽/风矢量图层加载 `z=2`，其他图层加载 `z=0` 并按自身 `bounds` 覆盖全域。

- 保持现有数据安全策略：
  - 不删除已有旧 SVG 文件。
  - 新生成与 manifest 会按新规则引用较少瓦片；旧的非风场 `z=1/2` 文件即使存在，也不会被新版 manifest 使用。
  - 若后续需要释放磁盘空间，再单独做清理脚本或手工清理计划。

## Tests

- Python 语法检查：
  - `uv run python -m py_compile src/draw/generate_svg_layers.py src/draw/svg_layer_config.py`

- 后端小样本验证：
  - 用单个 `init_time`、单个 `fc_hour`、单个高空层执行 `--tile-levels 0 1 2 --overwrite`。
  - 确认 `wind_barb`、`wind_quiver` 生成 21 个瓦片：`z=0` 1 个、`z=1` 4 个、`z=2` 16 个。
  - 确认 `hght_contour`、`wind_speed_fill`、`wind_streamline`、`temp_contour`、`vort_fill`、`rhum_fill` 只生成 1 个 `z=0` 瓦片。
  - 地面层同理确认 `surface_barb`、`surface_quiver` 为 21 个瓦片，其他地面图层只生成 1 个 `z=0` 瓦片。

- Manifest 校验：
  - 多层图层包含 `tiles.0`、`tiles.1`、`tiles.2`。
  - 非多层图层只包含 `tiles.0`。
  - 所有 tile path 仍为 `{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg`。
  - 现有旧版单图 `path` 兼容逻辑不受影响。

- 前端验证：
  - `cd vis_web && pnpm build`
  - 缩放到 `k > 8` 时，风羽/风矢量使用 `z=2`，其他已选图层仍显示且实际使用 `z=0`。
  - 多图层叠加顺序、透明度、平移增量加载和 IndexedDB 缓存仍正常。
  - 打开瓦片调试时能看出同一画面中不同图层可使用不同实际 z。

## Assumptions

- “其他要素”包括除 `wind_barb`、`wind_quiver`、`surface_barb`、`surface_quiver` 之外的所有高空和地面图层。
- “z=0 输出分辨率达到 z=1 水平”按当前绘图体系解释为：非多层图层的单张 `z=0` SVG 使用 `z=1` 的整域拼接等效画布尺寸，即 `figure_size=(20, 16)`。
- 本次只改新生成与前端读取规则，不自动清理已有旧瓦片文件。
