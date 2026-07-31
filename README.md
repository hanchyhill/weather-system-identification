# 天气系统识别项目 (Weather System Identification)

## 项目概述

本项目致力于天气系统的自动识别和分析，特别专注于热带气旋（台风）的追踪、槽线系统和急流轴的检测。项目基于ECMWF（欧洲中期天气预报中心）的高质量气象数据，使用先进的数值分析方法进行天气系统识别。

## 主要功能

### 1. 槽线检测 (Trough Detection)
- **文件位置**: `src/trough.ipynb`
- **功能描述**: 
  - 处理500hPa高度层的气象数据
  - 分析温度、湿度、风场和高度场信息
  - 识别大气中的槽线系统
  - 支持ECMWF数据的实时处理

### 2. 台风定位器 (Typhoon Locator)
- **文件位置**: `src/ty-locator/locator.ipynb`
- **功能描述**: 
  - 自动识别和定位热带气旋
  - 基于ECMWF热带气旋追踪算法
  - 提供台风位置的精确定位功能

### 3. 涡旋中心、暖心与追踪 (Vortex Identification)
- **文件位置**:
  - `src/vortex_center.py`
  - `src/vortex_warm_core.py`
  - `src/vortex_tracker.py`
- **功能描述**:
  - 从TDS NetCDF风场中识别多层涡旋中心
  - 对850hPa中心使用10m风场进行地面中心校正，并计算100km内最大地面风速
  - 基于200、300、400、500hPa平均温度场识别暖心结构
  - 将逐时效暖心涡旋中心追踪为连续轨迹

### 4. 急流轴识别 (Jet Axis Identification)
- **文件位置**:
  - `src/jet.py`
  - `src/jet_v2.ipynb`
- **功能描述**:
  - 对风场进行高斯平滑并计算风速
  - 沿风场垂直方向计算风速平流
  - 基于风速阈值和平流符号变化提取急流轴点
  - 支持按起报时次、预报时效和气压层批量输出PNG图像与JSON数据

## 技术特点

### 数据源
- **主要数据**: ECMWF数值预报模式数据
- **数据格式**: NetCDF格式 (.nc文件)
- **数据获取**: 通过THREDDS数据服务器实时获取

### 技术栈
- **编程语言**: Python
- **主要依赖库**:
  - `xarray`: 多维数组数据处理
  - `metpy`: 气象学计算和分析
  - `cartopy`: 地理空间数据可视化
  - `matplotlib`: 数据可视化
  - `numpy`: 数值计算
  - `scikit-learn`: DBSCAN聚类

### 数据处理能力
- 支持多种气象要素：温度、湿度、风速、位势高度、海平面气压
- 支持多高度层数据处理（特别是500hPa）
- 实时数据处理和分析

## 项目结构

```
weather-system-identification/
├── src/
│   ├── trough.py                 # 槽线检测可复用函数
│   ├── trough.ipynb              # 槽线检测Notebook
│   ├── weather_common.py         # 槽线与急流轴算法通用工具
│   ├── jet.py                    # 急流轴识别脚本
│   ├── jet_v2.ipynb              # 急流轴识别Notebook
│   ├── vortex_common.py          # 涡旋算法通用工具
│   ├── vortex_center.py          # 涡旋中心识别脚本
│   ├── vortex_warm_core.py       # 暖心识别脚本
│   ├── vortex_tracker.py         # 涡旋追踪脚本
│   ├── vortex_workflow.py        # 涡旋三段式总入口脚本
│   ├── draw_schedule.py          # SVG 生成定时调度 + 每日冷数据归档
│   ├── archive_cold_data.py      # 超期起报时次从热盘迁移到 NFS 冷盘
│   └── ty-locator/
│       └── locator.ipynb         # 台风定位算法
├── vis_web/                      # Vue 可视化前端（含 Service Worker 缓存/预取）
│   ├── vite.config.js           # 含 WEATHER_REMOTE_DATA 远程数据调试代理
│   ├── public/sw.js             # Service Worker：瓦片缓存 + 分级预取 + Web Push 处理
│   └── src/                     # 组件、composables、utils（swClient / pushClient / initTime）
├── server/                       # Node 推送后端（Express + web-push，与绘图流水线解耦）
│   ├── server.js                # 订阅服务：VAPID 公钥 / 订阅 / 退订
│   ├── pushSchedule.js          # 30 分钟轮询：新起报时次即推一次
│   └── generateVapidKeys.js     # VAPID 密钥生成
├── ecosystem.weather-business.config.js  # PM2 应用定义（含 push-server / push-schedule）
├── nginx_nwp.conf               # nginx：/data 热冷两级回落、/api 反向代理
├── handoff/                     # 排查与迁移记录（性能定位、热冷存储部署手册）
├── 20228-tropical-cyclone-activities-ecmwf.pdf     # 热带气旋活动研究文档
├── ECMWF热带气旋追踪算法技术细节与跨机构比较.pdf    # 算法技术文档
├── Schumacher_etal_2009.pdf      # 相关学术文献
├── LICENSE                       # Mozilla Public License 2.0
└── README.md                     # 本文档
```

