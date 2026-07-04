# SVG 批量生成性能改造计划

## 背景

当前 `src/draw/generate_svg_layers.py` 在指定 `init_time` 下批量生成 SVG 天气图层时耗时较长。

默认生成规模大致为：

- 预报时效：`52` 个。
- 高空层次：`7` 个。
- 高空图层：`8` 类。
- 地面图层：`5` 类。
- 默认瓦片层级：`z=0,1,2`，当前业务范围约 `21` 个瓦片。

完整批次约生成：

```text
52 * (7 * 8 + 5) * 21 = 66,612 个 SVG
```

本计划只考虑在现有 SVG 瓦片产物体系内优化，不考虑改变前端产物形态或改为其他格式。

## 当前主要瓶颈

1. 每个瓦片都重复创建 Matplotlib/Cartopy 图形对象。
   - `setup_axis()` 和 `fig.savefig()` 在每个 tile 上执行。
   - SVG 输出为大量小文件，文件创建和写入成本高。

2. 数据读取重复。
   - `open_data_array()` 每次调用都会 `xr.open_dataset()`。
   - 同一 `init_time`、`fc_hour`、`level` 下，不同图层会重复打开相同 NetCDF/THREDDS 数据。
   - 如果数据源是远程 THREDDS/OPeNDAP，这部分会成为显著瓶颈。

3. 预处理重复。
   - 风场平滑、风速计算、温度单位转换、位势高度平滑、海平面气压单位转换等逻辑在 tile 绘制过程中重复执行。
   - 相同产品的 21 个 tile 会重复处理同一整块数据。

4. 跳过逻辑粒度偏晚。
   - 当前逐 tile 判断 `skip_existing`。
   - 如果一个图层的所有瓦片都已存在，仍可能先读取数据和准备字段。

5. 日志输出过多。
   - 每个 tile 都打印完成/跳过/失败日志。
   - 完整批次会产生数万行输出，增加运行时开销，也降低排障可读性。

6. manifest 回填扫描可能拖慢复跑。
   - `backfill_manifest_from_existing_svgs()` 会扫描已有 SVG。
   - 如果上一次任务中断且没有写出 `manifest.json`，下次启动可能先扫描大量小文件。

## 方案 A：保守型性能优化

目标是在不改变现有输出路径和前端读取方式的前提下，降低重复 I/O、重复计算和无效绘制。

### A1. Dataset 缓存

新增进程内数据集缓存，避免同一 worker 内重复 `xr.open_dataset()`。

建议设计：

- 增加 `DatasetCache` 或简单的路径到 `xr.Dataset` 字典。
- 缓存键使用实际 `path_or_url`。
- `open_data_array()` 拆分为两层：
  - `open_dataset_cached(path_or_url)`：负责打开和缓存 dataset。
  - `select_data_array(dataset, variable_candidates, init_time, level, bounds)`：负责变量选择、时间选择、层次选择和裁剪。
- 每个 worker 结束时关闭已打开的 dataset，避免文件句柄泄漏。

收益：

- 本地 NetCDF：减少文件打开次数。
- 远程 THREDDS：减少 OPeNDAP 握手和元数据读取次数。

风险：

- 多进程下缓存是每个进程独立的，不共享。
- 需要确保 dataset 生命周期覆盖本 worker 的所有绘图任务。

### A2. Layer 级别跳过

在读取数据前判断该 `fc_hour + level + layer_type` 的全部 tile 是否已经存在。

建议设计：

- 新增 `tile_output_paths(...)`，统一计算某个产品的所有 tile 路径。
- 新增 `all_tiles_exist(paths)`。
- 在 `generate_upper_air_layers()` 和 `generate_surface_layers()` 中：
  - 如果 `args.skip_existing` 且全部 tile 存在，直接构造 manifest 记录，状态为 `skipped`。
  - 不读取 NetCDF，不做平滑，不进入绘图。

收益：

