## 修改trough.py 文件


1. 构建 get_multi_fc_trough_by_init_time 函数，输入指定初始时间，输出多个预报小时，各个层次的槽线数据。
2. main()中，负责调用 get_multi_fc_trough_by_init_time，并保存图像和槽线数据。
3. plot_trough_analysis 当中返回图像的句柄，以及槽线数据，不再plt.show()。
4. get_multi_fc_trough_by_init_time 当中，负责保存图像，把槽线数据转换成json文件，保存到本地。
5. 图像的保存路径为：./data/init_time/trough_images/trough_init_time_fc_hour_ecmwf.png，其中init_time为初始时间，fc_hour为预报小时
6. 槽线数据转换成json文件的保存路径为：./data/init_time/trough_data/trough_init_time_fc_hour_ecmwf.json，其中init_time为初始时间，fc_hour为预报小时.
7. 帮我确定json文件的格式，以及槽线数据的结构。
8. 可用的 fc_hour: timeStrList_ecmwfthin = ['000', '003', '006', '009', '012', '015', '018', '021', '024', '027', '030', '033', '036', '039', '042', '045', '048', '051', '054', '057', '060', '063', '066', '069', '072', '078',  '084',  '090',
               '096',  '102',  '108',  '114',  '120',  '126',  '132',  '138',  '144', '150', '156', '162', '168', '174', '180', '186', '192', '198', '204', '210', '216', '222', '228', '234', '240']
9. target_lev: target_lev_list = [200, 500, 850, 925, 950, 1000]
10. 把一些槽线参数抽出来，作为单独的配置项。


修改需求：
1.  默认调用最新的init_time
调用时，使用以下函数计算最新时次起报，并作为初始时间。
def calLatestBaseTime() -> str:
    '''
    计算最新时次起报
    :return baseTime YYYYMMDDHH
    '''
    utcnow = arrow.utcnow()
    hour = utcnow.hour
    # ECMWF 任务计划https://confluence.ecmwf.int/display/UDOC/Dissemination+schedule
    if(hour >= 7 and hour < 19):
        baseTime = f"{utcnow.format('YYYYMMDD')}00"  # 世界时7~19时用当天00时起报
    elif (hour >= 19):
        baseTime = f"{utcnow.format('YYYYMMDD')}12"  # 世界时19~00时用当天00时起报
    else:
        # 小于世界时7时用前一天12时起报
        baseTime = f"{utcnow.shift(days = -1).format('YYYYMMDD')}12"
    return baseTime

2. 添加只绘图或者只输出json文件的参数。


### 涡旋
目标：实现涡旋中心识别，暖心识别，涡旋追踪三个脚本。
参照目录 @ifs 中的文件，实现涡旋中心识别和追踪算法。修改如下：1. 先进行中心识别的图像绘制和数据输出，数据读取参照 trough.md 当中的内容。 涡旋识别的层次分别为 ，200hpa,500hpa,700hpa,850hpa,925hpa,950hpa 的。 以及地面u10m, v10m.
中心识别后，再进行暖心识别和涡旋追踪，以850hpa中心和地面u10m,v10m为追踪目标。中心追踪前，参考模式的可预报时效，保证所有预报时效都有数据后才开始追踪，注意预报时效间隔会变化，注意这方面的算法适配。
中心识别，暖心识别，和涡旋追踪，分开为三个独立脚本。

@ifs 目录中的各个文件：
01_ifs_glob_file_to_json.py（这个不需要）
扫描 IFS 的 u850/v850/10u/10v GRIB2 文件，按起报时间和预报时效配对，生成 ifs_uv850_wind_file_info_list.json。支持增量模式，默认跳过 06/18 起报，只处理 00/12。

02_ifs_json2sqlite.py（这个不需要）
把阶段 1 的 JSON 文件清单导入 SQLite：ifs_uv850_wind_data.db。核心作用是任务状态管理，记录每个风场文件是否已处理、失败原因、输出 JSON 路径等。

03_ifs_tc_locator_aifs_850fit_optimized.py（核心算法）
核心 TC 定位脚本。读取数据库中待处理的风场文件，加载 850hPa 风场和可选地面 10m 风场，通过风切变点、KDTree、DBSCAN、涡度阈值识别热带气旋中心，再用地面风场校正中心并计算最大风速。输出单时次 TC 定位 JSON。

04_delete_error_file_in_db.py（这个不需要）
数据清理工具。读取 SQLite 中 message 不为空的异常记录，从错误信息里解析文件路径并尝试删除异常文件，同时生成 delete_error_files_log_ifs.json 删除日志。

05_ifs_cal_warm_core_850.py（核心算法）
暖心识别脚本。读取阶段 3 的 TC 定位结果，再加载 IFS 的 t200/t300/t400/t500 温度场，计算平均温度场。判断两个条件：中心附近 5 度范围最大温度点是否距中心小于 220km，以及中心温度是否高于东西南北 8 度处温度。满足则标记 warm=True，输出带暖心字段的 TC JSON。