## 快速开始

### 环境要求
- Python 3.9+
- Jupyter Notebook 环境

### 安装依赖
```bash
uv sync
```

如果不使用 `uv`，也可以按 `pyproject.toml` 中的依赖手动安装。

### 运行示例
1. 启动Jupyter Notebook：
   ```bash
   jupyter notebook
   ```

2. 打开并运行槽线检测：
   ```bash
   # 在Jupyter中打开
   src/trough.ipynb
   ```

3. 打开并运行台风定位器：
   ```bash
   # 在Jupyter中打开
   src/ty-locator/locator.ipynb
   ```

4. 运行涡旋中心、暖心与追踪脚本：
   ```bash
   # 一键执行中心识别、暖心识别和追踪
   uv run python src/vortex_workflow.py --init-time 2026062900

   # 或者分阶段执行
   uv run python src/vortex_center.py --init-time 2026062900 --save-json
   uv run python src/vortex_warm_core.py --init-time 2026062900
   uv run python src/vortex_tracker.py --init-time 2026062900
   ```

5. 运行急流轴识别脚本：
   ```bash
   # 处理指定起报时次的默认时效和默认气压层
   uv run python src/jet.py --init-time 2026062900

   # 只处理850hPa的短时效子集
   uv run python src/jet.py --init-time 2026062900 --fc-hours 000 006 012 --target-levs 850

   # 只生成JSON，不保存PNG图像
   uv run python src/jet.py --init-time 2026062900 --target-levs 850 --no-save-image
   ```

### SVG 天气图层绘图测试

在仓库根目录执行以下命令，可使用 `2026072812` 起报的默认预报时效、气压层和瓦片层级生成 SVG 图层。`--overwrite` 会重新生成已有的 SVG 文件，便于检查绘图修改结果。

```bash
uv run python src/draw/generate_svg_layers.py --init-time 2026072812 --overwrite
```

如需先快速验证起报场（`000` 时效），可执行：

```bash
uv run python src/draw/generate_svg_layers.py --init-time 2026072812 --fc-hours 000 --overwrite
```

可按机器资源增加并行工作进程，例如 `--workers 4`。当前为减少重复风场产品，默认不生成流线图和风场箭头；风向杆以及 3/6/24 小时累计降水和其他图层会生成（仅在对应起止时效可用时生成）。

#### 填色图层的色阶数量与文件体积

`contourf` 的输出体积对色阶数量极其敏感，尤其是噪声较大的场：色阶越密，等值区被切碎成
越多的小多边形，SVG 路径数量随之爆炸。`vort_fill` 曾用 89 档色阶，导致单块瓦片最大
达 **71 MB**，占全部产品体积的 60%，而该图层仅占 3.8% 的请求量。

现为 8 档（低值 2 档蓝 + 高值 6 档黄橙红），定义在 `src/draw/svg_layer_rendering.py`：

```
0.05  0.10 | 0.15  0.30  0.45  0.60  0.75  0.90  1.00     单位 10⁻⁵ s⁻¹
 蓝 2 档    |          黄橙红 6 档
```

低于 0.05 由 `set_under` 透明；高于 1.00 由 `extend="both"` 收进溢出色。
同数据 A/B 实测：67.64 MB → 7.40 MB，渲染 4.11 s → 0.49 s。

修改任何填色图层的色阶时注意两点：

- **前后端必须同步**。`COLOR_ARR_VORT`（Python）与 `vis_web/src/utils/colorLegend.js`
  的 `VORT_COLORS` 是逐档对应的，只改一端会让图例与实际填色错位；图例刻度的
  `offset` 也要按新的档数重算。
- **单块瓦片体积随天气活跃度剧烈变化**，同一路径在活跃时次可达 68 MB、平静时次仅
  0.76 MB。评估色阶改动必须用**同一时次、同一数据**做 A/B，跨时次比较没有意义。

### 前端开发与远程数据调试

默认情况下 `pnpm dev` 通过 `vite.config.js` 的 `localDataPlugin` 直接从仓库的 `./data`
目录读取瓦片与 JSON：

```bash
cd vis_web
pnpm install
pnpm dev
```

本机 `./data` 数据量有限时，可用 `WEATHER_REMOTE_DATA` 把 `/data` 反代到线上服务器，
这样能在本地改前端代码、同时使用生产环境的完整数据量复现问题：

```bash
cd vis_web
WEATHER_REMOTE_DATA=https://nwp.gdmo.gq pnpm dev
```

设置该变量后 `localDataPlugin` 不再注册本地 `/data` 中间件，请求全部交给
`server.proxy` 转发。不设置则行为完全不变。

两点限制：

- Vite dev server 对浏览器是 **HTTP/1.1**，无法复现生产环境的 HTTP/2 多路复用行为。
  定位网络层问题时应直接用 Node 的 `http2` 客户端压测线上地址，而不是依赖 dev server。