- 复跑、断点续生成时收益最大。
- 避免因为少量已经完成的图层仍触发远程数据读取。

风险：

- 必须确保 manifest 记录仍完整包含 tile 信息。
- 如果用户希望强制重绘，`--overwrite` 必须保持现有语义。

### A3. 预处理结果缓存

将目前在每个 tile 内重复做的计算提前到每个产品只做一次。

建议缓存粒度：

- `hght_contour`：
  - `five_point_smooth(hght)`。
  - `values = hght / 10.0`。
  - contour levels。
- `wind_quiver` / `wind_barb` / `wind_streamline`：
  - `smooth_array(u, sigma)`。
  - `smooth_array(v, sigma)`。
- `wind_speed_fill`：
  - `wind_speed(u, v)`。
  - `smooth_array(speed, sigma)`。
- `temp_contour`：
  - `temperature_celsius(temp)`。
  - `five_point_smooth(...)`。
- `rhum_fill`：
  - `relative_humidity_percent(rhum)`。
- `vort_fill`：
  - `vort * scale_factor`。
- `mslp_contour`：
  - `mslp_hpa(mslp)`。
  - `five_point_smooth(...)`。
  - contour levels。

收益：

- 同一产品默认 21 个 tile，可减少约 20 次重复预处理。
- 对 `gaussian_filter`、`streamplot` 前处理和 `wind_speed` 这类计算收益明显。

风险：

- 需要梳理不同 `z` 或 `style` 是否会改变预处理结果。
- 当前配置里 `sigma` 不随 `z` 变化；如果未来按 zoom 调参，缓存键要包含 `z` 或 style signature。

### A4. 绘图前按 tile 裁剪数据

当前绘图函数接收的是整个业务范围数据，并通过 `ax.set_extent(tile.bounds)` 限制显示范围。Matplotlib 仍可能处理比 tile 更大的数据网格。

建议设计：

- 新增 `crop_to_bounds(data, tile.bounds, padding=...)`。
- 对 contour/contourf 可增加少量 padding，避免边界线断裂。
- 对 quiver/barb/streamline 使用 tile 范围内的数据。

收益：

- 减少每个 tile 中 contour、streamplot、quiver/barb 处理的数据点数量。
- 对高分辨率数据或更高 zoom 级别收益更明显。

风险：

- 等值线/填色图在 tile 边界处可能出现视觉拼接差异。
- 需要用几个典型图层人工检查 tile 边界显示效果。

### A5. 日志汇总

将每个 tile 一行日志改为每个产品一行汇总日志。

建议设计：

- 默认输出：
  - `fc_hour`
  - `level`
  - `layer_type`
  - generated/skipped/failed tile 数量
  - 耗时
- 新增 `--verbose-tiles` 用于保留当前逐 tile 日志。

收益：

- 减少数万行输出。
- 更容易定位慢图层和失败图层。

风险：

- 排查单个 tile 失败时需要打开 verbose。

### A6. Manifest 轻量化一致性方案

避免长批次中断后完全没有 manifest，同时避免多进程并行写同一个 JSON 文件。

结论：

- 不引入数据库。
- 不让 worker 进程直接写 `manifest.json`。
- 保留一个前端读取用的总 manifest：`data/products/{init_time}/manifest.json`。
- 并行安全由“主进程单点写入 + 原子替换”保证。

建议设计：

1. 主进程是唯一 manifest writer。
   - worker 只负责生成 SVG 和返回 `product_tile_record`。
   - 主进程在 `as_completed()` 收到 worker 返回值后合并记录。
   - 主进程合并后按 checkpoint 策略写出总 manifest。
   - 这样不存在多个进程同时写 `manifest.json` 的问题。

2. 总 manifest 使用原子替换。
   - 先写入同目录临时文件：`manifest.json.tmp.{pid}`。
   - 写入完成后用 `Path.replace()` 替换为 `manifest.json`。
   - 任意时刻前端要么看到旧 manifest，要么看到新 manifest，不会看到半截 JSON。