06_ifs_tc_tracker_warm_core_850.py（核心算法）
轨迹追踪脚本。读取带暖心标记的逐时次 TC 定位结果，把离散点连接成轨迹。追踪策略分三段：第一点用最近距离，第二点用前向移速预测，第三点以后用中央差预测；并限制跳跃距离。输出 tc_tracking_results_processed_YYYYMMDDHH.json，可选生成暖心轨迹图。

07_ifs_filter_warm_json.py（核心算法）
暖心轨迹过滤脚本。读取完整追踪结果，只保留 warm is True 的轨迹，并删除轨迹点中的 sectorList、bound 等冗余字段，写入 ifs_tc_track_warmcore_850hPa_mix_surface_onlywarm，供后续匹配使用。

08_ifs_same_tc_fit.py（这个不需要）
IFS 与 BST 最佳路径匹配脚本。读取暖心 IFS 轨迹和 CH2024BST.json，对每个 BST 台风在其生命周期前 15 天到结束时间内搜索 IFS 起报轨迹。匹配逻辑包括时间交集、Haversine 距离阈值、移向相似度、循环移位置换显著性检验、距离趋势过滤、最佳候选选择，并输出匹配 JSON、日志和可视化图。


u10m 和 v10m 的变量为地面要素，不包含层次信息。
'u10m':{
        'name':'u10m',
        'missing_value': -999.9,
        '_FillValue':  -999.9,
        'valid_min': -999.0,
        'standard_name': 'eastward_wind',
        'units': 'm/s',
        'long_name': 'u wind',
        'short_name': 'Uwnd',
    },
    'v10m':{
        'name':'v10m',
        'missing_value': -999.9,
        '_FillValue':  -999.9,
        'valid_min': -999.0,
        'standard_name': 'northward_wind',
        'units': 'm/s',
        'long_name': 'v wind',
        'short_name': 'Vwnd',
    }
读取方式类似如下，注意兼容现有的写法。
def readFromTDS(initTime: str = '2022031700', modelId: str = 'ecmwfthin', area: list = [105, 125, 15, 28]) -> dict:
    '''
    从TDS接口读取指定起报时间数据, 返回dataset
    :params initTime: 起报时间世界时YYYYMMDDHH
    :params modelId: 模式名
    :params area: 筛选区域[西, 东, 南, 北]
    :return dataset字典
    '''
    year = initTime[0:4]
    month = initTime[4:6]
    day = initTime[6:8]
    hour = initTime[8:10]
    selectedTime = '{0}-{1}-{2} {3}:00:00'.format(year, month, day, hour)
    baseUrl = 'http://10.148.8.71:7080/thredds/dodsC/{0}/'.format(modelId)
    url_td = baseUrl + f'{year}{month}/t2md.nc'
    url_t2m = baseUrl + f'{year}{month}/t2mm.nc'
    url_sst = baseUrl + f'{year}{month}/sstk.nc'
    url_u10m = baseUrl + f'{year}{month}/u10m.nc'
    url_v10m = baseUrl + f'{year}{month}/v10m.nc'
    try:
        dataSet_td = xr.open_dataset(url_td)
        dataSet_t2m = xr.open_dataset(url_t2m)
        dataSet_sst = xr.open_dataset(url_sst)
        dataSet_u10m = xr.open_dataset(url_u10m)
        dataSet_v10m = xr.open_dataset(url_v10m)
    except Exception as e:
        print('无法获取数据源')
        raise e
    # 根据模式选择合适的切片方向
    if modelId == 'ecmwf_s2d':
        # s2d 数据使用降序切片
        lat_slice = slice(area[3], area[2])  # slice(28, 15) 北→南
    else:
        # ecmwfthin 数据使用升序切片
        lat_slice = slice(area[2], area[3])  # slice(15, 28) 南→北

    lon_slice = slice(area[0], area[1])

    ds_td = dataSet_td.sel(time=selectedTime, level=0.0, lat=lat_slice, lon=lon_slice)
    ds_t2m = dataSet_t2m.sel(time=selectedTime, level=0.0, lat=lat_slice, lon=lon_slice)
    ds_sst = dataSet_sst.sel(time=selectedTime, level=0.0, lat=lat_slice, lon=lon_slice)
    ds_u10m = dataSet_u10m.sel(time=selectedTime, level=0.0, lat=lat_slice, lon=lon_slice)
    ds_v10m = dataSet_v10m.sel(time=selectedTime, level=0.0, lat=lat_slice, lon=lon_slice)

    # 统一排序：确保 lat 维度都是升序（南→北），增强兼容性
    ds_td = ds_td.sortby('lat')
    ds_t2m = ds_t2m.sortby('lat')
    ds_sst = ds_sst.sortby('lat')
    ds_u10m = ds_u10m.sortby('lat')
    ds_v10m = ds_v10m.sortby('lat')

    return {'td': ds_td, 't2m': ds_t2m, 'sst': ds_sst, 'u10m': ds_u10m, 'v10m': ds_v10m}

### web交互和使用python生成对应的SVG平面图。

