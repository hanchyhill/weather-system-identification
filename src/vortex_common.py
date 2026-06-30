"""Shared helpers for TDS-based vortex identification workflows."""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import arrow
import numpy as np
import xarray as xr


DEFAULT_SOURCE = "ecmwfthin"
DEFAULT_AREA = [90.0, 180.0, 0.0, 40.0]
DEFAULT_CENTER_AREA = [60.0, 150.0, 0.0, 60.0]
DEFAULT_LEVELS = [200, 500, 700, 850, 925, 950]
DEFAULT_WARM_LEVELS = [200, 300, 400, 500]
DEFAULT_FC_HOURS = [
    "000", "003", "006", "009", "012", "015", "018", "021", "024",
    "027", "030", "033", "036", "039", "042", "045", "048", "051",
    "054", "057", "060", "063", "066", "069", "072", "078", "084",
    "090", "096", "102", "108", "114", "120", "126", "132", "138",
    "144", "150", "156", "162", "168", "174", "180", "186", "192",
    "198", "204", "210", "216", "222", "228", "234", "240",
]

DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
BASE_URL_TEMPLATE = "http://10.148.8.71:7080/thredds/dodsC/{source}/{yyyymm}/{file_name}.nc"
ABNORMAL_DATA_THRESHOLD = -999.0


class VortexDataError(Exception):
    """Base error for vortex identification data handling."""


class VortexDataReadError(VortexDataError):
    """Raised when source weather data cannot be read."""


class VortexDataNotReadyError(VortexDataError):
    """Raised when a source field contains abnormal fill values."""


class VortexPreflightError(VortexDataError):
    """Raised when required center or warm-core files are not ready."""


def calLatestBaseTime() -> str:
    """Return the latest ECMWF base time as ``YYYYMMDDHH``."""
    utcnow = arrow.utcnow()
    hour = utcnow.hour
    if 7 <= hour < 19:
        return f"{utcnow.format('YYYYMMDD')}00"
    if hour >= 19:
        return f"{utcnow.format('YYYYMMDD')}12"
    return f"{utcnow.shift(days=-1).format('YYYYMMDD')}12"


def parse_init_time(init_time: str) -> datetime:
    """Parse an initialization time in ``YYYYMMDDHH`` format."""
    return datetime.strptime(str(init_time), "%Y%m%d%H")


def format_datetime(dt: datetime) -> str:
    """Format a datetime for output JSON fields."""
    return dt.strftime(DATETIME_FORMAT)


def parse_output_datetime(value: str) -> datetime:
    """Parse a JSON datetime field emitted by these workflows."""
    return datetime.strptime(value, DATETIME_FORMAT)


def format_fc_hour(fc_hour: int | str) -> str:
    """Normalize a forecast hour to a three-character string."""
    return str(int(str(fc_hour).strip())).zfill(3)


def normalize_fc_hours(fc_hours: Iterable[int | str] | None) -> list[str]:
    """Normalize and numerically sort forecast hours."""
    if fc_hours is None:
        fc_hours = DEFAULT_FC_HOURS
    return sorted({format_fc_hour(fc_hour) for fc_hour in fc_hours}, key=int)


def forecast_time(init_time: str, fc_hour: int | str) -> datetime:
    """Return the valid time for an initialization and forecast hour."""
    return parse_init_time(init_time) + timedelta(hours=int(format_fc_hour(fc_hour)))


