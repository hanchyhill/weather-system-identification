# 涡旋中心、暖心与追踪脚本实现计划

## Summary

- 新增 3 个可独立运行脚本：`src/vortex_center.py`、`src/vortex_warm_core.py`、`src/vortex_tracker.py`。
- 新增共享工具模块 `src/vortex_common.py`，放 TDS 读取、时间/时效、JSON、距离计算、字段兼容等通用逻辑。
- 默认数据范围使用 `60-150E, 0-60N`；默认输出使用 `data/{init_time}/vortex_*`。
- 不沿用 `ifs` 的 GRIB/SQLite 流程，只复用核心算法思想。

## Key Changes

### 中心识别

- 读取 TDS NetCDF，兼容 `trough.py` 现有 `uwnd{fc}`/`vwnd{fc}` 写法。
- 识别层次为 `200, 500, 700, 850, 925, 950 hPa`，另读取地面 `u10m/v10m`，地面变量不带层次语义。
- 每个 `init_time + fc_hour + level` 输出 JSON 和可选 PNG。
- 850hPa 中心用地面 10m 风场候选中心做 200km 内校正，并计算 100km 内最大地面风速。
- 算法采用 `ifs/03` 的风切变点、KDTree、DBSCAN、涡度阈值 `3.5e-5 s^-1` 思路；补充 `scikit-learn` 依赖。

### 暖心识别

- 输入中心识别输出中的 850hPa 混合地面中心结果。
- 通过 TDS 读取 `temp.nc` 的 `200, 300, 400, 500 hPa`，按同一 `init_time/fc_hour` 计算平均温度场。
- 判据沿用 `ifs/05`：5 度范围内最大温度点距中心 `<220km`，且中心温度高于东/西/南/北 8 度处温度。
- 输出带 `warm`, `warm_core`, `warm_slope`, `max_temp`, `distance_to_max`, `center_temp`, `temp_north/south/east/west` 的 JSON。

### 涡旋追踪

- 输入暖心识别后的逐时效 JSON，只追踪 850hPa + 地面校正结果。
- 追踪前读取该起报的可预报时效清单，确认每个时效都有中心识别和暖心 JSON；空中心 JSON 算作数据已就绪，读取失败/缺文件则不开始追踪。
- 按实际相邻 `fore_time` 计算时效间隔，适配 3h 到 6h 等变化。
- 追踪策略沿用 `ifs/06`：首点最近距离，第二点前向移速预测，第三点后中央差预测；单次跳跃上限 `1000km`。
- 输出 `data/{init_time}/vortex_tracks/tc_tracking_results_processed_{init_time}.json`，可选输出暖心轨迹图。

## Interfaces

- `python src/vortex_center.py --init-time 2026062900 --save-image --save-json`
  - 默认 `init_time=calLatestBaseTime()`。
  - 参数包含 `--fc-hours`, `--levels`, `--area 90 180 0 40`, `--source ecmwfthin`, `--output-root data`。
- `python src/vortex_warm_core.py --init-time 2026062900`
  - 读取 `data/{init_time}/vortex_centers`，输出 `data/{init_time}/vortex_warm_core`。
- `python src/vortex_tracker.py --init-time 2026062900 --save-image`
  - 读取 `data/{init_time}/vortex_warm_core`，输出 `data/{init_time}/vortex_tracks`。
- 输出 JSON 时间字段统一为：
  - `init_time`: `"YYYY-MM-DD HH:MM:SS"`
  - `fore_time`: `"YYYY-MM-DD HH:MM:SS"`
  - `fc_hour`: 三位字符串
  - `step`: 数值小时

## Test Plan

- 运行语法检查：
  - `uv run python -m py_compile src/vortex_common.py src/vortex_center.py src/vortex_warm_core.py src/vortex_tracker.py`
- 添加小型单元测试：
  - 时效格式化和实际 `fore_time` 间隔计算。
  - Haversine 距离、预测位置、跳跃上限。
  - 缺失某个时效 JSON 时追踪不启动。
- 有 TDS 可访问时，用一个起报和短时效子集验收：
  - 中心识别生成 PNG/JSON。
  - 暖心脚本能读取中心 JSON 并补充暖心字段。
  - 追踪脚本在所有时效齐全后生成轨迹 JSON。

## Assumptions

- 默认区域锁定为 `90-180E, 0-40N`。
- 默认输出目录锁定为 `data/{init_time}/vortex_*`。
- `temp.nc`, `uwnd.nc`, `vwnd.nc`, `u10m.nc`, `v10m.nc` 的 TDS 路径与 `trough.py` 使用的 `base_url_template` 规则一致。
- 不实现 `ifs` 的 JSON 扫描、SQLite 状态库、错误文件删除、BST 匹配流程。

## 参考脚本

@ifs 目录中的相关算法做参考：
03_ifs_tc_locator_aifs_850fit_optimized.py（核心算法）
核心 TC 定位脚本。读取数据库中待处理的风场文件，加载 850hPa 风场和可选地面 10m 风场，通过风切变点、KDTree、DBSCAN、涡度阈值识别热带气旋中心，再用地面风场校正中心并计算最大风速。输出单时次 TC 定位 JSON。

05_ifs_cal_warm_core_850.py（核心算法）
暖心识别脚本。读取阶段 3 的 TC 定位结果，再加载 IFS 的 t200/t300/t400/t500 温度场，计算平均温度场。判断两个条件：中心附近 5 度范围最大温度点是否距中心小于 220km，以及中心温度是否高于东西南北 8 度处温度。满足则标记 warm=True，输出带暖心字段的 TC JSON。

06_ifs_tc_tracker_warm_core_850.py（核心算法）
轨迹追踪脚本。读取带暖心标记的逐时次 TC 定位结果，把离散点连接成轨迹。追踪策略分三段：第一点用最近距离，第二点用前向移速预测，第三点以后用中央差预测；并限制跳跃距离。输出 tc_tracking_results_processed_YYYYMMDDHH.json，可选生成暖心轨迹图。

07_ifs_filter_warm_json.py（核心算法）
暖心轨迹过滤脚本。读取完整追踪结果，只保留 warm is True 的轨迹，并删除轨迹点中的 sectorList、bound 等冗余字段，写入 ifs_tc_track_warmcore_850hPa_mix_surface_onlywarm，供后续匹配使用。

@src\trough.py 中的数据读取方式参考。

不带层次的u10m, v10m 的变量，读取方式类似如下，注意兼容现有的写法：
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