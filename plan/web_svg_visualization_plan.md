# Web 交互与 SVG 气象图层生成

## Summary

- 在 `vis_web/` 新建 Vue 3 + Vite 前端，使用 `pnpm` 管理依赖，参考 `H:\github\javascript\nwp_views` 的 d3/canvas 地图、缩放拖拽、坐标显示、SVG 瓦片加载和缓存思路。
- 在 `src/draw/` 新增 Python SVG 生成脚本，使用本项目现有 `uv` 环境和 `xarray/matplotlib/cartopy/scipy`，生成透明背景 SVG 图层和前端可读取的 `manifest.json`。
- 前端支持起报时次、预报时效、气压层、图层类型切换，并叠加槽线 JSON 数据绘制。

## Key Changes

- 前端应用：
  - 使用 `vue@latest`、`vite@latest`、`d3@latest`、`d3-geo@latest`、`d3-zoom@latest`、`topojson-client@latest`、`pinia@latest`、`naive-ui@latest`。
  - 主界面为一屏式业务工具：左侧/顶部为时次、层次、图层开关和生成状态；主体为可缩放拖拽地图画布；角落显示鼠标经纬度、当前瓦片/图层加载状态。
  - 从 `public/products/manifest.json` 读取可用 `init_time`、`fc_hour`、`level`、`layer_type`，按选择加载对应 SVG。
  - 地图基础层用 d3 + topojson 绘制，气象 SVG 图层按经纬度 bounds 投影到画布；槽线数据从现有 `data/{init_time}/trough_data/*.json` 或复制到前端 public 的 JSON 中读取后按 `smoothed_points` 绘制。

- Python SVG 生成：
  - 新增 `src/draw/generate_svg_layers.py`，提供 CLI：

    ```bash
    uv run python src/draw/generate_svg_layers.py --init-time 2026062900 --fc-hours 000 003 --levels 200 500 850 925 950 --output vis_web/public/products
    ```

  - 高空层生成 5 类产品：`hght_contour`、`wind_quiver`、`wind_barb`、`wind_speed_fill`、`wind_streamline`。
  - 地面层生成 4 类产品：`surface_quiver`、`surface_barb`、`surface_speed_fill`、`surface_streamline`。
  - 默认数据源沿用项目 THREDDS 约定：`uwnd.nc`、`vwnd.nc`、`hght.nc`，变量名为 `{element}{fc_hour}`；地面风优先支持本地/IFS 风格 `u10/v10` 文件路径，也保留可配置 THREDDS/NetCDF 输入参数。
  - 输出结构统一为：

    ```text
    vis_web/public/products/{init_time}/{fc_hour}/{level}/{layer_type}.svg
    vis_web/public/products/{init_time}/{fc_hour}/surface/{layer_type}.svg
    vis_web/public/products/manifest.json
    ```

  - SVG 均为 PlateCarree 经纬度平面图、透明背景、无坐标轴边框，并在 manifest 中记录 `lon_min/lon_max/lat_min/lat_max` 供前端定位。

- 槽线绘制：
  - 前端读取现有槽线 JSON 格式，不改变 `src/trough.py` 输出结构。
  - 支持按当前 `init_time + fc_hour + level` 自动匹配 `trough_{init_time}_{fc_hour}_{level}hPa_ecmwf.json`。
  - 提供槽线开关、按 `shear_type` 着色、显示/隐藏原始点和线条属性 tooltip。

## Test Plan

- Python：
  - 运行 `uv run python -m py_compile src/trough.py src/draw/generate_svg_layers.py`。
  - 用一个已有时次和少量层次生成 SVG，确认 `manifest.json` 结构完整、SVG 可打开且背景透明。
- 前端：
  - 运行 `pnpm install`、`pnpm build`。
  - 启动 `pnpm dev` 后检查：时次/预报时效/层次切换可用，SVG 图层随选择更新，缩放拖拽后图层仍与底图对齐，槽线可开关显示。
- 集成：
  - 使用 `data/2026062900/trough_data` 的示例 JSON 验证槽线绘制。
  - 验证缺失某个 SVG 或 JSON 时前端显示明确空状态，不阻塞其他图层。

## Assumptions

- 默认地图范围参考 `nwp_views`：`lon=60..180`、`lat=0..60`，实现为 CLI 可配置参数。
- 默认只生成整幅 SVG 平面图；若后续文件过大，再按 `nwp_views` 的瓦片策略扩展为多 zoom 瓦片。
- 不修改现有槽线 JSON 格式；前端做适配读取。
- 10 米风数据来源不在当前主流程中完全固定，因此脚本会支持显式传入 `--u10-path`、`--v10-path`，并保留默认变量名 `u10/v10`。
