# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

天气系统自动识别系统，从 ECMWF NetCDF 预报数据中识别槽线、急流轴、涡旋（中心/暖心/路径），生成 SVG 瓦片图层，并通过 Vue 前端可视化。分为两层：

- **Python 分析后端**（`src/`）：读取 THREDDS 数据 → 识别算法 → 输出 JSON/PNG/SVG 到 `data/`。
- **Vue 可视化前端**（`vis_web/`）：读取 `/data` 下的 SVG 瓦片与 JSON，渲染交互地图。

## 常用命令

Python 环境用 `uv`（Python ≥3.10），前端用 `pnpm`（Node v24）。

```bash
# 环境
uv sync                                 # 按 uv.lock 安装/更新 Python 依赖

# 运行识别算法（--init-time 格式 YYYYMMDDHH，不传则按 calLatestBaseTime() 取最新起报）
uv run python src/jet.py --init-time 2026062900
uv run python src/trough.py --init-time 2026062900
uv run python src/vortex_workflow.py --init-time 2026062900   # 涡旋三段式总入口
uv run python src/draw/generate_svg_layers.py --init-time 2026062900  # 生成前端 SVG 瓦片

# 测试
uv run python -m unittest discover                # 全部测试
uv run python -m unittest tests.test_jet          # 单个测试模块
uv run python -m unittest tests.test_jet.<Class>.<method>  # 单个用例
uv run python -m py_compile src/vortex_common.py src/vortex_center.py  # 语法检查

# 前端（在 vis_web/ 下）
pnpm install
pnpm dev        # vite dev，通过 localDataPlugin 直接从仓库 ./data 读取瓦片
pnpm build      # 产物输出 vis_web/dist

# 生产部署（Linux）：构建前端 + 用 PM2 拉起定时任务
./start_weather_business_pm2.sh
```

各算法的完整参数、输出路径与 JSON 结构详见 `README.md`（涵盖 trough / jet / vortex 三类）。

## 架构要点

**数据来源**：所有算法从内部 THREDDS 服务器读取 NetCDF（`http://10.148.8.71:7080/thredds/dodsC/`，源 `ecmwfthin`），URL 模板硬编码在 `weather_common.py`、`vortex_common.py`、`draw/generate_svg_layers.py`。无该服务器可访问时，端到端运行会失败，需依赖 `tests/`（用 mock 数据）验证逻辑。

**输出根目录随 OS 切换**：`weather_common.default_output_root()` 在 Windows 返回 `./data`（本地开发），在 Linux 返回 `/data/weather_vis`（生产）。生产环境可用 `WEATHER_OUTPUT_ROOT` / `WEATHER_PRODUCTS_ROOT` 环境变量覆盖。所有输出按 `data/{init_time}/<产品目录>/` 分区。

**两套通用工具模块**，新代码应复用而非重写：
- `weather_common.py`：槽线/急流轴共用（数据加载 `load_weather_data`、起报时次计算 `calLatestBaseTime`、连线/平滑 `form_lines`/`smooth_lines_bezier`、异常值校验、JSON 点序转换）。
- `vortex_common.py`：涡旋三段共用（路径构造 `center_json_path`/`warm_json_path`、`haversine_distance`、`read_json`/`write_json`、`VortexDataNotReadyError`）。

**涡旋三段式流水线**（`vortex_workflow.py` 串联，遵循增量更新）：
1. `vortex_center.py` — 多层涡旋中心，850hPa 用 10m 风场做地面校正。
2. `vortex_warm_core.py` — 仅处理本轮新生成的 850hPa 中心 JSON，基于 200/300/400/500hPa 平均温度判暖心。
3. `vortex_tracker.py` — 仅当本轮产生新暖心 JSON 时，对已具备 center+warm_core 的时效重追踪。
   已存在的 JSON 会被跳过；这是刻意的增量语义，改动流水线时注意保持。

**SVG 瓦片系统**：`draw/generate_svg_layers.py` 按 `{init_time}/{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg` 输出四叉树瓦片并写 `manifest.json`。瓦片投影/边界/缩放层级（PlateCarree、60–150°E、0–60°N、z=0..2）与图层样式定义在 `draw/svg_layer_config.py` —— 前端渲染依赖此 tile scheme，两端需保持一致。

**定时调度**：`src/schedule.py`（每小时 :16/:46 跑 jet+trough+vortex）、`src/draw_schedule.py`（每 10 分钟生成 SVG 图层）与 `src/situation_maps/generate_situation_maps.py`（形势图目录监听合成）是长驻进程，由 `ecosystem.weather-business.config.js` 统一管理。`nginx_nwp.conf` 将 `/data/` 映射到 `/data/weather_vis/`、`/` 指向 `vis_web/dist`。

**前端结构**（Vue 3 + Vite + Pinia + d3 + naive-ui）：核心逻辑集中在 `composables/useWeatherView.js`（视图状态、瓦片/数据加载、多图联动），`components/` 下按功能拆分（`MapWorkspace`/`MultiMap*` 单图与多图对比、`ControlRail` 控制栏、`ForecastSlider` 时效滑块、`DrawingToolbar`+`utils/mapDrawing.js` 绘制标注）。瓦片响应用 `utils/indexedDBCache.js` 做 IndexedDB 缓存。

**`ifs/` 是独立的旧版流水线**：基于本地 GRIB 文件 + SQLite 的台风追踪链（`01_..08_` 编号脚本），与 `src/` 的 THREDDS+JSON 涡旋流程**互不依赖**。修改 `src/` 涡旋算法时不要动 `ifs/`，反之亦然。

## 约定

- 领域变量沿用既有命名：`init_time`（起报，`YYYYMMDDHH`）、`fc_hour`（三位时效字符串如 `006`）、`step`（数值时效）、`target_lev`/`level`（hPa）、`lat`/`lon`。气象量务必注明单位。
- 算法内部点序不统一：急流轴内部用 `[lon, lat]`，但**所有 JSON 输出统一为 `{lat, lon}`**（经 `points_to_json` 转换）。
- 优先把可复用逻辑写成 `src/*.py` 中的可导入函数，notebook 仅作探索/运行入口。
- 生成产物（`.nc`/`.png`/`.svg`/`data/` 输出、PDF）不入库，见 `.gitignore`。
