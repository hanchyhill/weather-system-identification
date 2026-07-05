import argparse
import json
from pathlib import Path

import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib.pyplot as plt
import numpy as np
import metpy.calc as mpcalc
from metpy.units import units
import pandas as pd

from weather_common import (
    DEFAULT_SOURCE,
    TIME_STR_LIST_ECMWFTHIN,
    TARGET_LEV_LIST,
    WeatherDataError,
    WeatherDataReadError,
    WeatherDataNotReadyError,
    _json_float,
    _points_to_json,
    _read_existing_line_count,
    _to_data_array,
    _to_float,
    calLatestBaseTime,
    default_output_root,
    form_lines,
    format_fc_hour,
    load_weather_data,
    smooth_lines,
    smooth_lines_bezier,
    validate_weather_data_values,
)

TROUGH_CONFIG = {
    'interval_dis': 2.0,
    'length_min': 6,
    'smoothness': 6,
    'smooth_method': 'bezier',
    'num_points': 100,
    'num_control_points': 5,
    'barb_skip': 8,
    'figsize': (10, 8),
    'dpi': 150,
    'shear_types': {
        'shear_u_left': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 2.0,
            'angle_threshold': 90,
            'color': 'blue',
            'linewidth': 1.0,
            'label': 'Shear U Left',
        },
        'shear_u_right': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 2.0,
            'angle_threshold': 90,
            'color': 'green',
            'linewidth': 1.0,
            'label': 'Shear U Right',
        },
        'shear_v_up': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 3.0,
            'angle_threshold': 90,
            'color': 'red',
            'linewidth': 1.0,
            'label': 'Shear V Up',
        },
        'shear_v_down': {
            'vorticity_threshold': 1.0,
            'wind_speed_threshold': 3.0,
            'angle_threshold': 90,
            'color': 'orange',
            'linewidth': 1.0,
            'label': 'Shear V Down',
        },
    },
}

def _attributes_to_json(row):
    region_box = row['region_box']
    return {
        'region_box': {
            'min_lat': _json_float(region_box['min_lat']),
            'max_lat': _json_float(region_box['max_lat']),
            'min_lon': _json_float(region_box['min_lon']),
            'max_lon': _json_float(region_box['max_lon']),
        },
        'length': _json_float(row['length']),
        'avg_vorticity': _json_float(row['avg_vorticity']),
        'avg_wind_speed': _json_float(row['avg_wind_speed']),
        'angle': _json_float(row['angle']),
    }


def _read_existing_trough_line_count(json_path):
    return _read_existing_line_count(json_path, 'trough_lines')


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
    uwnd = _to_data_array(uwnd)
    vwnd = _to_data_array(vwnd)

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


def add_meteorological_attributes(lines, u10, v10):
    """
    为槽线添加气象相关属性

    参数:
    - lines: list, 槽线的点集合
    - u10, v10: xarray.Dataset或xarray.DataArray, 10米风速的经向和纬向分量

    返回:
    - list: 每条槽线和对应的属性
    """
    u10 = _to_data_array(u10)
    v10 = _to_data_array(v10)

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
            "min_lat": _to_float(lats.min()),
            "max_lat": _to_float(lats.max()),
            "min_lon": _to_float(lons.min()),
            "max_lon": _to_float(lons.max())
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
        avg_vorticity = _to_float(np.mean(avg_vorticity))

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
        avg_wind_speed = _to_float(np.mean(avg_wind_speed))

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

        angle = _to_float(np.degrees(angle)) if not np.isnan(angle) else np.nan

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

    columns = [
        "line_index", "line", "region_box", "length", "avg_vorticity",
        "avg_wind_speed", "angle",
    ]
    df = pd.DataFrame(data, columns=columns)
    if df.empty:
        return df

    sorted_df = df.sort_values(by="avg_vorticity", ascending=False).reset_index(drop=True)

    return sorted_df


