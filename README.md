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
│   └── ty-locator/
│       └── locator.ipynb         # 台风定位算法
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

`vortex_workflow.py` 会按时效逐个执行中心识别；只有已经成功产出850hPa中心JSON的时效才会进入暖心识别，只有已经成功产出暖心JSON的时效才会进入追踪，避免某个未来时效未更新时阻断全部流程。

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

- **最新版本**: 支持ECMWF数据的实时处理和分析
- **功能特性**: 槽线检测和台风定位双重功能
- **数据支持**: 全面支持多种气象要素的处理

---

*本项目致力于提供准确、高效的天气系统识别解决方案，为气象研究和业务应用提供有力支持。*

## TODO
1. 查看Yagi
2. 