- 该代理只影响 `/data`；`/api`（推送后端）仍按原有配置转发到本地 `127.0.0.1:49173`。

## 配置说明

### 数据服务器配置
项目默认连接到内部THREDDS数据服务器。如需修改数据源，请在相应的notebook中调整以下参数：

```python
# 在trough.ipynb中修改
baseUrl = 'http://10.148.8.71:7080/thredds/dodsC/{0}/'
source = 'ecmwfthin'
```

### 时间和空间范围
- **时间范围**: 可设置任意时间进行分析
- **空间范围**: 支持全球范围的数据处理
- **高度层**: 支持多个标准气压层（特别优化500hPa层）

### 生产环境的热/冷两级存储

生产服务器的 `/data` 整体挂载在 NFS 上。实测同一批 200 个文件：**NFS 冷读约 729 ms/文件、
暖读约 3 ms，本地 SSD 约 2 ms**。单次浏览会请求上万个各不相同的瓦片，冷读因此成为
「SVG 等待时间长」的直接原因（与 Service Worker、前端并发数、gzip 均无关）。

方案是近期数据放本地 SSD、更早的留在 NFS，由 nginx 按「先热后冷」查找：

| 层级 | 路径 | 内容 |
| --- | --- | --- |
| 热盘 | `/srv/weather/hot/data/` | 近 `WEATHER_HOT_RETENTION_DAYS` 天（默认 7 天） |
| 冷盘 | `/data/weather_vis/`（NFS） | 超过保留期的起报时次 |

`nginx_nwp.conf` 用 `try_files $uri @cold_*` 实现按**单个文件**粒度的回落，
前端 URL 不变，对客户端透明。冷盘 location 使用 `aio threads=weather_io`
把 NFS 的阻塞读移出 worker，避免拖慢热盘请求。

`src/archive_cold_data.py` 负责把超期时次从热盘迁到冷盘，已由 `src/draw_schedule.py`
每天定时调用（与 SVG 生成共用单 worker 线程池，二者不会并发抢 IO）：

```bash
# 手动执行；--dry-run 只打印计划不动文件
uv run python src/archive_cold_data.py \
  --hot-root /srv/weather/hot/data \
  --cold-root /data/weather_vis \
  --retention-days 7 --dry-run
```

迁移语义：用 `rsync --remove-source-files` 逐时次搬运，中断后重跑会继续未完成的部分；
冷盘已存在同名时次时按合并处理；无论是否超期都保留最新 2 个时次，避免与生成流水线竞争。

**本地开发不受影响**：`weather_common.default_output_root()` 在 Windows 仍返回 `./data`，
且 `--archive-cold-root` 默认为 `None`（归档关闭），需显式传参才启用。

完整的部署步骤、容量测算与回滚方案见 `handoff/hot-cold-storage-migration.md`。

## 槽线输出数据格式

`src/trough.py` 支持按起报时次、预报时效和气压层输出槽线图像与JSON数据。默认起报时次由 `calLatestBaseTime()` 按ECMWF发布时间计算；默认预报时效为 `000` 至 `240` 小时；默认气压层为 `200、500、850、925、950、1000 hPa`。

### 输出路径

- 图像文件：`data/{init_time}/trough_images/trough_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.png`
- JSON文件：`data/{init_time}/trough_data/trough_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.json`

例如：

```text
data/2024061412/trough_images/trough_2024061412_000_500hPa_ecmwf.png
data/2024061412/trough_data/trough_2024061412_000_500hPa_ecmwf.json
```

### JSON结构

每个JSON文件只保存一个 `init_time + fc_hour + target_lev` 的槽线结果。`trough_lines` 是槽线列表，每条槽线包含切变类型、原始点、平滑后点和诊断属性。

```json
{
  "init_time": "2024061412",
  "fc_hour": "000",
  "target_lev": 500,
  "source": "ecmwfthin",
  "units": {
    "target_lev": "hPa",
    "longitude": "degrees_east",
    "latitude": "degrees_north",
    "length": "degrees",
    "avg_vorticity": "1e-5 s^-1",
    "avg_wind_speed": "m/s",
    "angle": "degrees"
  },
  "config": {
    "interval_dis": 2.0,
    "length_min": 6,
    "smoothness": 6,
    "smooth_method": "bezier",
    "num_points": 100,
    "num_control_points": 5
  },
  "trough_lines": [
    {
      "shear_type": "shear_u_left",
      "label": "Shear U Left",
      "points": [
        {"lat": 31.5, "lon": 108.0}
      ],
      "smoothed_points": [
        {"lat": 31.6, "lon": 108.1}
      ],
      "attributes": {
        "region_box": {
          "min_lat": 30.0,
          "max_lat": 35.0,
          "min_lon": 105.0,
          "max_lon": 112.0
        },
        "length": 8.4,
        "avg_vorticity": 2.1,
        "avg_wind_speed": 11.7,
        "angle": 42.0
      },
      "line_id": 1
    }
  ]
}
```