参照 H:\github\javascript\nwp_views 中的代码，实现web交互和使用python生成对应的SVG平面图。
前端交互界面放在目录 @vis_web 中。
python 生成 SVG图像的脚本放在 @src\draw\ 目录中。
前端使用pnpm 安装和管理依赖，安装最新的库即可。
python使用 uv ，与本项目现有依赖共用，缺少的库自行使用uv安装。
python需要绘制的图有：
1. 200hPa, 500hPa, 850hPa, 925hPa, 950hPa 的位势高度(等值线)，风场(箭头)、风场(风向杆)、、风场(风速填色)、风场(流线)
2. 地面风场：u10m, v10m 的箭头，风向杆，风速填色，流线。
3. 新增在前端交互界面中，实现槽线数据的绘制功能。
4. 前端交互中，增加预报时次切换等功能。

- TODO  等人工确认：绘图细节，比如风向杆设置，风速填色设置，位势高度(等值线)设置等。
#### SVG绘图修改
1. 确认现有 @src\draw\generate_svg_layers.py 会绘制哪些图，确认一张图只绘制一种要素。

2. 添加以下变量的绘制：
    1. 各高度层的气温等值线图
    2. 各高度层的相对涡度填色图
    3. 地面层的海平面气压，mslp.

3. SVG绘图的颜色和属性相关设置，参考 [era5](demo/draw_era5_01.py) [era5_02](demo/draw_era5_02.py)
具体的：
    1. 500hPa及以上的层次(200hPa, 500hPa) 的风速填色，参考 @demo\draw_era5_02.py 当中的colordict_wind_high
    2. 500hPa以下层次(700,850,925,950,1000hPa. 10m风速) 的风速填色，参考 @demo\draw_era5_02.py 当中的colordict_wind
    3. 位势高度,500hPa层次的等值线加粗和填色，参考 @demo\draw_era5_01.py 当中对500hPa层次的等值线加粗和填色设置。
    4. 其他层次 位势高度(hght)的等值面间隔，参考 @demo\draw_era5_01.py 当中对其他层次 位势高度(hght)的等值面间隔设置。
    5. 所有层次的风向杆设置，参考 @demo\draw_era5_01.py 当中对所有层次的风向杆设置。
    6. 涡度的填色，参考 @demo\draw_era5_01.py 当中对涡度的填色设置colorArr_vort。
    7. 相对湿度的填色，参考 @demo\draw_era5_01.py 当中对相对湿度的填色设置colorArr_rhum。
    8. 温度色标， 参考 tempColorDict 当中的设置。

TDS数据当中，留意气温的单位是K. 需要在绘图中转换为℃。

4. TDS当中部分变量的属性如下：
    ## 各高度层的u风场
    'uwnd': {
        'name': 'uwnd',
        '_FillValue': -999.9,
        'valid_min': -999.9,
        'standard_name': 'eastward_wind',
        'units': 'm s**-1',
    },
    ## 各高度层的v风场
    'vwnd': {
        'name': 'vwnd',
        '_FillValue': -999.9,
        'valid_min': -999.9,
        'standard_name': 'northward_wind',
        'units': 'm s**-1',
    },
    ## 各高度层的位势高度
    'hght': {
        'name': 'hght',
        '_FillValue': -999.9,
        'valid_min': -1000.0,
        'standard_name': 'geopotential_height',
        'units': 'm',
    },
    ## 地面2米露点温度
    't2md': {
        'name': 't2md',
        '_FillValue': -999.9,
        'valid_min': 0.0,
        'standard_name': 'dew_point_temperature',
        'units': 'K',
        'long_name': 'dew point',
        'short_name': 'Td',
    },
    ## 地面2米气温
    't2mm': {
        'name': 't2mm',
        '_FillValue': -999.9,
        'valid_min': 0.0,
        'standard_name': 'air_temperature',
        'units': 'K',
        'long_name': 'air temperature in 2 metre',
        'short_name': 'T2m',
    },
    ## 各高度层相对湿度
    'rhum': {
        'name': 'rhum',
        '_FillValue': -999.9,
        'valid_min': 0.0,
        'standard_name': 'relative_humidity',
        'units': '0.01',
        'long_name': 'relative_humidity',
        'short_name': 'RH',
    },
    ## 各高度层气温
    'temp': {
        'name': 'temp',
        '_FillValue': -999.9,
        'valid_min': 0.0,
        'standard_name': 'air_temperature',
        'units': 'K',
        'long_name': 'air temperature',
        'short_name': 'Temp',
    },
    ## 海平面气压
    'mslp': {
        'name': 'mslp',
        '_FillValue': -999.9,
        'valid_min': 0.0,
        'standard_name': 'air_pressure_at_sea_level',
        'units': 'Pa',
        'long_name': 'air pressure at sea level',
        'short_name': 'MSLP',
    },

### 急流轴数据的实现

