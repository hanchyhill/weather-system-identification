"""Jet-axis identification and output workflow."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr
from scipy.ndimage import gaussian_filter

from weather_common import (
    DEFAULT_SOURCE,
    TIME_STR_LIST_ECMWFTHIN,
    TARGET_LEV_LIST,
    WeatherDataError,
    _json_float,
    _read_existing_line_count,
    _to_data_array,
    _to_float,
    calLatestBaseTime,
    form_lines,
    format_fc_hour,
    load_weather_data,
    points_to_json,
    smooth_lines,
)


JET_CONFIG = {
    'wind_smooth_sigma': 3,
    'speed_threshold': 4,
    'interval_dis': 2.0,
    'length_min': 5.0,
    'smoothness': 5,
    'barb_skip': 8,
    'figsize': (10, 8),
    'dpi': 150,
}


def _coord_name(data, candidates):
    data = _to_data_array(data)
    for candidate in candidates:
        if candidate in data.coords or candidate in data.dims:
            return candidate
    raise ValueError(f'Missing coordinate; expected one of {candidates}')


def _lat_name(data):
    return _coord_name(data, ('lat', 'latitude'))


def _lon_name(data):
    return _coord_name(data, ('lon', 'longitude'))


def _coord_values(coord):
    if hasattr(coord, 'values'):
        return np.asarray(coord.values)
    return np.asarray(coord)


def _data_values(data):
    data = _to_data_array(data)
    if hasattr(data, 'values'):
        return np.asarray(data.values)
    return np.asarray(data)


def _nearest_wind_components(uwnd, vwnd, lon, lat):
    uwnd = _to_data_array(uwnd)
    vwnd = _to_data_array(vwnd)
    lat_key = _lat_name(uwnd)
    lon_key = _lon_name(uwnd)
    selector = {lat_key: lat, lon_key: lon}
    u_value = uwnd.sel(selector, method='nearest')
    v_value = vwnd.sel(selector, method='nearest')
    return _to_float(u_value), _to_float(v_value)


def _grid_coords(data):
    data = _to_data_array(data)
    lat_key = _lat_name(data)
    lon_key = _lon_name(data)
    return data[lat_key], data[lon_key]


def calculate_smoothed_wind(uwnd, vwnd, sigma=3):
    """Apply Gaussian smoothing to the u/v wind components."""
    uwnd = _to_data_array(uwnd)
    vwnd = _to_data_array(vwnd)
    smoothed_u = uwnd.copy(data=gaussian_filter(np.asarray(uwnd.values), sigma=sigma))
    smoothed_v = vwnd.copy(data=gaussian_filter(np.asarray(vwnd.values), sigma=sigma))
    return smoothed_u, smoothed_v


def calculate_wind_speed(uwnd, vwnd):
    """Calculate scalar wind speed from u/v components."""
    return np.sqrt(_to_data_array(uwnd) ** 2 + _to_data_array(vwnd) ** 2)


def rotate_vector_90(u, v):
    """Rotate vectors counterclockwise by 90 degrees."""
    u_r = -_to_data_array(v)
    v_r = _to_data_array(u)
    return u_r, v_r


def compute_speed_advection(u_r, v_r, speed, latitude):
    """
    Compute wind-speed advection along the 90-degree rotated wind vectors.
    """
    speed = _to_data_array(speed)
    speed_values = np.asarray(speed.values)
    latitude_values = _coord_values(latitude)

    dx = 111e3 * np.cos(np.radians(latitude_values))
    dx = np.where(np.abs(dx) < 1e-9, np.nan, dx)
    dy = 111e3

    d_speed_dx = np.gradient(speed_values, axis=-1) / dx[:, np.newaxis]
    d_speed_dy = np.gradient(speed_values, axis=-2) / dy
    adv_s_values = _data_values(u_r) * d_speed_dx + _data_values(v_r) * d_speed_dy
    return speed.copy(data=adv_s_values)


def extract_jet_axis_points(adv_s, speed, u_r, v_r, longitude, latitude, speed_threshold):
    """
    Extract jet-axis points from speed-advection sign changes.

    Returned points use notebook-compatible ``[lon, lat]`` order.
    """
    adv_values = _data_values(adv_s)
    speed_values = _data_values(speed)
    v_r_values = _data_values(v_r)
    lon_values = _coord_values(longitude)
    lat_values = _coord_values(latitude)

    jet_axis = []
    for i in range(adv_values.shape[0] - 1):
        for j in range(adv_values.shape[1] - 1):
            if speed_values[i, j] < speed_threshold:
                continue
            if v_r_values[i, j] > 0:
                if adv_values[i, j] > 0 and adv_values[i + 1, j] <= 0:
                    jet_axis.append((lon_values[j], lat_values[i]))
            else:
                if adv_values[i, j] < 0 and adv_values[i + 1, j] >= 0:
                    jet_axis.append((lon_values[j], lat_values[i]))

    return np.asarray(jet_axis, dtype=float)


def adjust_line_direction(lines, uwnd, vwnd):
    """Reverse lines whose point order runs against the local wind direction."""
    adjusted_lines = []

    for line in lines:
        line = list(line)
        if len(line) < 2:
            adjusted_lines.append(line)
            continue

        start = line[0] if len(line) == 2 else line[len(line) // 2]
        end = line[-1]
        vector_line = np.array(end) - np.array(start)

        start_u, start_v = _nearest_wind_components(uwnd, vwnd, start[0], start[1])
        end_u, end_v = _nearest_wind_components(uwnd, vwnd, end[0], end[1])
        vector_wind = np.array([start_u + end_u, start_v + end_v]) / 2.0

        dot_product = np.dot(vector_line, vector_wind)
        adjusted_lines.append(line[::-1] if dot_product < 0 else line)

    return adjusted_lines


def _line_length(line):
    line = np.asarray(line, dtype=float)
    if len(line) < 2:
        return 0.0
    return float(np.sum(np.sqrt(np.diff(line[:, 0]) ** 2 + np.diff(line[:, 1]) ** 2)))


def _jet_line_attributes(line, uwnd, vwnd):
    line = np.asarray(line, dtype=float)
    if line.size == 0:
        return {
            'region_box': {'min_lat': None, 'max_lat': None, 'min_lon': None, 'max_lon': None},
            'length': 0.0,
            'avg_wind_speed': None,
            'max_wind_speed': None,
        }

    lons = line[:, 0]
    lats = line[:, 1]
    wind_speeds = []
    for lon, lat in zip(lons, lats):
        u_value, v_value = _nearest_wind_components(uwnd, vwnd, lon, lat)
        wind_speeds.append(np.sqrt(u_value ** 2 + v_value ** 2))

    return {
        'region_box': {
            'min_lat': _json_float(np.min(lats)),
            'max_lat': _json_float(np.max(lats)),
            'min_lon': _json_float(np.min(lons)),
            'max_lon': _json_float(np.max(lons)),
        },
        'length': _json_float(_line_length(line)),
        'avg_wind_speed': _json_float(np.mean(wind_speeds)),
        'max_wind_speed': _json_float(np.max(wind_speeds)),
    }


def build_jet_line_records(lines, smoothed_lines, uwnd, vwnd):
    """Build JSON-ready records for detected jet-axis lines."""
    records = []
    for line_id, line in enumerate(lines, start=1):
        smoothed_line = smoothed_lines[line_id - 1] if line_id - 1 < len(smoothed_lines) else []
        records.append({
            'line_id': line_id,
            'points': points_to_json(line, order='lon_lat'),
            'smoothed_points': points_to_json(smoothed_line, order='lon_lat'),
            'attributes': _jet_line_attributes(line, uwnd, vwnd),
        })
    return records


def build_jet_json(init_time, fc_hour, target_lev, source, config, jet_axis_lines):
    """Build a single jet-axis JSON payload."""
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
            'avg_wind_speed': 'm/s',
            'max_wind_speed': 'm/s',
        },
        'config': config,
        'jet_axis_lines': jet_axis_lines,
    }


def plot_lines_with_direction(lines, uwnd, vwnd, speed=None, fill=False, same_color=True, ax=None):
    """Plot jet-axis lines with wind vectors and arrowheads."""
    uwnd = _to_data_array(uwnd)
    vwnd = _to_data_array(vwnd)
    latitude, longitude = _grid_coords(uwnd)

    if ax is None:
        fig = plt.figure(figsize=JET_CONFIG['figsize'], dpi=JET_CONFIG['dpi'])
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
    else:
        fig = ax.figure

    ax.set_extent([
        _to_float(longitude.min()),
        _to_float(longitude.max()),
        _to_float(latitude.min()),
        _to_float(latitude.max()),
    ], ccrs.PlateCarree())
    ax.add_feature(cfeature.COASTLINE)

    if fill and speed is not None:
        cf = ax.contourf(
            longitude,
            latitude,
            speed,
            transform=ccrs.PlateCarree(),
            cmap='jet',
            levels=np.arange(0, 25, 0.5),
        )
        fig.colorbar(cf, ax=ax, shrink=0.5, pad=0.05, orientation='horizontal')

    skip = JET_CONFIG['barb_skip']
    ax.quiver(
        longitude[::skip],
        latitude[::skip],
        uwnd[::skip, ::skip],
        vwnd[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        scale=300,
        color='black',
    )

    for line in lines:
        line = np.asarray(line, dtype=float)
        if line.size == 0:
            continue
        color = 'red' if same_color else None
        ax.plot(
            line[:, 0],
            line[:, 1],
            marker=None if same_color else '.',
            color=color,
            linewidth=2,
            transform=ccrs.PlateCarree(),
        )

        end_point = line[-1]
        end_u, end_v = _nearest_wind_components(uwnd, vwnd, end_point[0], end_point[1])
        ax.arrow(
            end_point[0],
            end_point[1],
            end_u * 0.01,
            end_v * 0.01,
            color='red',
            head_width=1.5,
            transform=ccrs.PlateCarree(),
        )

    ax.set_xlabel('Longitude')
    ax.set_ylabel('Latitude')
    return fig, ax


def plot_jet_analysis(init_time=None, fc_hour=0, target_lev=850,
                      source=DEFAULT_SOURCE, config=JET_CONFIG,
                      create_plot=True):
    """
    Run jet-axis analysis for one initialization, forecast hour, and level.
    """
    if init_time is None:
        init_time = calLatestBaseTime()

    data = load_weather_data(init_time, fc_hour, target_lev=target_lev, source=source)
    uwnd = data['uwnd']
    vwnd = data['vwnd']
    latitude = data['latitude']
    longitude = data['longitude']

    uwnd_smoothed, vwnd_smoothed = calculate_smoothed_wind(
        uwnd, vwnd, sigma=config['wind_smooth_sigma']
    )
    speed = calculate_wind_speed(uwnd_smoothed, vwnd_smoothed)
    u_r, v_r = rotate_vector_90(uwnd_smoothed, vwnd_smoothed)
    adv_s = compute_speed_advection(u_r, v_r, speed, latitude)
    jet_axis_points = extract_jet_axis_points(
        adv_s,
        speed,
        u_r,
        v_r,
        longitude,
        latitude,
        config['speed_threshold'],
    )

    lines = form_lines(jet_axis_points, config['interval_dis'], config['length_min'])
    adjusted_lines = adjust_line_direction(lines, uwnd, vwnd)
    lines_smooth = smooth_lines(adjusted_lines, smoothness=config['smoothness'])

    fig = None
    ax = None
    if create_plot:
        fig, ax = plot_lines_with_direction(
            lines_smooth,
            uwnd,
            vwnd,
            speed=speed,
            fill=False,
            same_color=True,
        )
        ax.add_feature(cfeature.BORDERS)
        ax.gridlines(draw_labels=True, linewidth=1)
        ax.set_title(
            f'Jet Axis - {init_time} +{format_fc_hour(fc_hour)}h '
            f'{target_lev}hPa',
            fontsize=16,
        )

    jet_axis_lines = build_jet_line_records(adjusted_lines, lines_smooth, uwnd, vwnd)
    jet_data = build_jet_json(
        init_time=init_time,
        fc_hour=fc_hour,
        target_lev=target_lev,
        source=source,
        config=config,
        jet_axis_lines=jet_axis_lines,
    )

    return fig, jet_data


def _read_existing_jet_line_count(json_path):
    return _read_existing_line_count(json_path, 'jet_axis_lines')


def get_multi_fc_jet_by_init_time(init_time=None, fc_hours=TIME_STR_LIST_ECMWFTHIN,
                                  target_levs=TARGET_LEV_LIST,
                                  output_root='./data',
                                  source=DEFAULT_SOURCE,
                                  config=JET_CONFIG,
                                  save_image=True,
                                  save_json=True,
                                  show_progress=True,
                                  stop_on_error=False):
    """
    Generate jet-axis images and JSON for multiple forecast hours and levels.
    """
    if init_time is None:
        init_time = calLatestBaseTime()

    fc_hours = [format_fc_hour(fc_hour) for fc_hour in fc_hours]
    total_tasks = len(fc_hours) * len(target_levs)
    if show_progress:
        print(
            f'Start jet analysis: init_time={init_time}, '
            f'total_tasks={total_tasks}, save_image={save_image}, save_json={save_json}'
        )

    output_root = Path(output_root)
    image_dir = output_root / init_time / 'jet_images' if save_image else None
    data_dir = output_root / init_time / 'jet_data' if save_json else None
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
                f'jet_{init_time}_{fc_str}_{target_lev}hPa_ecmwf.png'
            ) if save_image else None
            json_path = data_dir / (
                f'jet_{init_time}_{fc_str}_{target_lev}hPa_ecmwf.json'
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
                jet_line_count = _read_existing_jet_line_count(json_path)
                output_summary.append({
                    'init_time': init_time,
                    'fc_hour': fc_str,
                    'target_lev': target_lev,
                    'image_path': str(image_path) if image_path is not None else None,
                    'json_path': str(json_path) if json_path is not None else None,
                    'jet_axis_line_count': jet_line_count,
                    'status': 'skipped',
                    'reason': 'requested output files already exist',
                })
                if show_progress:
                    print(
                        f'  Skipped existing output: image_exists={image_exists}, '
                        f'json_exists={json_exists}, jet_axis_lines={jet_line_count}'
                    )
                continue

            try:
                fig, jet_data = plot_jet_analysis(
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
                        f'  Failed jet analysis: init_time={init_time}, '
                        f'fc_hour={fc_str}, target_lev={target_lev}hPa, error={message}'
                    )
                output_summary.append({
                    'init_time': init_time,
                    'fc_hour': fc_str,
                    'target_lev': target_lev,
                    'image_path': None,
                    'json_path': None,
                    'jet_axis_line_count': 0,
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
                    json.dump(jet_data, json_file, ensure_ascii=False, indent=2)
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
                'jet_axis_line_count': len(jet_data['jet_axis_lines']),
                'status': 'completed',
            })

            if show_progress:
                print(
                    f'  Completed init_time={init_time}, fc_hour={fc_str}, '
                    f'target_lev={target_lev}hPa, '
                    f'jet_axis_lines={len(jet_data["jet_axis_lines"])}'
                )

    if show_progress:
        print(f'Finished jet analysis: init_time={init_time}, total_tasks={total_tasks}')
    return output_summary


def update_latest_jet_outputs(fc_hours=TIME_STR_LIST_ECMWFTHIN,
                              target_levs=TARGET_LEV_LIST,
                              output_root='./data',
                              source=DEFAULT_SOURCE,
                              save_image=True,
                              save_json=True,
                              show_progress=True,
                              stop_on_error=False):
    """
    Automatically find the latest ECMWF init time and update jet-axis outputs.
    """
    return get_multi_fc_jet_by_init_time(
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
         target_levs=TARGET_LEV_LIST, output_root='./data',
         source=DEFAULT_SOURCE, save_image=True, save_json=True,
         show_progress=True, stop_on_error=False):
    """Batch-generate jet-axis outputs."""
    return get_multi_fc_jet_by_init_time(
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
    parser = argparse.ArgumentParser(description='批量更新急流轴识别输出。')
    parser.add_argument(
        '--init-time',
        default=None,
        help='起报时次，格式YYYYMMDDHH；不传时自动使用最新ECMWF起报时次。',
    )
    parser.add_argument('--fc-hours', nargs='+', default=TIME_STR_LIST_ECMWFTHIN)
    parser.add_argument('--target-levs', nargs='+', type=int, default=TARGET_LEV_LIST)
    parser.add_argument('--output-root', default='./data')
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