字段说明：
- `init_time`：起报时次，格式为 `YYYYMMDDHH`。
- `fc_hour`：三位预报时效字符串，例如 `000`、`024`、`240`。
- `target_lev`：气压层，单位为 hPa。
- `source`：数据源，默认 `ecmwfthin`。
- `config`：本次槽线识别使用的主要参数。
- `shear_type`：槽线来源的切变类型，可能值为 `shear_u_left`、`shear_u_right`、`shear_v_up`、`shear_v_down`。
- `points`：过滤后的原始槽线点，按 `{lat, lon}` 存储。
- `smoothed_points`：图像中实际绘制的平滑槽线点，按 `{lat, lon}` 存储。
- `attributes.region_box`：槽线外接经纬度范围。
- `attributes.length`：槽线长度，当前按经纬度网格距离计算。
- `attributes.avg_vorticity`：槽线沿线平均涡度，单位见 `units`。
- `attributes.avg_wind_speed`：槽线沿线平均风速。
- `attributes.angle`：槽线弯折角度；无法计算时在JSON中为 `null`。
- `line_id`：当前文件内的槽线序号。

## 急流轴算法运行与输出数据格式

`src/jet.py` 支持按起报时次、预报时效和气压层输出急流轴图像与JSON数据。默认起报时次由 `calLatestBaseTime()` 按ECMWF发布时间计算；默认预报时效为 `000` 至 `240` 小时；默认气压层为 `200、500、850、925、950 hPa`。

算法流程主要包括：对 `uwnd`、`vwnd` 进行高斯平滑，计算风速，将风矢量旋转90度得到垂直方向，沿该方向计算风速平流，根据风速阈值和平流符号跨纬向变化提取急流轴点，随后连线、按局地风向调整线段方向，并使用样条平滑后输出。

### 运行命令

```bash
# 使用最新起报时次，处理默认预报时效和默认气压层
uv run python src/jet.py

# 指定起报时次
uv run python src/jet.py --init-time 2026062900

# 指定预报时效和气压层
uv run python src/jet.py --init-time 2026062900 --fc-hours 000 006 012 --target-levs 850 925

# 只生成JSON
uv run python src/jet.py --init-time 2026062900 --target-levs 850 --no-save-image

# 只运行识别和绘图，不写JSON
uv run python src/jet.py --init-time 2026062900 --target-levs 850 --no-save-json
```

常用参数：

- `--init-time 2026062900`：起报时次，格式为 `YYYYMMDDHH`；不传时自动计算最新ECMWF起报。
- `--fc-hours 000 006 012`：指定预报时效；默认处理内置的ECMWF常用时效清单。
- `--target-levs 850 925`：指定气压层，单位 hPa；默认处理 `200、500、850、925、950 hPa`。
- `--output-root data`：输出根目录。
- `--source ecmwfthin`：TDS数据源。
- `--no-save-image`：不保存PNG图像。
- `--no-save-json`：不保存JSON数据。
- `--stop-on-error`：任一时效或层次失败时立即停止；默认记录失败并继续后续任务。

### 输出路径

- 图像文件：`data/{init_time}/jet_images/jet_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.png`
- JSON文件：`data/{init_time}/jet_data/jet_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.json`

例如：

```text
data/2026062900/jet_images/jet_2026062900_000_850hPa_ecmwf.png
data/2026062900/jet_data/jet_2026062900_000_850hPa_ecmwf.json
```

### JSON结构

每个JSON文件只保存一个 `init_time + fc_hour + target_lev` 的急流轴结果。`jet_axis_lines` 是急流轴线列表，每条线包含原始点、平滑后点和沿线诊断属性。内部算法使用 `[lon, lat]` 点序，JSON统一输出为 `{lat, lon}`。

```json
{
  "init_time": "2026062900",
  "fc_hour": "000",
  "target_lev": 850,
  "source": "ecmwfthin",
  "units": {
    "target_lev": "hPa",
    "longitude": "degrees_east",
    "latitude": "degrees_north",
    "length": "degrees",
    "avg_wind_speed": "m/s",
    "max_wind_speed": "m/s"
  },
  "config": {
    "wind_smooth_sigma": 3,
    "speed_threshold": 4,
    "interval_dis": 2.0,
    "length_min": 5.0,
    "smoothness": 5,
    "barb_skip": 8,
    "figsize": [10, 8],
    "dpi": 150
  },
  "jet_axis_lines": [
    {
      "line_id": 1,
      "points": [
        {"lat": 28.0, "lon": 110.0}
      ],
      "smoothed_points": [
        {"lat": 28.1, "lon": 110.2}
      ],
      "attributes": {
        "region_box": {
          "min_lat": 26.5,
          "max_lat": 31.0,
          "min_lon": 108.0,
          "max_lon": 116.0
        },
        "length": 9.2,
        "avg_wind_speed": 12.8,
        "max_wind_speed": 18.4
      }
    }
  ]
}
```

字段说明：

