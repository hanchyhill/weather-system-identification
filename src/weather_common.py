"""Shared helpers for trough and jet-axis identification workflows."""

from __future__ import annotations

import json
import platform
from pathlib import Path

import arrow
import numpy as np
import xarray as xr
from scipy.interpolate import splprep, splev
from scipy.spatial import distance
import scipy.special


DEFAULT_SOURCE = 'ecmwfthin'
ABNORMAL_DATA_THRESHOLD = -999
TIME_STR_LIST_ECMWFTHIN = [
    '000', '003', '006', '009', '012', '015', '018', '021', '024',
    '027', '030', '033', '036', '039', '042', '045', '048', '051',
    '054', '057', '060', '063', '066', '069', '072', '078', '084',
    '090', '096', '102', '108', '114', '120', '126', '132', '138',
    '144', '150', '156', '162', '168', '174', '180', '186', '192',
    '198', '204', '210', '216', '222', '228', '234', '240',
]
TARGET_LEV_LIST = [200, 500, 850, 925, 950]


def default_output_root() -> str:
    """根据操作系统返回默认数据输出根目录。

    - 本地开发（Windows）：写入项目下的相对目录 ``./data``。
    - 生产环境（Linux 服务器）：写入挂载的 ``/data`` 目录。
    """
    if platform.system() == 'Windows':
        return './data'
    return '/data'


class WeatherDataError(Exception):
    """气象数据读取或校验异常。"""


class WeatherDataReadError(WeatherDataError):
    """气象数据读取失败。"""


class WeatherDataNotReadyError(WeatherDataError):
    """气象数据尚未更新或包含异常填充值。"""


def calLatestBaseTime() -> str:
    """
    计算最新时次起报。

    返回:
    - baseTime: str, 格式为YYYYMMDDHH
    """
    utcnow = arrow.utcnow()
    hour = utcnow.hour
    if 7 <= hour < 19:
        base_time = f"{utcnow.format('YYYYMMDD')}00"
    elif hour >= 19:
        base_time = f"{utcnow.format('YYYYMMDD')}12"
    else:
        base_time = f"{utcnow.shift(days=-1).format('YYYYMMDD')}12"
    return base_time


def format_fc_hour(fc_hour):
    """将预报时效统一格式化为三位字符串。"""
    return str(fc_hour).strip().zfill(3)


def _to_data_array(data):
    if isinstance(data, xr.Dataset):
        return data[list(data.data_vars)[0]]
    return data


def _to_float(value):
    if hasattr(value, 'magnitude'):
        value = value.magnitude
    if hasattr(value, 'values'):
        value = value.values

    array_value = np.asarray(value)
    if array_value.size == 0:
        return np.nan

    return float(array_value.reshape(-1)[0])


def _json_float(value):
    value = _to_float(value)
    if not np.isfinite(value):
        return None
    return value


def points_to_json(points, order='lat_lon'):
    """
    Convert point arrays to JSON-safe ``{'lat': ..., 'lon': ...}`` records.

    ``order='lat_lon'`` expects points as ``[lat, lon]``. ``order='lon_lat'``
    expects points as ``[lon, lat]``.
    """
    points = np.asarray(points)
    if points.size == 0:
        return []

    records = []
    for point in points:
        if order == 'lon_lat':
            lon, lat = point[0], point[1]
        else:
            lat, lon = point[0], point[1]
        records.append({'lat': _json_float(lat), 'lon': _json_float(lon)})
    return records


def _points_to_json(points):
    return points_to_json(points, order='lat_lon')


def _min_data_value(data):
    data_array = _to_data_array(data)
    values = np.asarray(data_array.values)
    if values.size == 0 or np.all(np.isnan(values)):
        return np.nan
    return float(np.nanmin(values))


def validate_weather_data_values(data_dict, threshold=ABNORMAL_DATA_THRESHOLD):
    """
    校验读取到的气象要素。任一要素存在小于threshold的值，视为数据未更新。
    """
    abnormal_items = []
    for name, data in data_dict.items():
        min_value = _min_data_value(data)
        if np.isfinite(min_value) and min_value < threshold:
            abnormal_items.append(f'{name} min={min_value}')

    if abnormal_items:
        raise WeatherDataNotReadyError(
            'Abnormal weather data detected; data may not be updated yet: '
            + ', '.join(abnormal_items)
        )


