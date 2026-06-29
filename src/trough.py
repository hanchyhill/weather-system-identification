import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr
import metpy.calc as mpcalc
from metpy.units import units
import pandas as pd
from scipy.spatial import distance
from scipy.interpolate import splprep, splev
import scipy.special


def load_weather_data(init_time, fc_hour=0, source='ecmwf_fine_his', base_url_template='http://10.148.8.71:7080/thredds/dodsC/{0}/'):
    """
    加载气象数据

    参数:
    - init_time: str, 初始时间,格式为'YYYYMMDDHH'
    - fc_hour: int, 预报小时,默认为0
    - source: str, 数据源,默认为'ecmwf_fine_his'
    - base_url_template: str, 基础URL模板

    返回:
    - data_dict: dict, 包含以下键值对:
        - 'uwnd': 经向风速数据
        - 'vwnd': 纬向风速数据
        - 'temp': 温度数据
        - 'hght': 位势高度数据
        - 'rhum': 相对湿度数据
        - 'spre': 地面气压数据
        - 'latitude': 纬度数组
        - 'longitude': 经度数组
        - 'grid_unit': 网格单位
    """
    year = init_time[0:4]
    month = init_time[4:6]
    day = init_time[6:8]
    hour = init_time[8:10]

    base_url = base_url_template.format(source)

    # 构建URLs
    url_rhum = base_url + '{0}{1}/rhum.nc'.format(year, month)
    url_vector_x = base_url + '{0}{1}/uwnd.nc'.format(year, month)
    url_vector_y = base_url + '{0}{1}/vwnd.nc'.format(year, month)
    url_temp = base_url + '{0}{1}/temp.nc'.format(year, month)
    url_hght = base_url + '{0}{1}/hght.nc'.format(year, month)
    url_spre = base_url + '{0}{1}/spre.nc'.format(year, month)

    # 打开数据集
    dataset_rhum = xr.open_dataset(url_rhum)
    dataset_vec_x = xr.open_dataset(url_vector_x)
    dataset_vec_y = xr.open_dataset(url_vector_y)
    dataset_temp = xr.open_dataset(url_temp)
    dataset_hght = xr.open_dataset(url_hght)
    dataset_spre = xr.open_dataset(url_spre)

    # 构建变量名
    selected_time = '{0}-{1}-{2} {3}:00:00'.format(year, month, day, hour)
    fc_str = '{:0>3d}'.format(fc_hour)
    rhum_var_name = 'rhum{}'.format(fc_str)
    vector_x_var_name = 'uwnd{}'.format(fc_str)
    vector_y_var_name = 'vwnd{}'.format(fc_str)
    temp_var_name = 'temp{}'.format(fc_str)
    hght_var_name = 'hght{}'.format(fc_str)
    spre_var_name = 'spre{}'.format(fc_str)

    # 提取数据
    target_lev = 500
    rhum = dataset_rhum[rhum_var_name].sel(time=selected_time, level=target_lev).to_dataset(name=rhum_var_name)
    uwnd = dataset_vec_x[vector_x_var_name].sel(time=selected_time, level=target_lev).to_dataset(name=vector_x_var_name)
    vwnd = dataset_vec_y[vector_y_var_name].sel(time=selected_time, level=target_lev).to_dataset(name=vector_y_var_name)
    temp = dataset_temp[temp_var_name].sel(time=selected_time, level=target_lev).to_dataset(name=temp_var_name)
    hght = dataset_hght[hght_var_name].sel(time=selected_time, level=target_lev).to_dataset(name=hght_var_name)
    spre = dataset_spre[spre_var_name].sel(time=selected_time, level=0.0).to_dataset(name=spre_var_name)

    # 解析CF元数据
    rhum = rhum.metpy.parse_cf(varname=rhum_var_name)
    uwnd = uwnd.metpy.parse_cf(varname=vector_x_var_name)
    vwnd = vwnd.metpy.parse_cf(varname=vector_y_var_name)
    temp = temp.metpy.parse_cf(varname=temp_var_name)
    hght = hght.metpy.parse_cf(varname=hght_var_name)
    spre = spre.metpy.parse_cf(varname=spre_var_name)

    # 提取经纬度信息
    latitude = uwnd.lat
    longitude = uwnd.lon
    grid_unit = (longitude[1] - longitude[0]).item()

    return {
        'uwnd': uwnd,
        'vwnd': vwnd,
        'temp': temp,
        'hght': hght,
        'rhum': rhum,
        'spre': spre,
        'latitude': latitude,
        'longitude': longitude,
        'grid_unit': grid_unit
    }