- `init_time`：起报时次，格式为 `YYYYMMDDHH`。
- `fc_hour`：三位预报时效字符串，例如 `000`、`024`、`240`。
- `target_lev`：气压层，单位为 hPa。
- `source`：数据源，默认 `ecmwfthin`。
- `units`：主要数值字段单位说明。
- `config`：本次急流轴识别使用的主要参数。
- `jet_axis_lines`：急流轴线列表。
- `line_id`：当前文件内的急流轴线序号。
- `points`：连线后的原始急流轴点，按 `{lat, lon}` 存储。
- `smoothed_points`：图像中实际绘制的样条平滑点，按 `{lat, lon}` 存储。
- `attributes.region_box`：急流轴线外接经纬度范围。
- `attributes.length`：急流轴线长度，当前按经纬度网格距离计算。
- `attributes.avg_wind_speed`：急流轴线沿线平均风速。
- `attributes.max_wind_speed`：急流轴线沿线最大风速。

## 涡旋算法运行与输出数据格式

涡旋相关算法由三个可独立运行的脚本组成，推荐按以下顺序执行：

1. `src/vortex_center.py`：识别涡旋中心。
2. `src/vortex_warm_core.py`：基于850hPa中心结果识别暖心。
3. `src/vortex_tracker.py`：基于暖心结果追踪连续涡旋路径。

也可以直接使用总入口脚本一次执行三段流程：

```bash
uv run python src/vortex_workflow.py --init-time 2026062900
```

这套流程读取TDS NetCDF数据，不依赖 `ifs/` 目录中的GRIB、SQLite和文件清单流程。默认数据源为 `ecmwfthin`，默认区域为 `90-180E, 0-40N`，默认输出目录为 `data/{init_time}/vortex_*`。

`vortex_workflow.py` 会按时效逐个执行中心识别，并遵循增量更新规则：

- 如果某个 `vortex_center` JSON 已存在，中心识别会跳过该文件，并在终端打印跳过清单。
- 暖心识别只处理本次新生成的 `850hPa` 中心JSON。
- 如果暖心识别本次生成了新JSON，则追踪阶段会对本次请求范围内所有已具备 `center + warm_core` JSON 的时效重新追踪。
- 如果本次没有新生成暖心JSON，则跳过追踪，并在终端打印提示。

### 运行中心识别

```bash
uv run python src/vortex_center.py --init-time 2026062900 --save-json
```

常用参数：

- `--init-time 2026062900`：起报时次，格式为 `YYYYMMDDHH`；不传时使用 `calLatestBaseTime()` 自动计算。
- `--fc-hours 000 006 012`：指定预报时效；默认处理内置的ECMWF常用时效清单。
- `--levels 200 500 700 850 925 950`：指定识别气压层，单位 hPa。
- `--area 90 180 0 40`：指定区域，顺序为 `西 东 南 北`。
- `--source ecmwfthin`：TDS数据源。
- `--output-root data`：输出根目录。
- `--save-image`：额外输出PNG图像。
- `--no-save-json`：只运行识别，不写JSON。

中心识别输出路径：

```text
data/{init_time}/vortex_centers/vortex_center_{init_time}_{fc_hour}_{level}hPa.json
data/{init_time}/vortex_centers/vortex_center_{init_time}_{fc_hour}_{level}hPa.png
```

其中PNG只有传入 `--save-image` 时才会生成。

中心识别JSON为数组，每个元素表示一个涡旋候选中心：

```json
[
  {
    "model": "ecmwfthin",
    "init_time": "2026-06-29 00:00:00",
    "fore_time": "2026-06-29 06:00:00",
    "fc_hour": "006",
    "step": 6,
    "level": 850,
    "lat": 18.25,
    "lon": 128.5,
    "vort": 0.000052,
    "vmax": 23.4,
    "vmax_lat": 18.5,
    "vmax_lon": 128.75,
    "is_surface_center": 1,
    "surface_center_distance": 42.6
  }
]
```

字段说明：

- `model`：数据源，默认 `ecmwfthin`。
- `init_time`：起报时间，格式为 `YYYY-MM-DD HH:MM:SS`。
- `fore_time`：预报有效时间，格式为 `YYYY-MM-DD HH:MM:SS`。
- `fc_hour`：三位预报时效字符串，例如 `000`、`006`、`024`。
- `step`：数值型预报时效，单位小时。
- `level`：气压层，单位 hPa。
- `lat` / `lon`：涡旋中心纬度、经度。
- `vort`：中心附近相对涡度，单位 `s^-1`。
- `vmax`：850hPa结果中，中心100km内最大10m风速，单位 `m/s`；非850hPa层通常为 `null`。
- `vmax_lat` / `vmax_lon`：最大10m风速位置。
- `is_surface_center`：850hPa中心是否被200km内的10m风场中心校正，`1` 表示已校正，`0` 表示未校正。
- `surface_center_distance`：850hPa候选中心到最近10m风场中心的距离，单位 km。

### 运行暖心识别

暖心识别读取中心识别阶段的850hPa JSON：

```bash
uv run python src/vortex_warm_core.py --init-time 2026062900
```

