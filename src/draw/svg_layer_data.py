"""NetCDF 数据读取、单位转换和场预处理。"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import xarray as xr
from scipy.ndimage import gaussian_filter

from draw.svg_layer_geometry import Bounds
from vortex_common import ABNORMAL_DATA_THRESHOLD, VortexDataNotReadyError
from weather_common import TIME_STR_LIST_ECMWFTHIN


def format_fc_hour(fc_hour: str | int) -> str:
    return str(fc_hour).strip().zfill(3)


def accumulation_start_hour(
    fc_hour: str | int,
    accumulation_hours: int,
    available_hours: Iterable[str] = TIME_STR_LIST_ECMWFTHIN,
) -> str | None:
    """返回累积降水起点时效；两端均存在时才允许相减。"""
    end_hour = int(format_fc_hour(fc_hour))
    start_hour = end_hour - accumulation_hours
    available = {format_fc_hour(hour) for hour in available_hours}
    if start_hour < 0 or format_fc_hour(end_hour) not in available:
        return None

    start_fc_hour = format_fc_hour(start_hour)
    return start_fc_hour if start_fc_hour in available else None


def precipitation_amount_mm(precipitation: xr.DataArray) -> xr.DataArray:
    """将累计降水量统一为毫米；tppm 缺少单位属性时默认按米处理。"""
    values = np.asarray(precipitation.values, dtype=float)
    units = str(precipitation.attrs.get("units", "")).strip().lower()
    if units in {"", "m", "meter", "meters", "metre", "metres"}:
        values *= 1000.0
    return xr.DataArray(
        values,
        coords=precipitation.coords,
        dims=precipitation.dims,
        attrs={**precipitation.attrs, "units": "mm"},
    )


def accumulated_precipitation(
    end_accumulation: xr.DataArray,
    start_accumulation: xr.DataArray,
) -> xr.DataArray:
    """由两个从起报时刻累计的降水端点计算窗口降水量（mm）。"""
    end_mm = precipitation_amount_mm(end_accumulation)
    start_mm = precipitation_amount_mm(start_accumulation)
    result = end_mm - start_mm
    return result.assign_attrs(units="mm")


def selected_time(init_time: str) -> str:
    return f"{init_time[0:4]}-{init_time[4:6]}-{init_time[6:8]} {init_time[8:10]}:00:00"


def thredds_url(init_time: str, source: str, filename: str, base_url_template: str) -> str:
    return base_url_template.format(source=source).rstrip("/") + f"/{init_time[0:6]}/{filename}"


def first_present(names: Iterable[str], candidates: Iterable[str]) -> str | None:
    available = set(names)
    return next((candidate for candidate in candidates if candidate in available), None)


def coord_name(data: xr.DataArray, role: str) -> str:
    candidates_by_role = {
        "lon": ("lon", "longitude", "x"),
        "lat": ("lat", "latitude", "y"),
        "level": ("level", "lev", "isobaricInhPa", "pressure"),
        "time": ("time", "valid_time"),
    }
    try:
        candidates = candidates_by_role[role]
    except KeyError as exc:
        raise ValueError(f"Unknown coordinate role: {role}") from exc
    name = first_present(data.coords, candidates) or first_present(data.dims, candidates)
    if name is None:
        raise ValueError(f"Could not find {role} coordinate in {data.name or 'data array'}")
    return name


def choose_variable(dataset: xr.Dataset, candidates: Iterable[str]) -> str:
    name = first_present(dataset.data_vars, candidates)
    if name is not None:
        return name
    if len(dataset.data_vars) == 1:
        return next(iter(dataset.data_vars))
    raise ValueError("Could not choose variable. Tried " + ", ".join(candidates) + f"; available variables: {', '.join(dataset.data_vars)}")


class DatasetCache:
    """单个生成进程使用的 xarray 数据集缓存。"""

    def __init__(self) -> None:
        self._datasets: dict[str, xr.Dataset] = {}

    def open(self, path_or_url: str) -> xr.Dataset:
        dataset = self._datasets.get(path_or_url)
        if dataset is None:
            dataset = xr.open_dataset(path_or_url)
            self._datasets[path_or_url] = dataset
        return dataset

    def close(self) -> None:
        for dataset in self._datasets.values():
            dataset.close()
        self._datasets.clear()


def open_dataset_cached(path_or_url: str, cache: DatasetCache | None = None) -> xr.Dataset:
    return xr.open_dataset(path_or_url) if cache is None else cache.open(path_or_url)


def select_data_array(dataset: xr.Dataset, variable_candidates: Iterable[str], init_time: str, level: int | None, bounds: Bounds) -> xr.DataArray:
    data = dataset[choose_variable(dataset, variable_candidates)]
    time_name = first_present(data.coords, ("time", "valid_time"))
    if time_name is not None:
        target_time = np.datetime64(selected_time(init_time))
        try:
            data = data.sel({time_name: target_time})
        except Exception:
            data = data.sel({time_name: target_time}, method="nearest")
    level_name = first_present(data.coords, ("level", "lev", "isobaricInhPa", "pressure"))
    if level is not None and level_name is not None:
        data = data.sel({level_name: level}, method="nearest")
    elif level is None and level_name is not None:
        try:
            data = data.sel({level_name: 0.0})
        except Exception:
            data = data.sel({level_name: 0.0}, method="nearest")
    lat_name, lon_name = coord_name(data, "lat"), coord_name(data, "lon")
    data = data.sortby(lat_name).sortby(lon_name).sel({
        lon_name: slice(bounds.lon_min, bounds.lon_max),
        lat_name: slice(bounds.lat_min, bounds.lat_max),
    })
    if data.sizes.get(lat_name, 0) == 0 or data.sizes.get(lon_name, 0) == 0:
        raise ValueError(f"No data remains after cropping to bounds {bounds.as_list()}")
    return data.squeeze(drop=True)


def validate_data_values(fields: dict[str, xr.DataArray], threshold: float = ABNORMAL_DATA_THRESHOLD) -> None:
    abnormal_items = []
    for name, data in fields.items():
        values = np.asarray(data.values)
        if values.size and not np.all(np.isnan(values)):
            min_value = float(np.nanmin(values))
            if np.isfinite(min_value) and min_value < threshold:
                abnormal_items.append(f"{name} min={min_value}")
    if abnormal_items:
        raise VortexDataNotReadyError("Abnormal weather data detected; data may not be updated yet: " + ", ".join(abnormal_items))


def open_data_array(path_or_url: str, variable_candidates: Iterable[str], init_time: str, level: int | None, bounds: Bounds, cache: DatasetCache | None = None) -> xr.DataArray:
    dataset = open_dataset_cached(path_or_url, cache)
    try:
        try:
            data = select_data_array(dataset, variable_candidates, init_time, level, bounds)
        except ValueError as exc:
            raise ValueError(f"{exc} from {path_or_url}") from exc
        validate_data_values({data.name or "field": data})
        return data if cache is not None else data.load()
    finally:
        if cache is None:
            dataset.close()


def default_path(explicit_path: str | None, init_time: str, source: str, filename: str, base_url_template: str) -> str:
    return explicit_path or thredds_url(init_time, source, filename, base_url_template)


def wind_speed(u: xr.DataArray, v: xr.DataArray) -> xr.DataArray:
    return np.sqrt(u**2 + v**2)


def temperature_celsius(temp: xr.DataArray) -> xr.DataArray:
    values = np.asarray(temp.values, dtype=float)
    if str(temp.attrs.get("units", "")).lower() in {"k", "kelvin"} or np.nanmedian(values) > 100:
        values -= 273.15
    return xr.DataArray(values, coords=temp.coords, dims=temp.dims, attrs={**temp.attrs, "units": "degC"})


def relative_humidity_percent(rhum: xr.DataArray) -> xr.DataArray:
    values = np.asarray(rhum.values, dtype=float)
    finite = values[np.isfinite(values)]
    if str(rhum.attrs.get("units", "")).strip() == "0.01" and finite.size and np.nanmax(finite) <= 1.5:
        values *= 100.0
    return xr.DataArray(values, coords=rhum.coords, dims=rhum.dims, attrs={**rhum.attrs, "units": "%"})


def mslp_hpa(mslp: xr.DataArray) -> xr.DataArray:
    values = np.asarray(mslp.values, dtype=float)
    if str(mslp.attrs.get("units", "")).lower() == "pa" or np.nanmedian(values) > 2000:
        values /= 100.0
    return xr.DataArray(values, coords=mslp.coords, dims=mslp.dims, attrs={**mslp.attrs, "units": "hPa"})


def smooth_array(data: xr.DataArray, sigma: float) -> xr.DataArray:
    if sigma <= 0:
        return data
    return xr.DataArray(gaussian_filter(np.asarray(data.values, dtype=float), sigma=sigma), coords=data.coords, dims=data.dims, attrs=data.attrs)


def five_point_smooth(data: xr.DataArray) -> xr.DataArray:
    lat_name, lon_name = coord_name(data, "lat"), coord_name(data, "lon")
    if lat_name not in data.dims or lon_name not in data.dims or data.sizes[lat_name] < 3 or data.sizes[lon_name] < 3:
        return data
    values = np.asarray(data.values, dtype=float)
    smoothed = values.copy()
    source = np.moveaxis(values, (data.get_axis_num(lat_name), data.get_axis_num(lon_name)), (-2, -1))
    target = np.moveaxis(smoothed, (data.get_axis_num(lat_name), data.get_axis_num(lon_name)), (-2, -1))
    stencil = (source[..., 1:-1, 1:-1], source[..., :-2, 1:-1], source[..., 2:, 1:-1], source[..., 1:-1, :-2], source[..., 1:-1, 2:])
    value_sum = np.zeros_like(stencil[0], dtype=float)
    value_count = np.zeros_like(stencil[0], dtype=float)
    for item in stencil:
        finite = np.isfinite(item)
        value_sum += np.where(finite, item, 0.0)
        value_count += finite
    averaged = np.full_like(value_sum, np.nan, dtype=float)
    np.divide(value_sum, value_count, out=averaged, where=value_count > 0)
    target[..., 1:-1, 1:-1] = averaged
    return xr.DataArray(smoothed, coords=data.coords, dims=data.dims, attrs=data.attrs)


def crop_to_bounds(data: xr.DataArray, bounds: Bounds, padding: float = 0.0) -> xr.DataArray:
    lat_name, lon_name = coord_name(data, "lat"), coord_name(data, "lon")
    cropped = data.sel({
        lon_name: slice(bounds.lon_min - padding, bounds.lon_max + padding),
        lat_name: slice(bounds.lat_min - padding, bounds.lat_max + padding),
    })
    return data if cropped.sizes.get(lat_name, 0) < 2 or cropped.sizes.get(lon_name, 0) < 2 else cropped