def calculate_shear_points(uwnd, vwnd, latitude, longitude, grid_unit):
    """
    计算风切变点

    参数:
    - uwnd: xarray.Dataset, 经向风速数据
    - vwnd: xarray.Dataset, 纬向风速数据
    - latitude: xarray.DataArray, 纬度数组
    - longitude: xarray.DataArray, 经度数组
    - grid_unit: float, 网格单位

    返回:
    - dict: 包含四种切变点数组
        - 'shear_u_left': vwnd <= 0的u方向切变点
        - 'shear_u_right': vwnd > 0的u方向切变点
        - 'shear_v_up': uwnd >= 0的v方向切变点
        - 'shear_v_down': uwnd < 0的v方向切变点
    """
    # 1. 通过uwnd计算风速从南到北由正值转变为负值所对应的位置
    sign_change_u = np.diff(np.sign(uwnd), axis=0)
    shear_u_index = np.where(sign_change_u < 0)

    # 2. 通过vwnd计算风速从西到东由负值转变为正值所对应的位置
    sign_change_v = np.diff(np.sign(vwnd), axis=1)
    shear_v_index = np.where(sign_change_v > 0)

    # 根据索引值从经纬度数组中获取切变位置
    shear_u_latitude = latitude[shear_u_index[0]] + grid_unit / 2.0
    shear_u_longitude = longitude[shear_u_index[1]]
    shear_u = np.vstack([shear_u_latitude, shear_u_longitude]).T

    shear_v_latitude = latitude[shear_v_index[0]]
    shear_v_longitude = longitude[shear_v_index[1]] + grid_unit / 2.0
    shear_v = np.vstack([shear_v_latitude, shear_v_longitude]).T

    # 拆分shear_u为shear_u_left和shear_u_right
    shear_u_left_mask = []
    shear_u_right_mask = []

    for i in range(len(shear_u)):
        lat_idx = shear_u_index[0][i]
        lon_idx = shear_u_index[1][i]
        vwnd_value = vwnd.values[lat_idx, lon_idx]
        if vwnd_value <= 0:
            shear_u_left_mask.append(True)
            shear_u_right_mask.append(False)
        else:
            shear_u_left_mask.append(False)
            shear_u_right_mask.append(True)

    shear_u_left = shear_u[shear_u_left_mask]
    shear_u_right = shear_u[shear_u_right_mask]

    # 拆分shear_v为shear_v_up和shear_v_down
    shear_v_up_mask = []
    shear_v_down_mask = []

    for i in range(len(shear_v)):
        lat_idx = shear_v_index[0][i]
        lon_idx = shear_v_index[1][i]
        uwnd_value = uwnd.values[lat_idx, lon_idx]
        if uwnd_value >= 0:
            shear_v_up_mask.append(True)
            shear_v_down_mask.append(False)
        else:
            shear_v_up_mask.append(False)
            shear_v_down_mask.append(True)

    shear_v_up = shear_v[shear_v_up_mask]
    shear_v_down = shear_v[shear_v_down_mask]

    return {
        'shear_u_left': shear_u_left,
        'shear_u_right': shear_u_right,
        'shear_v_up': shear_v_up,
        'shear_v_down': shear_v_down
    }