def _read_existing_line_count(json_path, key):
    if json_path is None or not Path(json_path).exists():
        return None

    try:
        with Path(json_path).open('r', encoding='utf-8') as json_file:
            line_data = json.load(json_file)
        return len(line_data.get(key, []))
    except (OSError, json.JSONDecodeError):
        return None


def load_weather_data(init_time, fc_hour=0, target_lev=500, source=DEFAULT_SOURCE,
                      base_url_template='http://10.148.8.71:7080/thredds/dodsC/{0}/'):
    """
    加载气象数据。
    """
    year = init_time[0:4]
    month = init_time[4:6]
    day = init_time[6:8]
    hour = init_time[8:10]

    base_url = base_url_template.format(source)
    url_vector_x = base_url + '{0}{1}/uwnd.nc'.format(year, month)
    url_vector_y = base_url + '{0}{1}/vwnd.nc'.format(year, month)

    try:
        dataset_vec_x = xr.open_dataset(url_vector_x)
        dataset_vec_y = xr.open_dataset(url_vector_y)

        selected_time = '{0}-{1}-{2} {3}:00:00'.format(year, month, day, hour)
        fc_str = format_fc_hour(fc_hour)
        vector_x_var_name = 'uwnd{}'.format(fc_str)
        vector_y_var_name = 'vwnd{}'.format(fc_str)

        uwnd = dataset_vec_x[vector_x_var_name].sel(
            time=selected_time, level=target_lev
        ).to_dataset(name=vector_x_var_name)
        vwnd = dataset_vec_y[vector_y_var_name].sel(
            time=selected_time, level=target_lev
        ).to_dataset(name=vector_y_var_name)

        validate_weather_data_values({
            'uwnd': uwnd,
            'vwnd': vwnd,
        })

        uwnd = uwnd.metpy.parse_cf(varname=vector_x_var_name)
        vwnd = vwnd.metpy.parse_cf(varname=vector_y_var_name)
    except WeatherDataNotReadyError:
        raise
    except Exception as exc:
        raise WeatherDataReadError(
            f'Failed to read weather data: init_time={init_time}, '
            f'fc_hour={format_fc_hour(fc_hour)}, target_lev={target_lev}, source={source}'
        ) from exc

    latitude = uwnd.lat
    longitude = uwnd.lon
    grid_unit = (longitude[1] - longitude[0]).item()

    return {
        'uwnd': uwnd,
        'vwnd': vwnd,
        'latitude': latitude,
        'longitude': longitude,
        'grid_unit': grid_unit,
    }


def form_lines(points, interval_dis, length_min):
    """
    将点连接成线段。
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
            np.linalg.norm(np.array(current_line[i]) - np.array(current_line[i + 1]))
            for i in range(len(current_line) - 1)
        )

        if total_length > length_min:
            lines.append(current_line)

    return lines


def smooth_lines(lines, smoothness=0.5):
    """
    使用样条插值平滑线段。
    """
    smoothed_lines = []
    for line in lines:
        line = np.array(line)
        if len(line) > 2:
            try:
                tck, _ = splprep([line[:, 0], line[:, 1]], s=smoothness)
                u_new = np.linspace(0, 1, 100)
                smoothed_points = np.array(splev(u_new, tck)).T
                smoothed_lines.append(smoothed_points)
            except ValueError:
                smoothed_lines.append(line)
        else:
            smoothed_lines.append(line)
    return smoothed_lines


def smooth_lines_bezier(lines, num_points=100, num_control_points=None):
    """
    使用Bezier曲线平滑线段。
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
                control_point_count = max(2, num_control_points)
                indices = np.linspace(0, len(line) - 1, control_point_count, dtype=int)
                control_points = [line[i] for i in indices]
            else:
                control_points = line

            smoothed_lines.append([bezier_curve(control_points, t) for t in t_values])
        else:
            smoothed_lines.append(line)

    return smoothed_lines