根据 @src\jet_v2.ipynb 中的代码，实现急流轴数据的实现。
最终急流轴数据以此参数为准：
```python
smoothness=5
lines_smooth = smooth_lines(adjusted_lines)
plot_lines_with_direction(lines_smooth, uwnd, vwnd, fill=False, same_color=True)
```
整体代码风格参考  @src\trough.py 中的代码，主要是把原本的槽线算法改为实现急流轴数据的生成和绘制。
与trough.py 共用的函数，可以抽离出来，作为公共函数库。

### 涡旋识别算法中，有新的涡旋中心定位数据时，再更新涡旋追踪数据。


### 瓦片

/plan SVG图像瓦片改造规划，帮我进一步补充一些细节
参照 @H:\github\javascript\nwp_views 实现SVG图像的瓦片式加载
1. 采用田字格瓦片的加载方式，每一级是上一级别瓦片大小的1/4
2. 最大范围的瓦片是60E-150E, 0-60N.
3. 瓦片层次分为3级，
4. 先改造 @src\draw\generate_svg_layers.py
5. 最后改造前端，实现不同放大等级，加载不同等级的瓦片

下面给出一个**3级四叉树瓦片方案**，适用于你当前的 SVG 天气图层生成逻辑。你上传的脚本目前已有 `Bounds(lon_min, lon_max, lat_min, lat_max)` 结构和 `--bounds` 参数，可直接把原来的默认范围改造成瓦片范围逐块生成。

## 1. 总体范围

最大范围：

```text
经度：60°E ~ 150°E
纬度：0°N ~ 60°N
```

范围宽度：

```text
Δlon = 90°
Δlat = 60°
```

采用四叉树田字格切分，每升一级：

```text
经向分辨率 × 2
纬向分辨率 × 2
单个瓦片面积 = 上一级的 1/4
```

建议定义 3 级为：

```text
z = 0, 1, 2
```

---

## 2. 各层级瓦片规模

| 层级 z |  瓦片行列 | 瓦片数量 | 单瓦片经度跨度 | 单瓦片纬度跨度 |
| ---- | ----: | ---: | ------: | ------: |
| z=0  | 1 × 1 |    1 |     90° |     60° |
| z=1  | 2 × 2 |    4 |     45° |     30° |
| z=2  | 4 × 4 |   16 |   22.5° |     15° |

总瓦片数：

```text
1 + 4 + 16 = 21 个
```

---

## 3. 推荐瓦片编号规则

采用常见地图瓦片格式：

```text
/{z}/{x}/{y}.svg
```

其中：

```text
z：层级
x：从西向东编号，0, 1, 2...
y：从北向南编号，0, 1, 2...
```

也就是：

```text
x 越大，经度越偏东
y 越大，纬度越偏南
```

---

## 4. 通用计算公式

对于第 `z` 级：

```python
n = 2 ** z
tile_lon_size = 90 / n
tile_lat_size = 60 / n
```

第 `z/x/y` 个瓦片的范围为：

```python
lon_min = 60 + x * tile_lon_size
lon_max = 60 + (x + 1) * tile_lon_size

lat_max = 60 - y * tile_lat_size
lat_min = 60 - (y + 1) * tile_lat_size
```

注意这里 `y=0` 表示最北侧第一行。

---

# 5. 具体瓦片范围

## z = 0

| 瓦片    | 经度范围     | 纬度范围   |
| ----- | -------- | ------ |
| 0/0/0 | 60E–150E | 0N–60N |

---

## z = 1

| 瓦片    | 经度范围      | 纬度范围    | 区域含义 |
| ----- | --------- | ------- | ---- |
| 1/0/0 | 60E–105E  | 30N–60N | 西北   |
| 1/1/0 | 105E–150E | 30N–60N | 东北   |
| 1/0/1 | 60E–105E  | 0N–30N  | 西南   |
| 1/1/1 | 105E–150E | 0N–30N  | 东南   |

---

## z = 2

| 瓦片    | 经度范围        | 纬度范围    |
| ----- | ----------- | ------- |
| 2/0/0 | 60E–82.5E   | 45N–60N |
| 2/1/0 | 82.5E–105E  | 45N–60N |
| 2/2/0 | 105E–127.5E | 45N–60N |
| 2/3/0 | 127.5E–150E | 45N–60N |
| 2/0/1 | 60E–82.5E   | 30N–45N |
| 2/1/1 | 82.5E–105E  | 30N–45N |
| 2/2/1 | 105E–127.5E | 30N–45N |
| 2/3/1 | 127.5E–150E | 30N–45N |
| 2/0/2 | 60E–82.5E   | 15N–30N |
| 2/1/2 | 82.5E–105E  | 15N–30N |
| 2/2/2 | 105E–127.5E | 15N–30N |
| 2/3/2 | 127.5E–150E | 15N–30N |
| 2/0/3 | 60E–82.5E   | 0N–15N  |
| 2/1/3 | 82.5E–105E  | 0N–15N  |
| 2/2/3 | 105E–127.5E | 0N–15N  |
| 2/3/3 | 127.5E–150E | 0N–15N  |

---

## 6. 建议的目录结构

你当前脚本已有类似：

```text
data/products/{init_time}/{fc_hour}/{level}/{layer_type}.svg
```