常用参数：

- `--fc-hours 000 006 012`：只处理指定时效。
- `--area 90 180 0 40`：温度场读取区域。
- `--source ecmwfthin`：TDS数据源。
- `--output-root data`：输出根目录。
- `--warm-levels 200 300 400 500`：参与平均的温度层。

暖心识别输出路径：

```text
data/{init_time}/vortex_warm_core/vortex_warm_core_{init_time}_{fc_hour}_850hPa.json
```

暖心识别JSON同样为数组，保留中心识别字段，并增加暖心诊断字段：

```json
[
  {
    "model": "ecmwfthin",
    "init_time": "2026-06-29 00:00:00",
    "fore_time": "2026-06-29 06:00:00",
    "fc_hour": "006",
    "step": 6,
    "level": 850,
    "lat": 18.25,
    "lon": 128.5,
    "vort": 0.000052,
    "vmax": 23.4,
    "warm": true,
    "warm_core": true,
    "warm_slope": true,
    "max_temp": 266.2,
    "max_temp_lat": 18.75,
    "max_temp_lon": 128.25,
    "distance_to_max": 62.1,
    "center_temp": 265.9,
    "temp_north": 263.1,
    "temp_south": 264.0,
    "temp_east": 263.6,
    "temp_west": 263.8
  }
]
```

新增字段说明：

- `warm`：最终暖心判定，`warm_core` 和 `warm_slope` 同时为 `true` 时为 `true`。
- `warm_core`：中心附近5度范围内的平均温度最大点距离中心是否小于220km。
- `warm_slope`：中心温度是否高于东、西、南、北8度处温度。
- `max_temp`：中心附近5度范围内的最大平均温度，单位 K。
- `max_temp_lat` / `max_temp_lon`：最大平均温度点位置。
- `distance_to_max`：中心到最大平均温度点的距离，单位 km。
- `center_temp`：中心位置平均温度，单位 K。
- `temp_north` / `temp_south` / `temp_east` / `temp_west`：中心北、南、东、西8度处平均温度，单位 K。

### 运行涡旋追踪

追踪脚本读取暖心识别输出，只追踪850hPa和地面校正后的中心结果。运行前会检查指定起报和时效是否同时具备中心JSON和暖心JSON；空中心数组 `[]` 也视为数据已就绪，但缺文件或JSON读取失败会直接停止。

```bash
uv run python src/vortex_tracker.py --init-time 2026062900
```

常用参数：

- `--fc-hours 000 006 012 018 024`：指定参与追踪的时效。
- `--output-root data`：输出根目录。
- `--save-image`：额外输出暖心轨迹PNG。
- `--area 90 180 0 40`：轨迹图范围。

追踪输出路径：

```text
data/{init_time}/vortex_tracks/tc_tracking_results_processed_{init_time}.json
data/{init_time}/vortex_tracks/tc_tracking_plot_processed_{init_time}.png
```

其中PNG只有传入 `--save-image` 时才会生成。

追踪JSON结构：

```json
{
  "total_tracks": 1,
  "tracks": [
    {
      "model": "ecmwfthin",
      "init_time": "2026-06-29 00:00:00",
      "lon": 128.5,
      "lat": 18.25,
      "id": 1,
      "GZ_number": "2026062900_001",
      "seq_number": "001",
      "max_wind": 35.2,
      "warm": true,
      "track": [
        {
          "model": "ecmwfthin",
          "init_time": "2026-06-29 00:00:00",
          "fore_time": "2026-06-29 06:00:00",
          "fc_hour": "006",
          "step": 6,
          "level": 850,
          "lat": 18.25,
          "lon": 128.5,
          "vmax": 23.4,
          "warm": true
        }
      ]
    }
  ]
}
```

字段说明：

- `total_tracks`：输出轨迹数量。
- `tracks`：轨迹对象列表。
- `model`：数据源。
- `init_time`：轨迹起报时间。
- `lon` / `lat`：轨迹首点位置。
- `id`：追踪过程中分配的内部轨迹ID。
- `GZ_number`：按起报时次和强度排序生成的轨迹编号。
- `seq_number`：同一起报内的三位序号。
- `max_wind`：轨迹所有点中的最大 `vmax`，单位 `m/s`。
- `warm`：轨迹中任一点为暖心时，该轨迹为 `true`。
- `track`：轨迹点列表，点内字段来自暖心识别JSON，并保留 `fore_time`、`fc_hour`、`step`、`lat`、`lon`、`vmax`、`warm` 等关键字段。

### 推荐验证命令

修改涡旋相关代码后，建议至少运行：

```bash
uv run python -m py_compile src/vortex_common.py src/vortex_center.py src/vortex_warm_core.py src/vortex_tracker.py
uv run python -m unittest discover
```

如果TDS可访问，可用短时效子集做端到端检查：

```bash
uv run python src/vortex_center.py --init-time 2026062900 --fc-hours 000 006 --levels 850
uv run python src/vortex_warm_core.py --init-time 2026062900 --fc-hours 000 006
uv run python src/vortex_tracker.py --init-time 2026062900 --fc-hours 000 006
```

