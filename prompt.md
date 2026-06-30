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