3. checkpoint 粒度保持轻量。
   - 默认每完成一个 job 写一次。
   - 如果按当前任务粒度，即每个 `fc_hour + level` 或 `fc_hour + surface` 写一次。
   - 如果后续采用 B2 按 `fc_hour` 分组，则每完成一个 `fc_hour` 写一次。
   - 可增加 `--manifest-checkpoint-interval N`，表示每完成 N 个 job 写一次，默认 `1` 或 `5`。

4. 不依赖全目录递归扫描恢复。
   - 下次启动时先读取已有 manifest。
   - 对本次计划生成的产品，直接根据预期 tile 路径判断是否全部存在。
   - 如果全部存在，则快速重建该产品的 manifest 记录。
   - 这比 `glob("**/*.svg")` 扫描整个 init_time 目录更轻。

5. 可选增加产品分片 manifest，仅用于断点恢复。
   - 目录：`data/products/{init_time}/_manifest_parts/`。
   - 文件粒度：一个产品一个 JSON，例如：
     `000/500/wind_speed_fill.json`
   - 每个 worker 只写自己负责的分片文件，不写共享文件。
   - 分片写入同样使用临时文件原子替换。
   - 主进程启动时可读取这些小 JSON 合并为总 manifest。
   - 该机制是可选增强，不作为第一阶段必做项。

推荐第一阶段实现：

- 只做主进程单点写 `manifest.json`。
- 每完成一个 job 原子 checkpoint 一次。
- 增加“按预期路径快速补记录”，替代启动时扫描全量 SVG。
- 暂不引入数据库，暂不强制引入 `_manifest_parts/`。

如果后续发现进程崩溃或机器重启导致单个 job 内产物丢失 manifest 记录，再加入 `_manifest_parts/`。

收益：

- 中断后可从 manifest 继续。
- 减少下次启动对海量 SVG 的回填扫描依赖。
- 没有并行写总 manifest 的竞争。
- 不引入 SQLite、DuckDB 等额外状态存储，部署和排障成本低。

风险：

- manifest 写入次数增加，但相对 SVG 绘制开销很小。
- 如果进程在某个 job 尚未返回前崩溃，该 job 已生成的 SVG 可能还没有进入总 manifest。
  - 第一阶段通过“按预期路径快速补记录”恢复。
  - 如仍不够，再启用 `_manifest_parts/`。

### A7. 可选关闭 manifest 回填

新增 `--no-backfill` 参数。

建议设计：

- 默认保持现有行为，继续回填，保证兼容。
- 当用户明确知道 manifest 有效时，可用 `--no-backfill` 跳过扫描。

收益：

- 已有大量 SVG 且 manifest 存在时，启动更快。

风险：

- 如果 manifest 缺失或不完整，前端可能看不到已有 SVG。

## 方案 B：并行调度优化

目标是在方案 A 的基础上，调整任务拆分方式，减少不同 worker 的重复数据读取，并控制远程数据源压力。

### B1. 当前并行方式

当前任务构造逻辑：

```text
upper_air: fc_hour + level
surface: fc_hour + surface
```

每个任务内部串行生成所有图层和所有 tile。

优点：

- 实现简单。
- worker 间共享状态少。

问题：

- 同一 `fc_hour` 下的 7 个高空层可能分散到多个进程。
- 多个进程可能同时打开同一批 NetCDF/THREDDS 文件。
- 对远程服务不友好，容易形成高并发重复读取。

### B2. 按 fc_hour 分组调度

将并行单位改为一个 worker 处理一个 `fc_hour` 的全部产品。

建议设计：

- 新增 job 类型：

```text
("fc_hour", fc_hour)
```

- worker 内部顺序处理：
  - 所有高空层。
  - 地面层。
  - 每个产品下的图层和 tile。
- worker 内复用 Dataset 缓存。

收益：