def process_and_plot_shear_lines(points, uwnd, vwnd, interval_dis, length_min, smoothness,
                                 vorticity_threshold, wind_speed_threshold,
                                 angle_threshold, color, linewidth, label, ax,
                                 shear_type, smooth_method='spline',
                                 num_points=100, num_control_points=None):
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
    - ax: matplotlib轴对象或None
    - shear_type: str, 切变类型
    - smooth_method: str, 平滑方法,可选'spline'或'bezier'
    - num_points: int, 平滑后的点数(用于bezier方法)
    - num_control_points: int或None, 贝塞尔曲线的控制点数量
    """
    lines = form_lines(points, interval_dis, length_min)
    lines_attr = add_meteorological_attributes(lines, uwnd, vwnd)
    df_lines = convert_to_dataframe(lines_attr)
    if df_lines.empty:
        return []

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
        if ax is not None:
            ax.plot(line[:, 1], line[:, 0], marker='o', linewidth=linewidth,
                    markersize=1, color=color,
                    label=label if line is smoothed_lines[0] else '')

    trough_lines = []
    for row_idx, (_, row) in enumerate(filtered_df.iterrows()):
        smoothed_line = smoothed_lines[row_idx] if row_idx < len(smoothed_lines) else []
        trough_lines.append({
            'shear_type': shear_type,
            'label': label,
            'points': _points_to_json(row['line']),
            'smoothed_points': _points_to_json(smoothed_line),
            'attributes': _attributes_to_json(row),
        })

    return trough_lines


def build_trough_json(init_time, fc_hour, target_lev, source, config, trough_lines):
    """
    构建单个初始时间、预报时效和层次的槽线JSON结构。
    """
    return {
        'init_time': init_time,
        'fc_hour': format_fc_hour(fc_hour),
        'target_lev': target_lev,
        'source': source,
        'units': {
            'target_lev': 'hPa',
            'longitude': 'degrees_east',
            'latitude': 'degrees_north',
            'length': 'degrees',
            'avg_vorticity': '1e-5 s^-1',
            'avg_wind_speed': 'm/s',
            'angle': 'degrees',
        },
        'config': config,
        'trough_lines': trough_lines,
    }


def plot_trough_analysis(init_time=None, fc_hour=0, target_lev=500,
                         source=DEFAULT_SOURCE, config=TROUGH_CONFIG,
                         create_plot=True):
    """
    主函数:执行完整的槽线分析和可视化

    参数:
    - init_time: str或None, 初始时间,格式为'YYYYMMDDHH'; 为None时使用最新起报时次
    - fc_hour: int或str, 预报小时
    - target_lev: int或float, 目标气压层,单位hPa
    - source: str, 数据源
    - config: dict, 槽线识别与绘图配置
    - create_plot: bool, 是否创建图像

    返回:
    - fig: matplotlib.figure.Figure或None, 图像句柄
    - trough_data: dict, JSON可序列化的槽线数据
    """
    if init_time is None:
        init_time = calLatestBaseTime()

    # 加载数据
    data = load_weather_data(init_time, fc_hour, target_lev=target_lev, source=source)
    uwnd = data['uwnd']
    vwnd = data['vwnd']
    latitude = data['latitude']
    longitude = data['longitude']
    grid_unit = data['grid_unit']

    # 计算切变点
    shear_points = calculate_shear_points(uwnd, vwnd, latitude, longitude, grid_unit)
    fig = None
    ax = None
    if create_plot:
        # 创建地图
        fig = plt.figure(figsize=config['figsize'], dpi=config['dpi'])
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
        ax.set_extent([
            _to_float(longitude[0]),
            _to_float(longitude[-1]),
            _to_float(latitude[0]),
            _to_float(latitude[-1]),
        ])
        ax.add_feature(cfeature.COASTLINE)
        ax.add_feature(cfeature.BORDERS)

        # 添加风向杆图
        skip = config['barb_skip']
        ax.barbs(longitude[::skip], latitude[::skip], uwnd[::skip, ::skip], vwnd[::skip, ::skip],
                 transform=ccrs.PlateCarree(), length=5,
                 barb_increments={'half': 2, 'full': 4, 'flag': 20}, sizes={'emptybarb': 0})

    # 处理并绘制四种切变线
    trough_lines = []
    for shear_type, shear_config in config['shear_types'].items():
        trough_lines.extend(
            process_and_plot_shear_lines(
                shear_points[shear_type], uwnd, vwnd,
                config['interval_dis'], config['length_min'], config['smoothness'],
                vorticity_threshold=shear_config['vorticity_threshold'],
                wind_speed_threshold=shear_config['wind_speed_threshold'],
                angle_threshold=shear_config['angle_threshold'],
                color=shear_config['color'],
                linewidth=shear_config['linewidth'],
                label=shear_config['label'],
                ax=ax,
                shear_type=shear_type,
                smooth_method=config['smooth_method'],
                num_points=config['num_points'],
                num_control_points=config['num_control_points'],
            )
        )

    for line_id, trough_line in enumerate(trough_lines, start=1):
        trough_line['line_id'] = line_id

    if ax is not None:
        ax.gridlines(draw_labels=True, linewidth=1)
        handles, labels = ax.get_legend_handles_labels()
        if handles:
            ax.legend(handles, labels, loc='upper right')
        ax.set_title(
            f'Trough Lines - {init_time} +{format_fc_hour(fc_hour)}h '
            f'{target_lev}hPa ({config["smooth_method"].capitalize()})',
            fontsize=16,
        )

    trough_data = build_trough_json(
        init_time=init_time,
        fc_hour=fc_hour,
        target_lev=target_lev,
        source=source,
        config=config,
        trough_lines=trough_lines,
    )

    return fig, trough_data


def get_multi_fc_trough_by_init_time(init_time=None, fc_hours=TIME_STR_LIST_ECMWFTHIN,
                                     target_levs=TARGET_LEV_LIST,
                                     output_root=default_output_root(),
                                     source=DEFAULT_SOURCE,
                                     config=TROUGH_CONFIG,
                                     save_image=True,
                                     save_json=True,
                                     show_progress=True,
                                     stop_on_error=False):
    """
    根据初始时间批量生成多个预报时效和多个层次的槽线图像与JSON数据。

    参数:
    - init_time: str或None, 初始时间; 为None时使用最新起报时次
    - save_image: bool, 是否保存PNG图像
    - save_json: bool, 是否保存JSON槽线数据
    - show_progress: bool, 是否打印运行进度
    - stop_on_error: bool, 任一时效或层次读取失败时是否停止；默认继续尝试后续任务

    返回:
    - list: 每个预报时效和层次的输出摘要
    """
    if init_time is None:
        init_time = calLatestBaseTime()

    fc_hours = [format_fc_hour(fc_hour) for fc_hour in fc_hours]
    total_tasks = len(fc_hours) * len(target_levs)
    if show_progress:
        print(
            f'Start trough analysis: init_time={init_time}, '
            f'total_tasks={total_tasks}, save_image={save_image}, save_json={save_json}'
        )

    output_root = Path(output_root)
    image_dir = output_root / init_time / 'trough_images' if save_image else None
    data_dir = output_root / init_time / 'trough_data' if save_json else None
    if image_dir is not None:
        image_dir.mkdir(parents=True, exist_ok=True)
    if data_dir is not None:
        data_dir.mkdir(parents=True, exist_ok=True)

    output_summary = []
    task_index = 0
    for fc_str in fc_hours:
        for target_lev in target_levs:
            task_index += 1
            image_path = image_dir / (
                f'trough_{init_time}_{fc_str}_{target_lev}hPa_ecmwf.png'
            ) if save_image else None
            json_path = data_dir / (
                f'trough_{init_time}_{fc_str}_{target_lev}hPa_ecmwf.json'
            ) if save_json else None
            image_exists = image_path is not None and image_path.exists()
            json_exists = json_path is not None and json_path.exists()
            requested_outputs_exist = (
                (not save_image or image_exists) and
                (not save_json or json_exists)
            )

            if show_progress:
                print(
                    f'[{task_index}/{total_tasks}] Processing '
                    f'init_time={init_time}, fc_hour={fc_str}, target_lev={target_lev}hPa'
                )

            if requested_outputs_exist:
                trough_line_count = _read_existing_trough_line_count(json_path)
                output_summary.append({
                    'init_time': init_time,
                    'fc_hour': fc_str,
                    'target_lev': target_lev,
                    'image_path': str(image_path) if image_path is not None else None,
                    'json_path': str(json_path) if json_path is not None else None,
                    'trough_line_count': trough_line_count,
                    'status': 'skipped',
                    'reason': 'requested output files already exist',
                })
                if show_progress:
                    print(
                        f'  Skipped existing output: image_exists={image_exists}, '
                        f'json_exists={json_exists}, trough_lines={trough_line_count}'
                    )
                continue

            try:
                fig, trough_data = plot_trough_analysis(
                    init_time=init_time,
                    fc_hour=fc_str,
                    target_lev=target_lev,
                    source=source,
                    config=config,
                    create_plot=save_image and not image_exists,
                )
            except WeatherDataError as exc:
                message = str(exc)
                if show_progress:
                    print(
                        f'  Failed trough analysis: init_time={init_time}, '
                        f'fc_hour={fc_str}, target_lev={target_lev}hPa, error={message}'
                    )
                output_summary.append({
                    'init_time': init_time,
                    'fc_hour': fc_str,
                    'target_lev': target_lev,
                    'image_path': None,
                    'json_path': None,
                    'trough_line_count': 0,
                    'status': 'aborted',
                    'error': message,
                })
                if stop_on_error:
                    return output_summary
                continue

            if save_image and not image_exists:
                fig.savefig(image_path, bbox_inches='tight')
                plt.close(fig)
                if show_progress:
                    print(f'  Saved image: {image_path}')
            elif save_image and image_exists and show_progress:
                print(f'  Kept existing image: {image_path}')

            if save_json and not json_exists:
                with json_path.open('w', encoding='utf-8') as json_file:
                    json.dump(trough_data, json_file, ensure_ascii=False, indent=2)
                if show_progress:
                    print(f'  Saved JSON: {json_path}')
            elif save_json and json_exists and show_progress:
                print(f'  Kept existing JSON: {json_path}')

            if fig is not None and (not save_image or image_exists):
                plt.close(fig)

            output_summary.append({
                'init_time': init_time,
                'fc_hour': fc_str,
                'target_lev': target_lev,
                'image_path': str(image_path) if image_path is not None else None,
                'json_path': str(json_path) if json_path is not None else None,
                'trough_line_count': len(trough_data['trough_lines']),
                'status': 'completed',
            })

            if show_progress:
                print(
                    f'  Completed init_time={init_time}, fc_hour={fc_str}, '
                    f'target_lev={target_lev}hPa, '
                    f'trough_lines={len(trough_data["trough_lines"])}'
                )

    if show_progress:
        print(f'Finished trough analysis: init_time={init_time}, total_tasks={total_tasks}')
    return output_summary


def update_latest_trough_outputs(fc_hours=TIME_STR_LIST_ECMWFTHIN,
                                 target_levs=TARGET_LEV_LIST,
                                 output_root=default_output_root(),
                                 source=DEFAULT_SOURCE,
                                 save_image=True,
                                 save_json=True,
                                 show_progress=True,
                                 stop_on_error=False):
    """
    自动查找最新ECMWF起报时次，并逐个预报时效更新槽线输出。

    已存在的目标输出会跳过；某个时效或层次未更新时默认记录失败并继续。
    """
    return get_multi_fc_trough_by_init_time(
        init_time=calLatestBaseTime(),
        fc_hours=fc_hours,
        target_levs=target_levs,
        output_root=output_root,
        source=source,
        save_image=save_image,
        save_json=save_json,
        show_progress=show_progress,
        stop_on_error=stop_on_error,
    )


def main(init_time=None, fc_hours=TIME_STR_LIST_ECMWFTHIN,
         target_levs=TARGET_LEV_LIST, output_root=default_output_root(),
         source=DEFAULT_SOURCE, save_image=True, save_json=True,
         show_progress=True, stop_on_error=False):
    """
    批量生成槽线结果。init_time为None时默认使用最新ECMWF起报时次。
    """
    return get_multi_fc_trough_by_init_time(
        init_time=init_time,
        fc_hours=fc_hours,
        target_levs=target_levs,
        output_root=output_root,
        source=source,
        save_image=save_image,
        save_json=save_json,
        show_progress=show_progress,
        stop_on_error=stop_on_error,
    )


def parse_args():
    parser = argparse.ArgumentParser(description='批量更新槽线识别输出。')
    parser.add_argument(
        '--init-time',
        default=None,
        help='起报时次，格式YYYYMMDDHH；不传时自动使用最新ECMWF起报时次。',
    )
    parser.add_argument('--fc-hours', nargs='+', default=TIME_STR_LIST_ECMWFTHIN)
    parser.add_argument('--target-levs', nargs='+', type=int, default=TARGET_LEV_LIST)
    parser.add_argument('--output-root', default=default_output_root())
    parser.add_argument('--source', default=DEFAULT_SOURCE)
    parser.add_argument('--save-image', dest='save_image', action='store_true', default=True)
    parser.add_argument('--no-save-image', dest='save_image', action='store_false')
    parser.add_argument('--save-json', dest='save_json', action='store_true', default=True)
    parser.add_argument('--no-save-json', dest='save_json', action='store_false')
    parser.add_argument(
        '--stop-on-error',
        action='store_true',
        help='任一时效或层次失败时立即停止；默认记录失败并继续后续任务。',
    )
    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()
    main(
        init_time=args.init_time,
        fc_hours=args.fc_hours,
        target_levs=args.target_levs,
        output_root=args.output_root,
        source=args.source,
        save_image=args.save_image,
        save_json=args.save_json,
        stop_on_error=args.stop_on_error,
    )