def form_lines(points, interval_dis, length_min):
    """
    将切变点连接成线段

    参数:
    - points: numpy.ndarray, 切变点数组
    - interval_dis: float, 连接阈值距离
    - length_min: float, 最小线段长度

    返回:
    - list: 线段列表,每条线段是点的列表
    """
    num_points = len(points)
    visited = np.zeros(num_points, dtype=bool)
    lines = []

    for i in range(num_points):
        if visited[i]:
            continue

        current_line = [points[i]]
        visited[i] = True

        while True:
            dists = distance.cdist([current_line[-1]], points[~visited], metric='euclidean')
            unvisited_indices = np.where(~visited)[0]

            if len(dists[0]) == 0:
                break
            min_dist_idx = np.argmin(dists[0])
            min_dist = dists[0][min_dist_idx]

            if min_dist < interval_dis:
                current_line.append(points[unvisited_indices[min_dist_idx]])
                visited[unvisited_indices[min_dist_idx]] = True
            else:
                break

        total_length = sum(
            np.linalg.norm(np.array(current_line[i]) - np.array(current_line[i+1]))
            for i in range(len(current_line) - 1)
        )

        if total_length > length_min:
            lines.append(current_line)

    return lines


def smooth_lines(lines, smoothness=0.5):
    """
    使用样条插值平滑线段

    参数:
    - lines: list, 线段列表
    - smoothness: float, 平滑参数

    返回:
    - list: 平滑后的线段列表
    """
    smoothed_lines = []
    for line in lines:
        line = np.array(line)
        if len(line) > 2:
            tck, u = splprep([line[:, 0], line[:, 1]], s=smoothness)
            u_new = np.linspace(0, 1, 100)
            smoothed_points = np.array(splev(u_new, tck)).T
            smoothed_lines.append(smoothed_points)
        else:
            smoothed_lines.append(line)
    return smoothed_lines


def smooth_lines_bezier(lines, num_points=100, num_control_points=None):
    """
    使用Bezier曲线平滑线段

    参数:
    - lines: list, 线段列表
    - num_points: int, 平滑后每条线的点数
    - num_control_points: int或None, 贝塞尔曲线的控制点数量

    返回:
    - list: 平滑后的线段列表
    """
    def bezier_curve(points, t):
        n = len(points) - 1
        return sum(
            scipy.special.comb(n, i) * (1 - t)**(n - i) * t**i * np.array(points[i])
            for i in range(n + 1)
        )

    smoothed_lines = []
    t_values = np.linspace(0, 1, num_points)

    for line in lines:
        if len(line) > 2:
            if num_control_points is not None and num_control_points < len(line):
                num_control_points = max(2, num_control_points)
                indices = np.linspace(0, len(line) - 1, num_control_points, dtype=int)
                control_points = [line[i] for i in indices]
            else:
                control_points = line

            smoothed_lines.append([bezier_curve(control_points, t) for t in t_values])
        else:
            smoothed_lines.append(line)

    return smoothed_lines


def add_meteorological_attributes(lines, u10, v10):
    """
    为槽线添加气象相关属性

    参数:
    - lines: list, 槽线的点集合
    - u10, v10: xarray.Dataset或xarray.DataArray, 10米风速的经向和纬向分量

    返回:
    - list: 每条槽线和对应的属性
    """
    if isinstance(u10, xr.Dataset):
        u10 = u10[list(u10.data_vars)[0]]
    if isinstance(v10, xr.Dataset):
        v10 = v10[list(v10.data_vars)[0]]

    if not hasattr(u10.data, 'units'):
        u10 = u10 * units('m/s')
    if not hasattr(v10.data, 'units'):
        v10 = v10 * units('m/s')

    vorticity = mpcalc.vorticity(u10, v10) * 1e5
    result = []

    for line in lines:
        line = np.array(line)
        lats, lons = line[:, 0], line[:, 1]

        region_box = {
            "min_lat": lats.min(),
            "max_lat": lats.max(),
            "min_lon": lons.min(),
            "max_lon": lons.max()
        }

        length = np.sum(
            np.sqrt(
                (np.diff(lats) ** 2) + (np.diff(lons) ** 2)
            )
        )

        avg_vorticity = []
        for lat, lon in zip(lats, lons):
            vort_val = vorticity.sel(lat=lat, lon=lon, method="nearest")
            if hasattr(vort_val, 'magnitude'):
                avg_vorticity.append(vort_val.magnitude)
            else:
                avg_vorticity.append(vort_val.values)
        avg_vorticity = np.mean(avg_vorticity)

        avg_wind_speed = []
        for lat, lon in zip(lats, lons):
            u = u10.sel(lat=lat, lon=lon, method="nearest")
            v = v10.sel(lat=lat, lon=lon, method="nearest")
            if hasattr(u, 'magnitude'):
                u_val = u.magnitude
                v_val = v.magnitude
            else:
                u_val = u.values
                v_val = v.values
            avg_wind_speed.append(np.sqrt(u_val ** 2 + v_val ** 2))
        avg_wind_speed = np.mean(avg_wind_speed)

        if len(line) >= 3:
            start = line[0]
            middle = line[len(line) // 2]
            end = line[-1]

            vec1 = middle - start
            vec2 = end - middle

            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)

            if norm1 == 0 or norm2 == 0:
                angle = np.nan
            else:
                dot_product = np.dot(vec1, vec2)
                angle = np.arccos(np.clip(dot_product / (norm1 * norm2), -1.0, 1.0))
        else:
            angle = np.nan

        angle = np.degrees(angle) if not np.isnan(angle) else angle

        result.append({
            "line": line,
            "attributes": {
                "region_box": region_box,
                "length": length,
                "avg_vorticity": avg_vorticity,
                "avg_wind_speed": avg_wind_speed,
                "angle": angle
            }
        })

    return result