## 前端加速与实时推送子系统 (Service Worker + Web Push)

前端在 SVG 瓦片加载之上叠加了一层 Service Worker 缓存与后台预取，并配套一个独立的
Node 推送后端，用于在新起报时次就绪时通知用户、后台预热数据。该子系统与 Python 分析/
绘图流水线**完全解耦**，可独立启停。

### 组成

**前端（`vis_web/`）**

| 文件 | 作用 |
| --- | --- |
| `public/sw.js` | Service Worker：拦截 `/data/products` 下的 `.svg`（cache-first）与 `manifest.json`（network-first）；按用户所选瓦片层次分级预取（默认 z0 + z1），受 `navigator.storage` 配额软上限约束、可被新指令中断；内置 `push` / `notificationclick` 处理 |
| `src/utils/swClient.js` | 注册 SW、下发/取消预取、下发预取策略；非安全上下文自动降级 |
| `src/utils/initTime.js` | `calLatestBaseTime` / `recentInitTimes(2)`，供开页 catch-up 预取用 |
| `src/utils/prefetchOptions.js` | 预取策略（瓦片层次 / 要素 / 气压层）的本地存储 |
| `src/utils/pushClient.js` | Web Push 能力检测、通知授权、订阅/退订，与后端交换订阅信息 |
| `src/components/PushSubscribeButton.vue` | ControlRail 顶部的触发按钮 + 弹窗：订阅开关与预取策略设置（瓦片层次、预加载要素、气压层） |

`main.js` 在应用启动及标签页重新可见时，会预取最近两个起报时次（最新 + 上一时次）。

**推送后端（`server/`，Node + Express + `web-push`）**

| 文件 | 作用 |
| --- | --- |
| `config.js` | 路径与 VAPID 配置（env 覆盖，输出根逻辑与 `weather_common.default_output_root` 一致） |
| `subscriptionStore.js` | 订阅信息的 JSON 文件存储（按 endpoint 去重） |
| `pushSender.js` | `sendToAll` / `detectLatestInit` / `maybeNotifyNewInit`（按 init_time 去重、清理失效订阅） |
| `server.js` | Express 路由：`/api/push/vapid-public-key`、`/subscribe`、`/unsubscribe` |
| `pushSchedule.js` | 独立轮询脚本，默认每 30 分钟检查一次，发现新起报时次即推一次 |
| `generateVapidKeys.js` | 生成 VAPID 密钥对 |

### 前置条件

- **必须为安全上下文**：Service Worker、Push API、剪贴板 API 均只在 `https` 或
  `localhost` 下可用；用局域网 IP + HTTP 访问会自动降级为无 SW / 无推送（不报错）。
  本地开发请用 `http://localhost:5173`，生产使用 https。
- **客户端需能出外网**：Web Push 经浏览器厂商推送服务（Chrome→FCM、Firefox→Mozilla）
  投递，客户端须能连到该服务，否则收不到推送。
- Chrome 强制 `userVisibleOnly`：每条 push 必弹一条系统通知。后端只在**新起报时次**
  推一次（约每个 00/12 UTC 起报一次），噪音可控。

### 部署与运行

推送后端通过 `server/.env` 统一配置（`server.js` / `pushSchedule.js` / `generateVapidKeys.js`
均经 `config.js` 读取；pm2/shell 传入的同名变量优先于 `.env`）。

```bash
# 1. 配置 + 安装推送后端依赖
cd server
cp .env.example .env                 # 按需修改 WEATHER_VAPID_SUBJECT 等
pnpm install --prod                  # express, web-push, dotenv

# 2. 生成 VAPID 密钥（幂等，已存在则跳过；--force 可强制重生）
node generateVapidKeys.js            # 写出 <push_root>/vapid_keys.json

# 3. 本地联调
node server.js                       # 监听 127.0.0.1:49173（端口取自 .env 的 WEATHER_PUSH_PORT）
cd ../vis_web && pnpm dev            # http://localhost:5173，/api 经 vite proxy 转发到同一端口
```

**生产上线**：前端 `dist/` 在本地测试环境构建好后上传到服务器，
`start_weather_business_pm2.sh` **默认不再构建前端**，只校验 `vis_web/dist/` 是否就位、安装
推送后端依赖、幂等生成 VAPID 密钥，并用 PM2 拉起全部业务进程（含
`weather-push-server` / `weather-push-schedule`）。

```bash
# 本地测试环境：构建并上传前端产物
cd vis_web && pnpm build
rsync -a vis_web/dist/ user@server:/var/www/html/nwp_weather_system/vis_web/dist/

# 服务器：一键部署（如需在服务器本机构建前端，改用 BUILD_FRONTEND=1 ./start_weather_business_pm2.sh）
./start_weather_business_pm2.sh
```

生产环境已在 nginx（`nginx_nwp.conf`）的 `location /assets/` 之后内置该反向代理（端口须与
`server/.env` 的 `WEATHER_PUSH_PORT` 一致）：