改造成瓦片后，建议扩展为：

```text
data/products/{init_time}/{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg
```

例如：

```text
data/products/2026070100/024/500/hght_contour/2/2/2.svg
data/products/2026070100/024/850/wind_speed_fill/1/1/1.svg
data/products/2026070100/024/surface/mslp_contour/0/0/0.svg
```

这样前端加载时可以按：

```text
init_time + fc_hour + level + layer_type + z/x/y
```

唯一定位一个 SVG 瓦片。

---

## 7. manifest 中建议增加的字段

建议在 `manifest.json` 中加入瓦片方案说明：

```json
{
  "tile_scheme": {
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
}
```

其中：

```text
origin = northwest
```

表示 `x=0,y=0` 是西北角瓦片。

---

## 8. 结论建议

最合理的 3 级方案是：

```text
z=0：整体图，60E–150E，0N–60N
z=1：2×2，单瓦片 45°×30°
z=2：4×4，单瓦片 22.5°×15°
```

这个方案有三个优点：

1. 四叉树结构清晰，前端按 `z/x/y` 加载简单；
2. 每一级严格满足“单瓦片面积为上一级 1/4”；
3. 与当前 SVG 按 `bounds` 裁剪生成的脚本结构兼容，只需要循环传入不同瓦片范围即可。

## SVG瓦片继续优化

1. @src\draw\svg_layer_config.py 按照不同z等级，不同高度层次，可进一步细分。按照默认样式，特定z等级，特定高度层次，可以设置不同的样式。默认加载默认样式，然后用特定瓦片等级样式，特定高度层样式进行覆盖。

## 前端瓦片预加载到indexedDB当中。
@vis_web\src\utils\indexedDBCache.js 
为了进一步加快瓦片加载速度，可以将瓦片预加载到indexedDB当中。
当前已经实现了加载过的瓦片保存到indexedDB当中。
目前用户最常用的操作是切换预报时效。因此可以在加载完毕当前预报时效的瓦片后，预加载瓦片加载到indexedDB当中。
规则如下：
1. 获取当前视窗下所需的要素，z等级，边界等，得到当前加载的svg图像。
2. 当前svg加载完毕后，启动预加载，先预加载下一个预报时效的svg图像，然后预加载上一个预报时效的svg图像,最后预加载下下个预报时效的svg图像，一共预加载3个预报时效。预加载之前，先判断indexedDB当中是否已经存在该瓦片，如果存在，则不预加载。
3. 修改indexedDB数据expires字段，设置为72小时。

## 填色图模糊问题


## 修改等值线图的线宽，在不同缩放倍数下，保持渲染出来的线宽相同。

## 绘图的风速异常问题，@src/draw/generate_svg_layers.py 当中，部分时效会把异常风速绘制出来，参照 @H:\github\weather-system-identification\src\vortex_common.py 对异常数据的检验。

## TODO

1. 涡旋中心算法实装[success]。
2. 涡旋追踪算法实装[success]。
3. 锋面识别算法探究[pending]。
4. 副热带高压脊线识别(上边界，下边界)[pending]。
5. web交互实装[in progress]。
6. 常用气象图的SVG导出[in progress]。[draw_img](src/draw/generate_svg_layers.py)
7. 急流轴实现[pending]。
8. ecmwf_s2d 数据兼容性方案。
9. 之前某次海雾个例分析中，有t-td的填色图，需要找到。
10. SVG瓦片的实现，前后端配合，不同缩放倍数实现加载不同分辨率的瓦片进行拼接展示。参照 H:\github\javascript\nwp_views 中的代码 需要修改的代码 @src\draw\generate_svg_layers.py 和前端代码 @vis_web 

## 绘图功能

在多时次选择器按钮下方，再增加一个绘图按钮，用来在地图上绘制常用图形：
点击按钮后弹窗绘图面板进入绘图模式，绘图模式时无法再进行地图平移操作，以避免操作冲突，可以选择以下几类图形进行绘制：
1. 几何图形类: 蓝色椭圆、红色椭圆、蓝色矩形、红色矩形、
2. 线类型：槽线(棕色曲线), 切变线(红色曲线，曲线的样式为双横线)，幅合线(黑色点画线，类似 -*-*-*- 这种曲线样式)， 红色曲线尾端带箭头、蓝色曲线尾端带箭头、冷锋、暖锋。
3. 文字类：红色的'L', 红色的'D', 蓝的'H', 蓝色的'G'
其中曲线可参考  @H:\github\gdmo-lab\src\views\GeoMap.vue curveCatmullRom 这类曲线, α=1
GeoMap.vue 当中也有暖锋的绘图示例。

进一步给出修改意见：1. 触发删除图形时，鼠标移动到图形上能高亮此图形(改变颜色)，这样用户才知道选中了此图形。 2. 在线类型之后，新增一类'标注类', 分别为 红色的'L', 红色的'D', 蓝的'H', 蓝色的'G'， 雷暴标记，台风标记(原有几何图形类中的台风标记删除)

## 选择要素选择器