def json_safe_float(value: Any) -> float | None:
    """Convert scalar-like numeric values to JSON-safe floats."""
    if hasattr(value, "magnitude"):
        value = value.magnitude
    if hasattr(value, "values"):
        value = value.values
    array_value = np.asarray(value)
    if array_value.size == 0:
        return None
    result = float(array_value.reshape(-1)[0])
    if not np.isfinite(result):
        return None
    return result


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance in kilometers."""
    radius_km = 6371.0
    lat1_rad, lon1_rad, lat2_rad, lon2_rad = map(
        math.radians, [lat1, lon1, lat2, lon2]
    )
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2.0) ** 2
    )
    return radius_km * 2.0 * math.asin(math.sqrt(a))


def output_base_dir(output_root: str | Path, init_time: str) -> Path:
    """Return the base output directory for one initialization."""
    return Path(output_root) / init_time


def center_dir(output_root: str | Path, init_time: str) -> Path:
    return output_base_dir(output_root, init_time) / "vortex_centers"


def warm_core_dir(output_root: str | Path, init_time: str) -> Path:
    return output_base_dir(output_root, init_time) / "vortex_warm_core"


def tracks_dir(output_root: str | Path, init_time: str) -> Path:
    return output_base_dir(output_root, init_time) / "vortex_tracks"


def center_json_path(output_root: str | Path, init_time: str, fc_hour: int | str, level: int) -> Path:
    fc_str = format_fc_hour(fc_hour)
    return center_dir(output_root, init_time) / f"vortex_center_{init_time}_{fc_str}_{int(level)}hPa.json"


def warm_json_path(output_root: str | Path, init_time: str, fc_hour: int | str) -> Path:
    fc_str = format_fc_hour(fc_hour)
    return warm_core_dir(output_root, init_time) / f"vortex_warm_core_{init_time}_{fc_str}_850hPa.json"


def track_json_path(output_root: str | Path, init_time: str) -> Path:
    return tracks_dir(output_root, init_time) / f"tc_tracking_results_processed_{init_time}.json"


def write_json(path: str | Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as json_file:
        json.dump(data, json_file, ensure_ascii=False, indent=2)


def read_json(path: str | Path) -> Any:
    with Path(path).open("r", encoding="utf-8") as json_file:
        return json.load(json_file)


def _coord_name(data: xr.DataArray, candidates: tuple[str, ...]) -> str:
    for name in candidates:
        if name in data.coords or name in data.dims:
            return name
    raise VortexDataReadError(f"Missing coordinate; expected one of {candidates}")


def lat_name(data: xr.DataArray) -> str:
    return _coord_name(data, ("lat", "latitude"))


def lon_name(data: xr.DataArray) -> str:
    return _coord_name(data, ("lon", "longitude"))


def normalize_lat_lon(data: xr.DataArray) -> xr.DataArray:
    """Rename latitude/longitude coordinates to ``lat``/``lon`` and sort them."""
    rename_map = {}
    if "latitude" in data.coords or "latitude" in data.dims:
        rename_map["latitude"] = "lat"
    if "longitude" in data.coords or "longitude" in data.dims:
        rename_map["longitude"] = "lon"
    if rename_map:
        data = data.rename(rename_map)
    if "lat" in data.coords:
        data = data.sortby("lat")
    if "lon" in data.coords:
        data = data.sortby("lon")
    return data


def select_area(data: xr.DataArray, area: list[float] | tuple[float, float, float, float]) -> xr.DataArray:
    """Select ``[west, east, south, north]`` from a lat/lon field."""
    data = normalize_lat_lon(data)
    west, east, south, north = [float(value) for value in area]
    lat_values = data["lat"].values
    lat_slice = slice(south, north) if lat_values[0] <= lat_values[-1] else slice(north, south)
    lon_values = data["lon"].values
    lon_slice = slice(west, east) if lon_values[0] <= lon_values[-1] else slice(east, west)
    return data.sel(lat=lat_slice, lon=lon_slice).sortby("lat")


def _pick_variable(dataset: xr.Dataset, base_name: str, fc_hour: int | str | None = None) -> str:
    candidates = [base_name]
    if fc_hour is not None:
        candidates.insert(0, f"{base_name}{format_fc_hour(fc_hour)}")
    for candidate in candidates:
        if candidate in dataset.data_vars:
            return candidate
    if len(dataset.data_vars) == 1:
        return next(iter(dataset.data_vars))
    raise VortexDataReadError(
        f"Cannot find variable {base_name!r}; available variables: {list(dataset.data_vars)}"
    )


def _select_time_level(
    data: xr.DataArray,
    selected_time: str,
    level: int | float | None,
) -> xr.DataArray:
    if "time" in data.coords or "time" in data.dims:
        data = data.sel(time=selected_time)
    if level is not None and ("level" in data.coords or "level" in data.dims):
        data = data.sel(level=float(level))
    elif level is None and ("level" in data.coords or "level" in data.dims):
        data = data.sel(level=0.0)
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
        raise VortexDataNotReadyError(
            "Abnormal weather data detected; data may not be updated yet: "
            + ", ".join(abnormal_items)
        )


def read_tds_field(
    init_time: str,
    fc_hour: int | str,
    file_name: str,
    variable_base: str,
    level: int | float | None,
    area: list[float] | tuple[float, float, float, float],
    source: str = DEFAULT_SOURCE,
    base_url_template: str = BASE_URL_TEMPLATE,
) -> xr.DataArray:
    """Read one forecast field from the TDS NetCDF service."""
    init_dt = parse_init_time(init_time)
    selected_time = init_dt.strftime(DATETIME_FORMAT)
    url = base_url_template.format(
        source=source,
        yyyymm=init_dt.strftime("%Y%m"),
        file_name=file_name,
    )
    try:
        dataset = xr.open_dataset(url)
        var_name = _pick_variable(dataset, variable_base, fc_hour)
        data = _select_time_level(dataset[var_name], selected_time, level)
        data = select_area(data, area)
        validate_data_values({var_name: data})
        return data
    except VortexDataError:
        raise
    except Exception as exc:
        raise VortexDataReadError(
            f"Failed to read TDS field: init_time={init_time}, fc_hour={format_fc_hour(fc_hour)}, "
            f"file={file_name}.nc, variable={variable_base}, level={level}, source={source}"
        ) from exc


def read_wind_pair(
    init_time: str,
    fc_hour: int | str,
    level: int | float,
    area: list[float] | tuple[float, float, float, float],
    source: str = DEFAULT_SOURCE,
) -> tuple[xr.DataArray, xr.DataArray]:
    """Read pressure-level u/v wind fields."""
    uwnd = read_tds_field(init_time, fc_hour, "uwnd", "uwnd", level, area, source=source)
    vwnd = read_tds_field(init_time, fc_hour, "vwnd", "vwnd", level, area, source=source)
    return uwnd, vwnd


def read_surface_wind_pair(
    init_time: str,
    fc_hour: int | str,
    area: list[float] | tuple[float, float, float, float],
    source: str = DEFAULT_SOURCE,
) -> tuple[xr.DataArray, xr.DataArray]:
    """Read 10m u/v wind fields. Surface variables may not be forecast-suffixed."""
    u10m = read_tds_field(init_time, fc_hour, "u10m", "u10m", None, area, source=source)
    v10m = read_tds_field(init_time, fc_hour, "v10m", "v10m", None, area, source=source)
    return u10m, v10m


def read_temperature_fields(
    init_time: str,
    fc_hour: int | str,
    levels: Iterable[int],
    area: list[float] | tuple[float, float, float, float],
    source: str = DEFAULT_SOURCE,
) -> list[xr.DataArray]:
    """Read temperature fields for several pressure levels."""
    return [
        read_tds_field(init_time, fc_hour, "temp", "temp", level, area, source=source)
        for level in levels
    ]