def convert_to_dataframe(result):
    """
    将槽线结果转换为DataFrame,并按照avg_vorticity从大到小排序

    参数:
    - result: list, 每条槽线及其属性的结果列表

    返回:
    - pandas.DataFrame: 包含槽线及其属性的数据,按照avg_vorticity排序
    """
    data = []
    for idx, item in enumerate(result):
        data.append({
            "line_index": idx + 1,
            "line": item["line"],
            "region_box": item["attributes"]["region_box"],
            "length": item["attributes"]["length"],
            "avg_vorticity": item["attributes"]["avg_vorticity"],
            "avg_wind_speed": item["attributes"]["avg_wind_speed"],
            "angle": item["attributes"]["angle"],
        })

    df = pd.DataFrame(data)
    sorted_df = df.sort_values(by="avg_vorticity", ascending=False).reset_index(drop=True)

    return sorted_df


def process_and_plot_shear_lines(points, uwnd, vwnd, interval_dis, length_min, smoothness,
                                  vorticity_threshold, wind_speed_threshold,
                                  angle_threshold, color, linewidth, label, ax,
                                  smooth_method='spline', num_points=100, num_control_points=None):
    """
    处理切变点数据并绘制切变线的通用函数

    参数:
    - points: 切变点数组
    - uwnd: xarray.Dataset, 经向风速数据
    - vwnd: xarray.Dataset, 纬向风速数据
    - interval_dis: 连接阈值距离
    - length_min: 最小线段长度
    - smoothness: 平滑参数(用于spline方法)
    - vorticity_threshold: 涡度过滤阈值
    - wind_speed_threshold: 风速过滤阈值
    - angle_threshold: 角度过滤阈值
    - color: 绘图颜色
    - linewidth: 线宽
    - label: 图例标签
    - ax: matplotlib轴对象
    - smooth_method: str, 平滑方法,可选'spline'或'bezier'
    - num_points: int, 平滑后的点数(用于bezier方法)
    - num_control_points: int或None, 贝塞尔曲线的控制点数量
    """
    lines = form_lines(points, interval_dis, length_min)
    lines_attr = add_meteorological_attributes(lines, uwnd, vwnd)
    df_lines = convert_to_dataframe(lines_attr)

    filtered_df = df_lines[
        (df_lines['avg_vorticity'] > vorticity_threshold) &
        (df_lines['avg_wind_speed'] > wind_speed_threshold) &
        (df_lines['angle'] < angle_threshold)
    ].reset_index(drop=True)

    if smooth_method == 'bezier':
        smoothed_lines = smooth_lines_bezier(filtered_df['line'], num_points=num_points,
                                             num_control_points=num_control_points)
    else:
        smoothed_lines = smooth_lines(filtered_df['line'], smoothness=smoothness)

    for line in smoothed_lines:
        line = np.array(line)
        ax.plot(line[:, 1], line[:, 0], marker='o', linewidth=linewidth,
                markersize=1, color=color, label=label if line is smoothed_lines[0] else '')