在绘图按钮的下方，增加一个要素选择器按钮，用来快速选择各类气象要素的组合。
参照 @H:\github\gdmo-lab\src\views\OceanTyphoon.vue 当中的元素选择器，但要重新适配本项目。
1. 同样按照左侧为垂直层次要素选择器，右侧为其他类型的要素(跟层次无直接关联或者跟多个层次有关的要素)
2. 左侧垂直层次选择器，分别有以下几行: 200hPa, 500hPa, 700hPa, 850hPa, 925hPa, 950hPa, 1000hPa, 地面。 列的显示可以完全照搬 @H:\github\gdmo-lab\src\views\OceanTyphoon.vue，但是目前项目中没有那么多要素，没有的要素可以把对应的单元格留空。
3. 右侧单层要素选择器保持跟 @H:\github\gdmo-lab\src\views\OceanTyphoon.vue 一致，本项目没有的项目先留空，等以后补全。
4. 添加配置按钮和界面，可以让用户自由配置，包括各个元素的组合，然后把组合到底放在哪个单元格中，垂直层次列表也可以自定义增持层次，单层要素也可以自定义添加新的列表集合。

## 添加多地图模式。

参照 @demo\NWP helper in GuangDong.user.js 添加 多起报，多时效，多要素的多地图显示的模型。触发按钮放在要素选择器的下方，创建一个多图模型按钮，鼠标移入时自动弹出下级菜单 多起报，多时效，多要素，让用户选择。

继续优化多地图模式：
帮我优化多时效的界面
1. 多时效界面默认各子图的时效间隔是24小时，也可以选择6小时，48小时，或者根据有效连续时效变化。
2. 把以上做成一排按钮，放在 multi-map-header 内，同时再加一个左右按钮快速切换预报时效。
3. 这个左右按钮的原理是， 当前时效间隔*(子图数量+1): 比如时效间隔为6小时，则点就向右的按钮：6*4 = 24, 当然处在有效连续时效时需要特殊处理，连续时效时，向右按钮表示为第一张图变为最后一张图的index+1，依次类推。
4. 子图的数量可以变化，在 multi-map-header 内增加控制子图数量的按钮，可以选择 4,6,8,9,注意做到合理的排版布局。
5. 预报时效slider以第一张图的时效为准。如果其他子图的时间间隔处于无效的预报时效时，不再显示数据，给出该时效无效的显示效果。

-------------------------
在，map-workspace map-workspace-compact toolbar 当中 存在预报时效重复2次出现的显示冗余，去除掉，可以改为显示北京时 MM-DD HH BJT 这种格式。
在 map-workspace map-workspace-compact toolbar 当中加上预报时效，比如+12h这种格式，没叫你全部去掉，保留一个。

multi-map-workspace .multi-map-grid .toolbar 当中的font-size 从11px改为 28px

------------------------
多起报界面优化
1. 参照多时效界面，添加起报间隔选择：12小时间隔，24小时间隔。放在 multi-map-header 内
2. 参照多时效界面在 multi-map-header 内增加控制子图数量的按钮，可以选择 4,6,8,9,注意做到合理的排版布局。
3. 现在多起报显示的数据逻辑不对：以第一张子图的真实时间为基准，每个子图显示的都是一致的真实时间，但是预报时效不同。
比如第1张子图起报是7月10日12时，000时效;第2张子图则为起报是7月10日00时，012时效;第3张子图则为起报是7月09日12时，024时效;第4张子图则为起报是7月09日00时，036时效; 这样每张图显示的真实时间都是7月10日12时
---------------------
多要素界面优化：
1. 增加设置界面，可以设置每一张子图需要选择的要素配置，可以给配置命名，显示为配置1，配置2，配置3等等。
2. 添加保存当前要素要素配置按钮。
3. 设置按钮，保存配置，配置选择按钮等放在 multi-map-header 内。
4. 在 multi-map-header 内增加控制子图数量的按钮，可以选择 4,6,8,9,注意做到合理的排版布局
5. 把 @vis_web\src\components\ElementSelector.vue元素选择器的功能，搬到多要素功能，可以切换各个子图的要素，鼠标激活对应的子图，用元素选择器选择元素就能替换对应子图的元素。
----------------------
添加新功能：
@vis_web\src\components\MultiMapSelector.vue @vis_web\src\components\MultiMapWorkspace.vue @vis_web\src\composables\useWeatherView.js
多图模式增加 【多要素，多时效】 模式，每一行为每一个天气要素，每一列为逐个预报时效。 预报时效间隔参照【多时效】模式的设置。
预报时效slider 控制的是第一列的预报时效。
参照【多要素模式】可以设置各个子图的要素，鼠标激活对应的子图，用天气要素选择器选择要素就能替换对应子图的要素，可以保存配置，设置页面添加配置。默认显示3行的要素，分别是 "500hPa天气形势， 925hPa天气形势， 地面风羽"。