```nginx
    # 与 server/.env 的 WEATHER_PUSH_PORT 保持一致
    location /api/ {
        proxy_pass http://127.0.0.1:49173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

健康检查：`GET /api/push/health` 返回 `{ ok, vapidConfigured, subscriptions }`。

### 相关环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `WEATHER_OUTPUT_ROOT` | 输出根目录（热盘） | Windows `./data`；PM2 部署 `/srv/weather/hot/data` |
| `WEATHER_PRODUCTS_ROOT` | SVG 产品根目录 | `<output_root>/products` |
| `WEATHER_COLD_ROOT` | 冷盘（NFS）根目录；**置空即禁用归档** | `/data/weather_vis` |
| `WEATHER_HOT_RETENTION_DAYS` | 热盘保留天数 | `7` |
| `WEATHER_PUSH_ROOT` | 推送状态（密钥/订阅/去重标记）目录 | `<output_root>/push` |
| `WEATHER_VAPID_SUBJECT` | VAPID 声明的 `sub`（`mailto:` 或 `https:`） | `mailto:admin@example.com` |
| `WEATHER_PUSH_PORT` | 订阅服务监听端口（须与 nginx 反代、vite dev proxy 一致） | `49173` |
| `WEATHER_REMOTE_DATA` | 开发用：把 `/data` 反代到该地址，不设则读本地 `./data` | 空 |

`WEATHER_OUTPUT_ROOT` 的默认值需区分两处：`weather_common.default_output_root()`
在 Linux 仍返回 `/data/weather_vis`（脚本单独运行时的兜底），而
`ecosystem.weather-business.config.js` 与 `start_weather_business_pm2.sh` 显式设为
`/srv/weather/hot/data`，即 PM2 部署时写热盘。

### 数据流

新起报时次生成 → `pushSchedule` 轮询发现 products 里最新 init 的 `manifest.json` 为新时次
→ `sendToAll({init_time})` → 浏览器推送服务唤醒 `sw.js` 的 `push` → 弹一条通知并预取该起报
（页面关闭也生效）。同一起报时次仅推一次（去重标记 `last_pushed.json`）。

### 验证

```bash
# 后端可启动 + 生成密钥
cd server && pnpm install && node generateVapidKeys.js && node server.js

# 前端可构建
cd vis_web && pnpm build

# 手动发一条测试推送（浏览器已订阅时应弹通知并触发预取）
cd server && node -e "import('./pushSender.js').then(m=>m.sendToAll({init_time:'2026062900'}).then(r=>console.log(r)))"
```

浏览器侧：`localhost` 打开后点右上角「订阅实时更新」→ 授权 → DevTools → Application →
Service Workers / Push 可见订阅，`<push_root>/subscriptions.json` 出现一条记录。

## 学术背景

本项目基于以下学术研究和技术文档：

1. **ECMWF热带气旋追踪算法**: 采用ECMWF官方的热带气旋识别和追踪方法
2. **跨机构算法比较**: 参考多个气象机构的算法优化策略
3. **相关文献**: 包含Schumacher等人的研究成果

## 许可证

本项目使用 [Mozilla Public License 2.0](LICENSE) 开源许可证。

## 贡献指南

欢迎为本项目贡献代码和改进建议：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 联系方式

如有问题或建议，请通过以下方式联系：

- 提交Issue
- 发起Pull Request
- 查阅项目文档

## 更新日志

### 2026-07（SVG 下载性能与存储分层）

- **定位并修复 SVG 加载慢的根因**：瓶颈是生产服务器 NFS 的冷文件读取（约 729 ms/文件，
  暖读 3 ms），而非此前怀疑的 Service Worker 拦截、前端并发数或 gzip。
  引入热/冷两级存储 + nginx 按文件回落，见「生产环境的热/冷两级存储」。
- **`vort_fill` 色阶大幅精简**：从「4 档蓝 + 85 档黄橙红」（89 档）改为
  「2 档蓝 + 6 档黄橙红」（8 档）。涡度场噪声大，色阶越密 `contourf` 产生的多边形碎片
  越多。同数据 A/B 实测单块瓦片 **67.64 MB → 7.40 MB（降 89%）**，渲染耗时
  4.11 s → 0.49 s。该图层原先占全部产品体积 60%、却仅占 3.8% 的请求量。
- **新增冷数据归档**：`src/archive_cold_data.py` + `src/draw_schedule.py` 定时调用。
- **新增远程数据调试**：`WEATHER_REMOTE_DATA=https://nwp.gdmo.gq pnpm dev`，
  见「前端开发与远程数据调试」。

### 早期

- **功能特性**: 槽线检测和台风定位双重功能
- **数据支持**: 全面支持多种气象要素的处理
- 支持ECMWF数据的实时处理和分析

---

*本项目致力于提供准确、高效的天气系统识别解决方案，为气象研究和业务应用提供有力支持。*

## TODO
1. 查看Yagi
2. 