def plot_trough_analysis(init_time='2024061412', fc_hour=0):
    """
    主函数:执行完整的槽线分析和可视化

    参数:
    - init_time: str, 初始时间,格式为'YYYYMMDDHH'
    - fc_hour: int, 预报小时
    """
    # 加载数据
    data = load_weather_data(init_time, fc_hour)
    uwnd = data['uwnd']
    vwnd = data['vwnd']
    latitude = data['latitude']
    longitude = data['longitude']
    grid_unit = data['grid_unit']

    # 计算切变点
    shear_points = calculate_shear_points(uwnd, vwnd, latitude, longitude, grid_unit)
    shear_u_left = shear_points['shear_u_left']
    shear_u_right = shear_points['shear_u_right']
    shear_v_up = shear_points['shear_v_up']
    shear_v_down = shear_points['shear_v_down']

    # 创建地图
    fig = plt.figure(figsize=(10, 8), dpi=150)
    ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
    ax.set_extent([longitude[0], longitude[-1], latitude[0], latitude[-1]])
    ax.add_feature(cfeature.COASTLINE)
    ax.add_feature(cfeature.BORDERS)

    # 添加风向杆图
    skip = 8
    ax.barbs(longitude[::skip], latitude[::skip], uwnd[::skip, ::skip], vwnd[::skip, ::skip],
             transform=ccrs.PlateCarree(), length=5,
             barb_increments={'half': 2, 'full': 4, 'flag': 20}, sizes={'emptybarb': 0})

    # 参数设置
    interval_dis = 2.0
    length_min = 6
    smoothness = 6
    smooth_method = 'bezier'
    num_points = 100
    num_control_points = 5

    # 处理并绘制四种切变线
    process_and_plot_shear_lines(shear_u_left, uwnd, vwnd, interval_dis, length_min, smoothness,
                                  vorticity_threshold=1.0, wind_speed_threshold=2.0,
                                  angle_threshold=90, color='blue', linewidth=1.0,
                                  label='Shear U Left', ax=ax,
                                  smooth_method=smooth_method, num_points=num_points,
                                  num_control_points=num_control_points)

    process_and_plot_shear_lines(shear_u_right, uwnd, vwnd, interval_dis, length_min, smoothness,
                                  vorticity_threshold=1.0, wind_speed_threshold=2.0,
                                  angle_threshold=90, color='green', linewidth=1.0,
                                  label='Shear U Right', ax=ax,
                                  smooth_method=smooth_method, num_points=num_points,
                                  num_control_points=num_control_points)

    process_and_plot_shear_lines(shear_v_up, uwnd, vwnd, interval_dis, length_min, smoothness,
                                  vorticity_threshold=1.0, wind_speed_threshold=3.0,
                                  angle_threshold=90, color='red', linewidth=1.0,
                                  label='Shear V Up', ax=ax,
                                  smooth_method=smooth_method, num_points=num_points,
                                  num_control_points=num_control_points)

    process_and_plot_shear_lines(shear_v_down, uwnd, vwnd, interval_dis, length_min, smoothness,
                                  vorticity_threshold=1.0, wind_speed_threshold=3.0,
                                  angle_threshold=90, color='orange', linewidth=1.0,
                                  label='Shear V Down', ax=ax,
                                  smooth_method=smooth_method, num_points=num_points,
                                  num_control_points=num_control_points)

    ax.gridlines(draw_labels=True, linewidth=1)
    ax.legend(loc='upper right')
    plt.title(f'Smoothed Shear Lines (4 Types) - {smooth_method.capitalize()} Method', fontsize=16)
    plt.show()


if __name__ == '__main__':
    # 示例:分析2024年6月14日12时的槽线
    plot_trough_analysis(init_time='2024061412', fc_hour=0)
