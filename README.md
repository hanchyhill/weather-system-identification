# 天气系统识别项目 (Weather System Identification)

## 项目概述

本项目致力于天气系统的自动识别和分析，特别专注于热带气旋（台风）的追踪和槽线系统的检测。项目基于ECMWF（欧洲中期天气预报中心）的高质量气象数据，使用先进的数值分析方法进行天气系统识别。

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

### 数据处理能力
- 支持多种气象要素：温度、湿度、风速、位势高度、海平面气压
- 支持多高度层数据处理（特别是500hPa）
- 实时数据处理和分析

## 项目结构

```
weather-system-identification/
├── src/
│   ├── trough.ipynb              # 槽线检测算法
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
pip install xarray metpy cartopy matplotlib numpy pint arrow
```

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
