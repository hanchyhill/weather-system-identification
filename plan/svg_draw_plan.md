SVG绘图修改
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