继续增加两个多图模式：
1. 【多起报，多时效】模式，其中起报为行，时效为列。同一列当中起报时次不同，但是真实时间相同。
2. 【多要素，多起报】模式，其中要素为行，起报为列。同一行当中要素不同，但是真实时间相同。

----------------------
绘图工具，增加一个标注类：红色的字母"N", 蓝色的字母"L"
L/H, D/G, N/L, 组合，左键为第一个字母，右键为第二个字母。

---------------------
@vis_web\src\components\MapWorkspace.vue
增加 截图功能。截图按钮放在#app section.map-workspace .toolbar 当中，放在右侧。
截图范围有2种选择：1. 截取当前地图的全部可视区域。 2. 截取指定范围区域。
截取后的行为：
1. 如果用户允许使用clipboard API，并且浏览器支持图片类的数据保存在剪贴板上，则将截图内容复制到剪贴板。
2. 如果浏览器不支持或者用户拒绝，则触发下载功能，下载截图内容到本地。
如果你需要额外三方库进行截图，请使用搜索功能进行查找，用 pnpm 进行添加安装。

-----------------------
/plan @vis_web\src\components\MultiMapWorkspace.vue 当前多图模式存在性能问题：
1. 加载多图时卡顿，延迟严重，需要加载很久才能获取到数据。
2. 当前的数据预加载功能在单图模型下运行良好，但是在多图模式下可能出现预加载冲突，导致缓慢，应该重新构建一个适合多图模式的预加载功能。
3. 多图模式下，由于画布大小变得更小，因此canvas渲染的分辨率可以重新设定，以降低渲染压力。
----------------------
1. 添加地理视图快速切换按钮，可以保存当前的中心经度纬度位置和放大倍数。 按钮 popover 一个已保存的视图列表，列表最下方增加保存当前视图。
这个按钮加到 绘图工具 按钮的下方，并且触发按钮的样式改为一个地球的图标。鼠标移入自动popover. 保存时弹窗让用户输入视图的命名。

2. @vis_web\src\components\PushSubscribeButton.vue 改造为全局设置按钮，弹窗中，添加一个配置备份的tab, 导入和导出配置按钮。可以导出和导入所有已经保存在浏览器中的配置。

---------------------
====================

高空槽绘制问题探究。
目前需要修改高空绘制的相关阈值，重点在槽线聚类合并的问题上，目前条件过于宽松，容易出现多个槽线被合并为同一个槽线的问题。
为了解决这个问题，根据 @src/trough.py 抽取出相关相关参数，形成一新的调试脚本 test_trough.py。只绘制我指定起报时次和预报时效。同时增加一个控制槽线最大长度的参数，如果合成出来的槽线太长，就选择原始点位之间间隙最大的地方断开。另外有一部分槽线过度弯曲，也需要修正弯曲参数，过于弯曲的要拆分成不同的槽线。

指定时次如下：
①起报时次2026072012，预报时效+36h
②起报时次2026072012，预报时效+42h

告诉我重点关注哪些参数。我会手动调整。同时绘制出对应的图像出来。