- 同一时效的数据打开和元数据读取集中在同一个 worker 内。
- 与 Dataset 缓存配合更有效。
- 任务数量从 `52 * (7 + 1)` 降到 `52`，调度开销更低。

风险：

- 单个 job 时间变长。
- 如果某个时效特别慢，尾部 worker 可能拖长整体完成时间。

适用场景：

- 数据源是远程 THREDDS。
- 本地磁盘或网络盘打开 NetCDF 成本高。

### B3. 分层并发控制

区分数据读取并发和绘图并发。

建议设计：

- 保留 `--workers` 表示绘图 worker 数。
- 新增 `--data-workers` 或 `--max-remote-workers`，用于限制远程数据读取并发。
- 简化版本可先不引入新参数，只在文档建议远程 THREDDS 场景下将 `--workers` 设置为较小值。

收益：

- 避免并发过高拖慢 THREDDS 服务。
- 减少请求失败和超时概率。

风险：

- 参数更多，需要给出推荐默认值。

### B4. 任务耗时统计

为后续调优收集可比较指标。

建议设计：

- 每个产品记录耗时：
  - data load time
  - preprocess time
  - render time
  - write time 可以先不单独统计，包含在 render 内。
- 每个 `fc_hour` 输出总耗时。
- 可选写入 `generation_stats.json`。

收益：

- 能确认瓶颈到底在远程读取、预处理、contour/streamplot，还是文件写入。
- 后续调参有依据。

风险：

- 统计代码要保持轻量，避免影响主流程。

## 推荐实施顺序

1. 实施方案 A 的低风险部分：
   - A2 Layer 级别跳过。
   - A5 日志汇总。
   - A6 Manifest 轻量化一致性方案。
   - A7 可选关闭 backfill。

2. 实施数据与计算缓存：
   - A1 Dataset 缓存。
   - A3 预处理结果缓存。

3. 增加计时统计：
   - B4 任务耗时统计。

4. 在一个固定 `init_time` 上对比运行：
   - 小样本：`--fc-hours 000 003 --levels 500`。
   - 中样本：`--fc-hours 000 003 006 009 --levels 200 500 850`。
   - 全量：默认全部时效和层次。

5. 根据统计结果决定是否实施：
   - A4 tile 裁剪。
   - B2 按 `fc_hour` 分组调度。
   - B3 分层并发控制。

## 验收标准

1. 输出路径不变：

```text
data/products/{init_time}/{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg
```

2. 前端 manifest 结构保持兼容。

3. `--skip-existing` 和 `--overwrite` 语义不变。

4. 中断后重新运行，已完成产品能够快速跳过。

5. 小样本生成结果与现有结果视觉一致。

6. 至少完成以下检查：

```powershell
uv run python -m py_compile src/draw/generate_svg_layers.py
```

并使用固定小样本运行一次 SVG 生成。

## 待确认问题

1. 当前批量生成主要使用远程 THREDDS，还是本地 NetCDF 文件？主要使用远程 THREDDS

2. 期望完整生成一个 `init_time` 控制在多长时间以内？2 小时
   - 例如 30 分钟、1 小时、2 小时。

3. 是否允许默认减少日志，只在 `--verbose-tiles` 时输出每个 tile？默认减少日志

4. 是否允许新增这些参数？允许
   - `--no-backfill`
   - `--manifest-checkpoint-interval`
   - `--verbose-tiles`
   - 后续可能的 `--data-workers`

5. 是否接受第一阶段不引入数据库，也不默认拆分多个前端 manifest？接受
   - 推荐保留单个 `manifest.json` 给前端读取。
   - 可选 `_manifest_parts/` 只作为后续断点恢复增强。接受

6. 所有图层是否都必须默认生成？默认生成
   - 特别是 `wind_streamline`、`wind_barb`、`rhum_fill` 这类耗时或体积较大的图层。

7. 是否接受在图层全部 tile 已存在时，只根据文件存在性直接写 manifest 记录，而不重新读取数据校验内容？接受