已完成高空槽调试脚本、拆线逻辑及指定时次绘图。生产配置默认未启用新阈值，不会改变现有批处理结果。

  主要文件：

  - 调参入口：src/test_trough.py:21
  - 最大长度及弯曲拆分实现：src/trough.py:314
  - 单元测试：tests/test_trough.py:1

  重点关注参数：

  1. interval_dis = 1.5
     最重要的聚类连接阈值。越小越不容易把两条槽线串起来；太小会造成槽线断裂。生产原值为 2.0。

  2. max_line_length = 25.0
     新增的最大累计长度，单位为经纬度度数。超过后递归从原始相邻点间隙最大的地方断开。越小拆分越积极。

  3. max_turn_angle = 70.0
     新增的局部最大转向角。0° 表示直行，数值越小，对弯曲越严格。

  4. turn_angle_window = 2
     计算转向角时向前、向后取多少个原始点。1 对局部锯齿很敏感；2～3 更稳定。

  5. length_min = 6.0
     拆线后也会重新应用。提高它可以去掉拆分产生的短碎线。

  6. angle_threshold = 90.0
     位于各 `shear_types)：19 条槽线脚
=========
解决 @vis_web\src\components\MultiMapWorkspace.vue 当中的性能问题。目前加载呈现出明显卡顿，一张图一张图得显示，不够流畅，分析可能的原因。 MultiMapWorkspace 加载图像时，sw.js的预加载功能会中断吗？

===========================
继续优化 @vis_web\src\components\MultiMapWorkspace.vue 的渲染性能，多图模式下，实际的canvas的大小要比单图模式下的更小，因此其动态分辨率设置不应该跟单图模型相同，应该设计一个根据canvas实际大小有关的渲染分辨率的方法。设计一个专门的多图模型的渲染方案，支持不同大小的canvas动态改变渲染分辨率，跟实际分辨率匹配，进一步提高渲染性能。

===============
天气系统的线宽，比如 槽线，急流的曲线时，应该在不同放大倍数z下，保持视觉上的同意。目前放大倍数很大时，会变得很宽。

======================
web_push 从来没有生效过

=====================
@src\draw\generate_svg_layers.py 添加降水要素的绘制
分别绘制24小时累积降水，6小时累积降水，3小时累积降水。采用contourf填色。
色标参考 @demo\draw_era5_02.py 当中的 colordict_r24， colordict_r1
其中 24小时累积降水使用 colordict_r24 norms_r24
6小时累积降水，3小时累积降水 使用 colordict_r1 norms_r1

降水的变量名为 tppm， 其含义是累积降水量，从0起报时次开始的累积降水量。
因此计算24，6，3小时累积降水量时，需要两个端点时次相减才能得到。
同时，由于预报时效的间隔限制，部分时效是无法计算得到数据的，主要是后期时间间隔变为6小时，以及最前面几个时次无法计算累积量，需要你去考虑。

=====================
参照 @src\test_trough.py， 我现在需要调试 @@src\draw\generate_svg_layers.py  当中的涡度图的绘制。
主要问题是涡度图的色标设置不合理，请帮我单独抽出涡度绘制的脚本部分，并且指定500hPa, 起报时间为 2026072612，把色标填色有关的属性放置到脚本前面，方便我手动调试参数。
======================
@vis_web\src\components\MapWorkspace.vue 前端增加色标显示：
如果是有填色的图像，在地图右下角显示色标，色标可进行折叠进行显示或者隐藏。 在 @vis_web\src\components\MultiMapWorkspace.vue 不需要显示色标。
色标可参考 @src\draw\generate_svg_layers.py 具体执行流程
================
@vis_web\src\components\MapWorkspace.vue 地图左边缘增加层次快速切换功能：
1. 按照 200hPa, 500hPa, 700hPa, 850hPa, 925hPa, 950hPa, 1000hPa, 地面 的顺序，增加快速切换滑块，滑块处同时支持鼠标滚轮操作，鼠标向前滚动为更高层次(更低气压层次)，向下滚动为更低层次(更高气压层次)，滑块处显示当前层次的名称。
===============
@vis_web\src\components\MultiMapWorkspace.vue 改造
把 @vis_web\src\components\MapWorkspace.vue 当中的 `多时次选择器`，`天气要素选择器`，`地理视图`，`多图模式`，`绘图工具`等功能，搬到 @vis_web\src\components\MultiMapWorkspace.vue 当中，并且支持多图模式。
不同多图模型可以有不同的交互效果。
具体要求如下：
1. 还是维持悬浮在左侧位置。
2. `多起报`模式中， `多时次选择器`以第一张图为基准，`多图模式`的切换以第一张图为基准进行切换。
3. `多时效`模式中，`多时次选择器`以第一张图为基准，`多图模式`的切换以第一张图为基准进行切换。
4. `多要素`模式中，`多时次选择器`控制的是第一张图，`多图模式`的切换以第一张图为基准进行切换。`天气要素选择器`以当前选中的子图为准，跟现有的天气要素选择器功能保持一致，去除掉原有的天气要素选择器，因为功能重复。
5. `多要素，多时效`模式中，`多时次选择器`控制的是第一张图，`多图模式`的切换以第一张图为基准进行切换。`天气要素选择器`以当前选中的子图为准，跟现有的天气要素选择器功能保持一致，去除掉原有的天气要素选择器，因为功能重复。
6. `多起报，多时效`模式中，`多时次选择器`控制的是第一张图，`多图模式`的切换以第一张图为基准进行切换。
7. `多要素，多起报`模式中，`多时次选择器`控制的是第一张图，`多图模式`的切换以第一张图为基准进行切换。`天气要素选择器`以当前选中的子图为准，跟现有的天气要素选择器功能保持一致，去除掉原有的天气要素选择器，因为功能重复。
8. `多图模式`切换时，与现有的地图放大倍数和中心位置保持一致，比如从 MapWorkspace.vue 切换到多图模式时，继承 MapWorkspace.vue 当中的放大倍数和地图中心坐标位置。 从一种多图模式切换到另外一种多图模式时，也继承第一张子图的放大倍数和地图中心坐标位置

============
把 @vis_web\src\components\ControlRail.vue 当中的init-time-control 的功能，移植到 @vis_web\src\components\MapWorkspace.vue 的toolbar 当中。并增加以下行为：
切换起报时次时，保持真实时间一致。比如当前起报时次是 2026年7月28日12时 UTC, 预报时效 72h, 当切换到起报时次是 2026年7月28日00时 UTC， 预报时效对应增加12个小时，变为 84h， 这样保持真实时间一致。如果切换起报时次后没有对应完全一致的真实时间，则保持相同预报时效即可。
===================

/goal 增加多屏模式的独立视窗功能，右键单击多图模式当中的相关按钮，把多图模式 @vis_web\src\components\MultiMapWorkspace.vue 当中的内容，作为一个独立弹窗出现，方便拥有两个显示器的用户查看内容。 同时在主视图 @MapWorkspace.vue 当中的操作，能够联动到 多图模式的独立弹窗当中，比如预报时效切换，要素切换等，实现窗口联动。