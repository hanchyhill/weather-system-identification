"""Generate transparent SVG weather layers and a frontend manifest.

The output is organized for the Vue viewer:

    data/products/{init_time}/manifest.json
    data/products/{init_time}/{fc_hour}/{level}/{layer_type}/{z}/{x}/{y}.svg
    data/products/{init_time}/{fc_hour}/surface/{layer_type}/{z}/{x}/{y}.svg
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import cartopy.crs as ccrs
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
import xarray as xr
from scipy.ndimage import gaussian_filter

SRC_ROOT = Path(__file__).resolve().parents[1]
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from weather_common import DEFAULT_SOURCE, TIME_STR_LIST_ECMWFTHIN, calLatestBaseTime
from draw.svg_layer_config import MULTI_Z_LAYER_TYPES, TILE_SCHEME, style_for


HIGH_LAYER_TYPES = (
    "hght_contour",
    "wind_quiver",
    "wind_barb",
    "wind_speed_fill",
    "wind_streamline",
    "temp_contour",
    "vort_fill",
    "rhum_fill",
)
SURFACE_LAYER_TYPES = (
    "surface_quiver",
    "surface_barb",
    "surface_speed_fill",
    "surface_streamline",
    "mslp_contour",
)
DEFAULT_LEVELS = (200, 500, 700, 850, 925, 950, 1000)
DEFAULT_BOUNDS = (
    TILE_SCHEME["bounds"]["lon_min"],
    TILE_SCHEME["bounds"]["lon_max"],
    TILE_SCHEME["bounds"]["lat_min"],
    TILE_SCHEME["bounds"]["lat_max"],
)
DEFAULT_BASE_URL_TEMPLATE = "http://10.148.8.71:7080/thredds/dodsC/{source}/"

COLORDICT_WIND = [
    "#ffffff", "#ededed", "#dbdbdb", "#cbcbcb", "#b9b9b9",
    "#5f9fd3", "#7fb3d9", "#9fc7e0", "#bfdbe7", "#c7e5d3",
    "#cff0bf", "#d7fbab", "#f7eb8b", "#f7d884", "#f9c67e",
    "#fab478", "#fba171", "#fb8e6a", "#fd7c64", "#fe695d",
    "#ff5757", "#ebabd7", "#efbadf", "#f3c9e8", "#f7d7f2",
    "#fbe7fb", "#f3c9d3", "#ebacab", "#e38e83",
]
BOUND_WIND = [
    0.0, 3.0, 6.0, 9.0, 9.5, 10, 10.5, 11, 11.5, 12.0,
    12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17,
    17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22,
]
COLORDICT_WIND_HIGH = [
    "#6fd069", "#ade780", "#fbfbaa", "#f6bc6d", "#f66d4d",
    "#d65144", "#7b342d", "#b449f7", "#cb73ef", "#e7a4fd",
    "#fcdcfe",
]
BOUND_WIND_HIGH = [
    12.0, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6, 36.9,
    41.0, 50.9, 56.0, 61.2,
]
TEMP_COLOR_DICT = {
    "red": (
        (0, 0.149019608, 0.149019608),
        (0.0625, 0.047058824, 0.098039216),
        (0.125, 0.392156863, 0.584313725),
        (0.1875, 0.929411765, 0.784313725),
        (0.25, 0.490196078, 0.596078431),
        (0.3125, 0.8, 0.905882353),
        (0.375, 0.258823529, 0),
        (0.4375, 0.007843137, 0.003921569),
        (0.5, 0.023529412, 0),
        (0.5625, 0, 0.011764706),
        (0.625, 0.054901961, 0.97254902),
        (0.6875, 0.996078431, 0.988235294),
        (0.75, 0.992156863, 0.91372549),
        (0.8125, 0.623529412, 0.478431373),
        (0.875, 0.780392157, 0.925490196),
        (0.9375, 0.929411765, 0.988235294),
        (1, 1, 0.980392157),
    ),
    "green": (
        (0, 0.403921569, 0.403921569),
        (0.0625, 0.588235294, 0.690196078),
        (0.125, 0.807843137, 0.635294118),
        (0.1875, 0.266666667, 0.22745098),
        (0.25, 0.243137255, 0.384313725),
        (0.3125, 0.701960784, 0.898039216),
        (0.375, 0.301960784, 0.062745098),
        (0.4375, 0.435294118, 0.580392157),
        (0.5, 0.858823529, 0.207843137),
        (0.5625, 0.462745098, 0.552941176),
        (0.625, 0.819607843, 0.945098039),
        (0.6875, 0.619607843, 0.525490196),
        (0.75, 0.152941176, 0.082352941),
        (0.8125, 0.101960784, 0.082352941),
        (0.875, 0.141176471, 0.28627451),
        (0.9375, 0.517647059, 0.698039216),
        (1, 0.901960784, 0.960784314),
    ),
    "blue": (
        (0, 0.694117647, 0.694117647),
        (0.0625, 0.705882353, 0.780392157),
        (0.125, 0.917647059, 0.952941176),
        (0.1875, 0.894117647, 0.91372549),
        (0.25, 0.847058824, 0.905882353),
        (0.3125, 0.980392157, 1),
        (0.375, 0.890196078, 0.894117647),
        (0.4375, 1, 1),
        (0.5, 0.980392157, 0.011764706),
        (0.5625, 0, 0.011764706),
        (0.625, 0, 0),
        (0.6875, 0, 0),
        (0.75, 0.007843137, 0),
        (0.8125, 0.043137255, 0.478431373),
        (0.875, 0.733333333, 0.843137255),
        (0.9375, 0.890196078, 0.929411765),
        (1, 0.976470588, 0.976470588),
    ),
}
COLOR_ARR_RHUM = [
    [0.541176471, 0.31372549, 0.078431373],
    [0.611764706, 0.380392157, 0.121568627],
    [0.674509804, 0.439215686, 0.160784314],
    [0.745098039, 0.505882353, 0.207843137],
    [0.784313725, 0.584313725, 0.298039216],
    [0.82745098, 0.674509804, 0.403921569],
    [0.866666667, 0.756862745, 0.498039216],
    [0.901960784, 0.811764706, 0.592156863],
    [0.933333333, 0.858823529, 0.674509804],
    [0.964705882, 0.909803922, 0.77254902],
    [0.964705882, 0.925490196, 0.831372549],
    [0.960784314, 0.945098039, 0.894117647],
    [0.956862745, 0.960784314, 0.960784314],
    [0.901960784, 0.960784314, 0.819607843],
    [0.780392157, 0.909803922, 0.635294118],
    [0.647058824, 0.835294118, 0.454901961],
    [0.501960784, 0.737254902, 0.28627451],
    [0.37254902, 0.62745098, 0.203921569],
    [0.254901961, 0.51372549, 0.149019608],
    [0.101960784, 0.207843137, 0.070588235],
]
COLOR_ARR_VORT = [
    [1, 1, 1, 0], [1, 1, 0.164705882], [1, 1, 0.101960784],
    [1, 0.996078431, 0], [1, 0.996078431, 0], [1, 0.952941176, 0],
    [1, 0.921568627, 0], [1, 0.882352941, 0], [1, 0.850980392, 0],
    [1, 0.811764706, 0], [1, 0.768627451, 0], [1, 0.737254902, 0],
    [1, 0.698039216, 0], [1, 0.666666667, 0], [1, 0.623529412, 0],
    [1, 0.596078431, 0], [1, 0.552941176, 0], [1, 0.51372549, 0],
    [1, 0.482352941, 0], [1, 0.439215686, 0], [1, 0.407843137, 0],
    [1, 0.368627451, 0], [1, 0.325490196, 0], [1, 0.298039216, 0],
    [1, 0.254901961, 0], [1, 0.223529412, 0], [1, 0.164705882, 0],
    [1, 0.137254902, 0], [1, 0.109803922, 0], [1, 0.054901961, 0],
    [1, 0, 0], [0.980392157, 0, 0], [0.964705882, 0, 0],
    [0.925490196, 0, 0], [0.882352941, 0, 0], [0.811764706, 0, 0],
    [0.62745098, 0.003921569, 0], [0.596078431, 0.003921569, 0],
    [0.537254902, 0.003921569, 0.003921569], [0.709803922, 0, 0],
    [0.666666667, 0, 0], [0.62745098, 0.003921569, 0],
    [0.596078431, 0.003921569, 0], [0.537254902, 0.003921569, 0.003921569],
    [0.482352941, 0.007843137, 0], [0.482352941, 0.007843137, 0],
    [0.42745098, 0, 0], [0.396078431, 0.003921569, 0],
    [0.37254902, 0.011764706, 0], [0.325490196, 0.007843137, 0],
]

CLRMAP_WIND = mcolors.ListedColormap(COLORDICT_WIND)
NORMS_WIND = mcolors.BoundaryNorm(BOUND_WIND, CLRMAP_WIND.N)
CLRMAP_WIND_HIGH = mcolors.ListedColormap(COLORDICT_WIND_HIGH)
NORMS_WIND_HIGH = mcolors.BoundaryNorm(BOUND_WIND_HIGH, CLRMAP_WIND_HIGH.N)
CLRMAP_TEMP = mcolors.LinearSegmentedColormap("CyanPBGYRPink", TEMP_COLOR_DICT)
CLRMAP_TEMP.set_under("lightblue")
BOUND_TEMP = np.linspace(-40, 40, 81)
NORMS_TEMP = mcolors.BoundaryNorm(BOUND_TEMP, CLRMAP_TEMP.N)
CLRMAP_RHUM = mcolors.ListedColormap(COLOR_ARR_RHUM)
BOUND_RHUM = np.linspace(0, 100, 21)
NORMS_RHUM = mcolors.BoundaryNorm(BOUND_RHUM, CLRMAP_RHUM.N)
CLRMAP_VORT = mcolors.ListedColormap(COLOR_ARR_VORT)
BOUND_VORT = np.linspace(1, 51, 51)
NORMS_VORT = mcolors.BoundaryNorm(BOUND_VORT, CLRMAP_VORT.N)


@dataclass(frozen=True)
class Bounds:
    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float

    def as_list(self) -> list[float]:
        return [self.lon_min, self.lon_max, self.lat_min, self.lat_max]

    def as_dict(self) -> dict[str, float]:
        return {
            "lon_min": self.lon_min,
            "lon_max": self.lon_max,
            "lat_min": self.lat_min,
            "lat_max": self.lat_max,
        }

    def intersects(self, other: "Bounds") -> bool:
        return (
            self.lon_min < other.lon_max
            and self.lon_max > other.lon_min
            and self.lat_min < other.lat_max
            and self.lat_max > other.lat_min
        )


@dataclass(frozen=True)
class Tile:
    z: int
    x: int
    y: int
    bounds: Bounds

    def as_dict(self, path: Path, init_root: Path, status: str = "generated", error: str | None = None) -> dict[str, object]:
        try:
            rel_path = path.relative_to(init_root).as_posix()
        except ValueError:
            rel_path = path.as_posix()

        record: dict[str, object] = {
            "z": self.z,
            "x": self.x,
            "y": self.y,
            "path": rel_path,
            "bounds": self.bounds.as_dict(),
            "status": status,
        }
        if error:
            record["error"] = error
        return record


def tile_scheme_manifest(bounds: Bounds, levels: Iterable[int]) -> dict[str, object]:
    scheme = json.loads(json.dumps(TILE_SCHEME))
    scheme["bounds"] = bounds.as_dict()
    selected_levels = [int(level) for level in levels]
    scheme["levels"] = selected_levels
    scheme["tile_count"] = {
        str(z): matrix_tile_count(z)
        for z in selected_levels
    }
    scheme["generated_tile_count"] = {
        str(z): generated_tile_count(bounds, z)
        for z in selected_levels
    }
    return scheme


def matrix_bounds() -> Bounds:
    values = TILE_SCHEME["matrix_bounds"]
    return Bounds(values["lon_min"], values["lon_max"], values["lat_min"], values["lat_max"])


def tile_size(z: int) -> tuple[float, float]:
    n = 2 ** int(z)
    base_size = TILE_SCHEME["base_tile_size"]
    return base_size["lon"] / n, base_size["lat"] / n


def matrix_tile_count(z: int) -> list[int]:
    lon_size, lat_size = tile_size(z)
    bounds = matrix_bounds()
    return [
        int(round((bounds.lon_max - bounds.lon_min) / lon_size)),
        int(round((bounds.lat_max - bounds.lat_min) / lat_size)),
    ]


def tile_bounds(z: int, x: int, y: int) -> Bounds:
    lon_size, lat_size = tile_size(z)
    bounds = matrix_bounds()
    return Bounds(
        lon_min=bounds.lon_min + x * lon_size,
        lon_max=bounds.lon_min + (x + 1) * lon_size,
        lat_min=bounds.lat_max - (y + 1) * lat_size,
        lat_max=bounds.lat_max - y * lat_size,
    )


def iter_tiles(bounds: Bounds, levels: Iterable[int]) -> list[Tile]:
    epsilon = 1e-9
    matrix = matrix_bounds()
    tiles: list[Tile] = []
    for z in levels:
        lon_size, lat_size = tile_size(z)
        x_count, y_count = matrix_tile_count(z)
        x_min = max(0, int(np.floor((bounds.lon_min - matrix.lon_min) / lon_size)))
        x_max = min(x_count - 1, int(np.ceil((bounds.lon_max - matrix.lon_min) / lon_size - epsilon)) - 1)
        y_min = max(0, int(np.floor((matrix.lat_max - bounds.lat_max) / lat_size)))
        y_max = min(y_count - 1, int(np.ceil((matrix.lat_max - bounds.lat_min) / lat_size - epsilon)) - 1)
        for y in range(y_min, y_max + 1):
            for x in range(x_min, x_max + 1):
                tile = Tile(int(z), x, y, tile_bounds(int(z), x, y))
                if tile.bounds.intersects(bounds):
                    tiles.append(tile)
    return tiles


def tile_levels_for_layer(layer_type: str, requested_levels: Iterable[int]) -> list[int]:
    """Return tile zoom levels that should actually be generated for a layer."""
    if layer_type not in MULTI_Z_LAYER_TYPES:
        return [0]

    requested = {int(level) for level in requested_levels}
    return [level for level in TILE_SCHEME["levels"] if int(level) in requested]


def generated_tile_count(bounds: Bounds, z: int) -> list[int]:
    tiles = [tile for tile in iter_tiles(bounds, [z])]
    if not tiles:
        return [0, 0]
    return [
        len({tile.x for tile in tiles}),
        len({tile.y for tile in tiles}),
    ]


def format_fc_hour(fc_hour: str | int) -> str:
    return str(fc_hour).strip().zfill(3)


def selected_time(init_time: str) -> str:
    return f"{init_time[0:4]}-{init_time[4:6]}-{init_time[6:8]} {init_time[8:10]}:00:00"


def thredds_url(init_time: str, source: str, filename: str, base_url_template: str) -> str:
    return (
        base_url_template.format(source=source).rstrip("/")
        + f"/{init_time[0:6]}/{filename}"
    )


def first_present(names: Iterable[str], candidates: Iterable[str]) -> str | None:
    available = set(names)
    for candidate in candidates:
        if candidate in available:
            return candidate
    return None


def coord_name(data: xr.DataArray, role: str) -> str:
    if role == "lon":
        candidates = ("lon", "longitude", "x")
    elif role == "lat":
        candidates = ("lat", "latitude", "y")
    elif role == "level":
        candidates = ("level", "lev", "isobaricInhPa", "pressure")
    elif role == "time":
        candidates = ("time", "valid_time")
    else:
        raise ValueError(f"Unknown coordinate role: {role}")

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
    raise ValueError(
        "Could not choose variable. Tried "
        + ", ".join(candidates)
        + f"; available variables: {', '.join(dataset.data_vars)}"
    )


class DatasetCache:
    """Process-local xarray dataset cache for one generation worker."""

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
    if cache is None:
        return xr.open_dataset(path_or_url)
    return cache.open(path_or_url)


def select_data_array(
    dataset: xr.Dataset,
    variable_candidates: Iterable[str],
    init_time: str,
    level: int | None,
    bounds: Bounds,
) -> xr.DataArray:
    variable = choose_variable(dataset, variable_candidates)
    data = dataset[variable]

    time_name = first_present(data.coords, ("time", "valid_time"))
    if time_name is not None:
        try:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))})
        except Exception:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))}, method="nearest")

    level_name = first_present(data.coords, ("level", "lev", "isobaricInhPa", "pressure"))
    if level is not None and level_name is not None:
        data = data.sel({level_name: level}, method="nearest")
    elif level is None and level_name is not None:
        try:
            data = data.sel({level_name: 0.0})
        except Exception:
            data = data.sel({level_name: 0.0}, method="nearest")

    lat_name = coord_name(data, "lat")
    lon_name = coord_name(data, "lon")

    data = data.sortby(lat_name).sortby(lon_name)
    data = data.sel(
        {
            lon_name: slice(bounds.lon_min, bounds.lon_max),
            lat_name: slice(bounds.lat_min, bounds.lat_max),
        }
    )

    if data.sizes.get(lat_name, 0) == 0 or data.sizes.get(lon_name, 0) == 0:
        raise ValueError(
            f"No data remains after cropping to bounds {bounds.as_list()}"
        )

    return data.squeeze(drop=True)


def open_data_array(
    path_or_url: str,
    variable_candidates: Iterable[str],
    init_time: str,
    level: int | None,
    bounds: Bounds,
    cache: DatasetCache | None = None,
) -> xr.DataArray:
    dataset = open_dataset_cached(path_or_url, cache)
    try:
        try:
            data = select_data_array(dataset, variable_candidates, init_time, level, bounds)
        except ValueError as exc:
            raise ValueError(f"{exc} from {path_or_url}") from exc
        if cache is None:
            data = data.load()
        return data
    finally:
        if cache is None:
            dataset.close()


def default_path(
    explicit_path: str | None,
    init_time: str,
    source: str,
    filename: str,
    base_url_template: str,
) -> str:
    if explicit_path:
        return explicit_path
    return thredds_url(init_time, source, filename, base_url_template)


def wind_speed(u: xr.DataArray, v: xr.DataArray) -> xr.DataArray:
    return np.sqrt(u**2 + v**2)


def finite_values(data: xr.DataArray | np.ndarray, field_name: str) -> np.ndarray:
    values = np.asarray(data.values if isinstance(data, xr.DataArray) else data, dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise ValueError(f"{field_name} field contains no finite values")
    return finite


def contour_levels_from_data(values: np.ndarray, interval: float) -> np.ndarray:
    finite = finite_values(values, "Contour")
    start = np.floor(np.nanmin(finite) / interval) * interval
    stop = np.ceil(np.nanmax(finite) / interval) * interval + interval
    return np.arange(start, stop, interval)


def wind_speed_style(level: int | None, style: dict[str, object]) -> tuple[list[float], mcolors.Colormap, mcolors.BoundaryNorm, str]:
    threshold = int(style.get("high_level_threshold", 500))
    if level is not None and level <= threshold:
        return BOUND_WIND_HIGH, CLRMAP_WIND_HIGH, NORMS_WIND_HIGH, str(style.get("high_extend", "max"))
    return BOUND_WIND, CLRMAP_WIND, NORMS_WIND, str(style.get("extend", "both"))


def temperature_celsius(temp: xr.DataArray) -> xr.DataArray:
    values = np.asarray(temp.values, dtype=float)
    units = str(temp.attrs.get("units", "")).lower()
    if units in {"k", "kelvin"} or np.nanmedian(values) > 100:
        values = values - 273.15
    return xr.DataArray(values, coords=temp.coords, dims=temp.dims, attrs={**temp.attrs, "units": "degC"})


def relative_humidity_percent(rhum: xr.DataArray) -> xr.DataArray:
    values = np.asarray(rhum.values, dtype=float)
    units = str(rhum.attrs.get("units", "")).strip()
    finite = values[np.isfinite(values)]
    if units == "0.01" and finite.size and np.nanmax(finite) <= 1.5:
        values = values * 100.0
    return xr.DataArray(values, coords=rhum.coords, dims=rhum.dims, attrs={**rhum.attrs, "units": "%"})


def mslp_hpa(mslp: xr.DataArray) -> xr.DataArray:
    values = np.asarray(mslp.values, dtype=float)
    units = str(mslp.attrs.get("units", "")).lower()
    if units == "pa" or np.nanmedian(values) > 2000:
        values = values / 100.0
    return xr.DataArray(values, coords=mslp.coords, dims=mslp.dims, attrs={**mslp.attrs, "units": "hPa"})


def smooth_array(data: xr.DataArray, sigma: float) -> xr.DataArray:
    if sigma <= 0:
        return data
    values = gaussian_filter(np.asarray(data.values, dtype=float), sigma=sigma)
    return xr.DataArray(values, coords=data.coords, dims=data.dims, attrs=data.attrs)


def five_point_smooth(data: xr.DataArray) -> xr.DataArray:
    lat_name = coord_name(data, "lat")
    lon_name = coord_name(data, "lon")
    if lat_name not in data.dims or lon_name not in data.dims:
        return data

    values = np.asarray(data.values, dtype=float)
    if data.sizes[lat_name] < 3 or data.sizes[lon_name] < 3:
        return data

    smoothed = values.copy()
    lat_axis = data.get_axis_num(lat_name)
    lon_axis = data.get_axis_num(lon_name)
    source = np.moveaxis(values, (lat_axis, lon_axis), (-2, -1))
    target = np.moveaxis(smoothed, (lat_axis, lon_axis), (-2, -1))
    stencil = (
        source[..., 1:-1, 1:-1],
        source[..., :-2, 1:-1],
        source[..., 2:, 1:-1],
        source[..., 1:-1, :-2],
        source[..., 1:-1, 2:],
    )
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


def lon_lat_values(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray(data[coord_name(data, "lon")].values, dtype=float),
        np.asarray(data[coord_name(data, "lat")].values, dtype=float),
    )


def crop_to_bounds(data: xr.DataArray, bounds: Bounds, padding: float = 0.0) -> xr.DataArray:
    lat_name = coord_name(data, "lat")
    lon_name = coord_name(data, "lon")
    cropped = data.sel(
        {
            lon_name: slice(bounds.lon_min - padding, bounds.lon_max + padding),
            lat_name: slice(bounds.lat_min - padding, bounds.lat_max + padding),
        }
    )
    if cropped.sizes.get(lat_name, 0) < 2 or cropped.sizes.get(lon_name, 0) < 2:
        return data
    return cropped


def setup_axis(bounds: Bounds, figsize: tuple[float, float], dpi: int):
    fig = plt.figure(figsize=figsize, dpi=dpi)
    ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
    ax.set_extent(bounds.as_list(), crs=ccrs.PlateCarree())
    fig.patch.set_alpha(0)
    ax.patch.set_alpha(0)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_axis_off()
    if "geo" in ax.spines:
        ax.spines["geo"].set_visible(False)
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    return fig, ax


def save_svg(fig, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path,
        bbox_inches="tight",
        format="svg",
        transparent=True,
        pad_inches=0,
    )
    plt.close(fig)


def draw_hght_contour(
    hght_values: xr.DataArray,
    level: int,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(hght_values)
    values = np.asarray(hght_values.values, dtype=float)
    finite = finite_values(values, "Height")
    if level == 500:
        if np.nanmax(finite) > 586:
            ax.contourf(
                lon,
                lat,
                values,
                levels=[586, min(588, np.nanmax(finite))],
                colors=[style["hght_500_fill"][0]["color"]],
                alpha=style["hght_500_fill"][0]["alpha"],
                transform=ccrs.PlateCarree(),
            )
        if np.nanmax(finite) > 588:
            ax.contourf(
                lon,
                lat,
                values,
                levels=[588, np.nanmax(finite)],
                colors=[style["hght_500_fill"][1]["color"]],
                alpha=style["hght_500_fill"][1]["alpha"],
                transform=ccrs.PlateCarree(),
            )
        ax.contour(
            lon,
            lat,
            values,
            levels=np.arange(500, 600, 2),
            colors=style["hght_500_contours"][0]["color"],
            linewidths=style["hght_500_contours"][0]["linewidth"],
            transform=ccrs.PlateCarree(),
            zorder=style["hght_500_contours"][0]["zorder"],
        )
        ax.contour(
            lon,
            lat,
            values,
            levels=[588],
            colors=style["hght_500_contours"][1]["color"],
            linewidths=style["hght_500_contours"][1]["linewidth"],
            transform=ccrs.PlateCarree(),
            zorder=style["hght_500_contours"][1]["zorder"],
        )
        ax.contour(
            lon,
            lat,
            values,
            levels=[584],
            colors=style["hght_500_contours"][2]["color"],
            linewidths=style["hght_500_contours"][2]["linewidth"],
            transform=ccrs.PlateCarree(),
            zorder=style["hght_500_contours"][2]["zorder"],
        )
    else:
        levels = contour_levels_from_data(values, float(style["contour_interval"]))
        ax.contour(
            lon,
            lat,
            values,
            levels=levels,
            colors=style["contour_color"],
            linewidths=style["contour_linewidth"],
            transform=ccrs.PlateCarree(),
        )
    save_svg(fig, output_path)


def draw_wind_quiver(
    u_smoothed: xr.DataArray,
    v_smoothed: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
) -> None:
    skip = int(style["skip"])
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(u_smoothed)
    ax.quiver(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        scale=style["scale"],
        width=style["width"],
        color=style["color"],
    )
    save_svg(fig, output_path)


def draw_wind_barb(
    u_smoothed: xr.DataArray,
    v_smoothed: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
) -> None:
    skip = int(style["skip"])
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(u_smoothed)
    ax.barbs(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        length=style["length"],
        linewidth=style["linewidth"],
        barbcolor=style["barbcolor"],
        barb_increments=style["barb_increments"],
        sizes=style["sizes"],
    )
    save_svg(fig, output_path)


def draw_wind_speed_fill(
    speed: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    level: int | None,
    style: dict[str, object],
) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(speed)
    finite_values(speed, "Wind speed")
    levels, cmap, norm, extend = wind_speed_style(level, style)
    ax.contourf(
        lon,
        lat,
        speed.values,
        levels=levels,
        cmap=cmap,
        norm=norm,
        extend=extend,
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_wind_streamline(
    u_smoothed: xr.DataArray,
    v_smoothed: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(u_smoothed)
    ax.streamplot(
        lon,
        lat,
        u_smoothed.values,
        v_smoothed.values,
        density=style["density"],
        linewidth=style["linewidth"],
        arrowsize=style["arrowsize"],
        color=style["color"],
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_temp_contour(temp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(temp)
    finite_values(temp, "Temperature")
    ax.contour(
        lon,
        lat,
        temp.values,
        levels=BOUND_TEMP,
        cmap=CLRMAP_TEMP,
        norm=NORMS_TEMP,
        linewidths=style["contour_linewidth"],
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_vort_fill(vort: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(vort)
    values = np.asarray(vort.values, dtype=float)
    finite_values(values, "Vorticity")
    ax.contourf(
        lon,
        lat,
        values,
        levels=BOUND_VORT,
        cmap=CLRMAP_VORT,
        norm=NORMS_VORT,
        extend=style["extend"],
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_rhum_fill(rhum: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(rhum)
    finite_values(rhum, "Relative humidity")
    ax.contourf(
        lon,
        lat,
        rhum.values,
        levels=BOUND_RHUM,
        cmap=CLRMAP_RHUM,
        norm=NORMS_RHUM,
        extend=style["extend"],
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_mslp_contour(mslp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(mslp)
    values = np.asarray(mslp.values, dtype=float)
    levels = contour_levels_from_data(values, float(style["contour_interval"]))
    ax.contour(
        lon,
        lat,
        values,
        levels=levels,
        colors=style["contour_color"],
        linewidths=style["contour_linewidth"],
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def product_record(
    init_time: str,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    path: Path,
    output_root: Path,
    bounds: Bounds,
    status: str = "generated",
    error: str | None = None,
) -> dict[str, object]:
    init_root = output_root / init_time
    try:
        rel_path = path.relative_to(init_root).as_posix()
    except ValueError:
        rel_path = path.as_posix()

    record: dict[str, object] = {
        "init_time": init_time,
        "fc_hour": fc_hour,
        "level": level,
        "layer_type": layer_type,
        "path": rel_path,
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "status": status,
    }
    if error:
        record["error"] = error
    return record


def product_tile_record(
    init_time: str,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    output_root: Path,
    bounds: Bounds,
    tiles: Iterable[tuple[Tile, Path, str, str | None]],
    timings: dict[str, float] | None = None,
) -> dict[str, object]:
    init_root = output_root / init_time
    tiles_by_z: dict[str, list[dict[str, object]]] = {}
    status_set: set[str] = set()
    errors: list[str] = []
    for tile, path, status, error in tiles:
        status_set.add(status)
        if error:
            errors.append(f"z={tile.z},x={tile.x},y={tile.y}: {error}")
        tiles_by_z.setdefault(str(tile.z), []).append(
            tile.as_dict(path, init_root, status, error)
        )

    for tile_records in tiles_by_z.values():
        tile_records.sort(key=lambda item: (int(item["y"]), int(item["x"])))

    if "failed" in status_set:
        status = "failed"
    elif status_set == {"skipped"}:
        status = "skipped"
    elif "generated" in status_set:
        status = "generated"
    else:
        status = "missing"

    record: dict[str, object] = {
        "init_time": init_time,
        "fc_hour": fc_hour,
        "level": level,
        "layer_type": layer_type,
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "status": status,
        "tiles": dict(sorted(tiles_by_z.items(), key=lambda item: int(item[0]))),
        "available_tile_levels": sorted(int(z) for z in tiles_by_z),
    }
    if errors:
        record["error"] = "; ".join(errors[:3])
    if timings:
        record["timings"] = timings
    return record


def ensure_manifest_shape(init_time: str, bounds: Bounds) -> dict[str, object]:
    return {
        "init_time": init_time,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "tile_scheme": tile_scheme_manifest(bounds, TILE_SCHEME["levels"]),
        "fc_hours": [],
        "levels": [],
        "layer_types": {
            "upper_air": list(HIGH_LAYER_TYPES),
            "surface": list(SURFACE_LAYER_TYPES),
        },
        "products": {},
    }


def rebuild_manifest_indexes(manifest: dict[str, object]) -> None:
    fc_hours = manifest.get("fc_hours")
    levels = manifest.get("levels")
    products = manifest.get("products")

    if not isinstance(fc_hours, list):
        fc_hours = []
        manifest["fc_hours"] = fc_hours
    if not isinstance(levels, list):
        levels = []
        manifest["levels"] = levels
    if not isinstance(products, dict):
        products = {}
        manifest["products"] = products

    fc_hour_set = {str(fc_hour) for fc_hour in fc_hours}
    level_set = {str(level) for level in levels}
    for fc_hour, levels_by_hour in products.items():
        fc_hour_set.add(str(fc_hour))
        if not isinstance(levels_by_hour, dict):
            continue
        for level in levels_by_hour:
            level_set.add(str(level))

    manifest["fc_hours"] = list(fc_hour_set)
    manifest["levels"] = list(level_set)


def load_manifest(output_root: Path, init_time: str, bounds: Bounds) -> dict[str, object]:
    manifest_path = output_root / init_time / "manifest.json"
    manifest = ensure_manifest_shape(init_time, bounds)
    if not manifest_path.exists():
        return manifest

    try:
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read existing manifest, starting fresh: {manifest_path}, error={exc}")
        return manifest

    if not isinstance(existing_manifest, dict):
        print(f"Existing manifest is not a JSON object, starting fresh: {manifest_path}")
        return manifest

    manifest.update(existing_manifest)
    manifest["init_time"] = init_time
    manifest["bounds"] = bounds.as_dict()
    manifest["projection"] = "PlateCarree"
    manifest["tile_scheme"] = tile_scheme_manifest(bounds, TILE_SCHEME["levels"])
    if not isinstance(manifest.get("layer_types"), dict):
        manifest["layer_types"] = {}
    layer_types = manifest["layer_types"]
    assert isinstance(layer_types, dict)
    layer_types.setdefault("upper_air", list(HIGH_LAYER_TYPES))
    layer_types.setdefault("surface", list(SURFACE_LAYER_TYPES))
    normalize_manifest_tile_levels(manifest)
    rebuild_manifest_indexes(manifest)
    return manifest


def add_manifest_record(manifest: dict[str, object], record: dict[str, object]) -> None:
    normalize_record_tile_levels(record)
    fc_hour = str(record["fc_hour"])
    level = str(record["level"])
    layer_type = str(record["layer_type"])
    products = manifest["products"]
    assert isinstance(products, dict)
    products.setdefault(fc_hour, {}).setdefault(level, {})[layer_type] = record

    fc_hours = manifest["fc_hours"]
    levels = manifest["levels"]
    assert isinstance(fc_hours, list)
    assert isinstance(levels, list)
    if fc_hour not in fc_hours:
        fc_hours.append(fc_hour)
    if level not in levels:
        levels.append(level)


def manifest_has_record(
    manifest: dict[str, object], fc_hour: str, level: str, layer_type: str
) -> bool:
    products = manifest.get("products")
    if not isinstance(products, dict):
        return False
    levels_by_hour = products.get(fc_hour)
    if not isinstance(levels_by_hour, dict):
        return False
    layers_by_level = levels_by_hour.get(level)
    if not isinstance(layers_by_level, dict):
        return False
    return layer_type in layers_by_level


def normalize_record_tile_levels(record: dict[str, object]) -> None:
    tiles = record.get("tiles")
    if not isinstance(tiles, dict):
        return

    layer_type = str(record.get("layer_type", ""))
    allowed_levels = {str(level) for level in tile_levels_for_layer(layer_type, TILE_SCHEME["levels"])}
    record["tiles"] = {
        str(z): tile_records
        for z, tile_records in tiles.items()
        if str(z) in allowed_levels and isinstance(tile_records, list)
    }
    record["available_tile_levels"] = sorted(int(z) for z in record["tiles"])


def normalize_manifest_tile_levels(manifest: dict[str, object]) -> None:
    products = manifest.get("products")
    if not isinstance(products, dict):
        return

    for levels_by_hour in products.values():
        if not isinstance(levels_by_hour, dict):
            continue
        for layers_by_level in levels_by_hour.values():
            if not isinstance(layers_by_level, dict):
                continue
            for record in layers_by_level.values():
                if isinstance(record, dict):
                    normalize_record_tile_levels(record)


def backfill_manifest_from_existing_svgs(
    output_root: Path, init_time: str, bounds: Bounds, manifest: dict[str, object]
) -> int:
    init_root = output_root / init_time
    if not init_root.exists():
        return 0

    backfilled = 0
    for svg_path in init_root.glob("*/*/*.svg"):
        relative_parts = svg_path.relative_to(init_root).parts
        if len(relative_parts) != 3:
            continue

        fc_hour, level, filename = relative_parts
        layer_type = Path(filename).stem
        if manifest_has_record(manifest, fc_hour, level, layer_type):
            continue

        add_manifest_record(
            manifest,
            product_record(
                init_time,
                fc_hour,
                level,
                layer_type,
                svg_path,
                output_root,
                bounds,
                "generated",
            ),
        )
        backfilled += 1

    tile_paths: dict[tuple[str, str, str], list[tuple[Tile, Path, str, str | None]]] = {}
    for svg_path in init_root.glob("*/*/*/*/*/*.svg"):
        relative_parts = svg_path.relative_to(init_root).parts
        if len(relative_parts) != 6:
            continue

        fc_hour, level, layer_type, z_value, x_value, filename = relative_parts
        try:
            z = int(z_value)
            x = int(x_value)
            y = int(Path(filename).stem)
        except ValueError:
            continue

        if z not in tile_levels_for_layer(layer_type, TILE_SCHEME["levels"]):
            continue

        if manifest_has_record(manifest, fc_hour, level, layer_type):
            continue

        tile = Tile(z, x, y, tile_bounds(z, x, y))
        tile_paths.setdefault((fc_hour, level, layer_type), []).append(
            (tile, svg_path, "generated", None)
        )

    for (fc_hour, level, layer_type), tile_records in tile_paths.items():
        add_manifest_record(
            manifest,
            product_tile_record(
                init_time,
                fc_hour,
                level,
                layer_type,
                output_root,
                bounds,
                tile_records,
            ),
        )
        backfilled += 1

    return backfilled


def log_layer_result(
    fc_hour: str,
    level: str | int,
    layer_type: str,
    status: str,
    output_path: Path,
    error: str | None = None,
    tile: Tile | None = None,
) -> None:
    context = f"fc_hour={fc_hour}, level={level}, layer={layer_type}"
    if tile is not None:
        context += f", z={tile.z}, x={tile.x}, y={tile.y}"
    if status == "generated":
        print(f"  Completed SVG: {context}, path={output_path}")
    elif status == "skipped":
        print(f"  Skipped existing SVG: {context}, path={output_path}")
    elif error:
        print(f"  Failed SVG: {context}, error={error}")
    else:
        print(f"  {status.capitalize()} SVG: {context}, path={output_path}")


def tile_output_paths(
    output_root: Path,
    init_time: str,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    tiles: Iterable[Tile],
) -> list[tuple[Tile, Path]]:
    return [
        (tile, layer_output_path(output_root, init_time, fc_hour, level, layer_type, tile))
        for tile in tiles
    ]


def all_tiles_exist(paths: Iterable[tuple[Tile, Path]]) -> bool:
    path_list = list(paths)
    return bool(path_list) and all(path.exists() for _, path in path_list)


def tile_results_with_status(
    paths: Iterable[tuple[Tile, Path]], status: str, error: str | None = None
) -> list[tuple[Tile, Path, str, str | None]]:
    return [(tile, path, status, error) for tile, path in paths]


def count_tile_statuses(tile_results: Iterable[tuple[Tile, Path, str, str | None]]) -> dict[str, int]:
    counts = {"generated": 0, "skipped": 0, "failed": 0, "missing": 0}
    for _, _, status, _ in tile_results:
        counts[status] = counts.get(status, 0) + 1
    return counts


def log_product_result(
    fc_hour: str,
    level: str | int,
    layer_type: str,
    tile_results: list[tuple[Tile, Path, str, str | None]],
    timings: dict[str, float],
) -> None:
    counts = count_tile_statuses(tile_results)
    print(
        "  Layer "
        f"fc_hour={fc_hour}, level={level}, layer={layer_type}: "
        f"generated={counts.get('generated', 0)}, "
        f"skipped={counts.get('skipped', 0)}, "
        f"failed={counts.get('failed', 0)}, "
        f"data={timings.get('data_load_s', 0.0):.2f}s, "
        f"preprocess={timings.get('preprocess_s', 0.0):.2f}s, "
        f"render={timings.get('render_s', 0.0):.2f}s, "
        f"total={timings.get('total_s', 0.0):.2f}s",
        flush=True,
    )


def maybe_log_tile_result(
    args,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    status: str,
    output_path: Path,
    error: str | None = None,
    tile: Tile | None = None,
) -> None:
    if getattr(args, "verbose_tiles", False):
        log_layer_result(fc_hour, level, layer_type, status, output_path, error, tile)


def layer_style(args, layer_type: str, level: int | None, z: int) -> dict[str, object]:
    style = style_for(layer_type, level, z)
    if "skip" not in style:
        style["skip"] = args.skip
    if "sigma" not in style:
        style["sigma"] = args.sigma
    return style


def layer_output_path(output_root: Path, init_time: str, fc_hour: str, level: str | int, layer_type: str, tile: Tile) -> Path:
    return output_root / init_time / fc_hour / str(level) / layer_type / str(tile.z) / str(tile.x) / f"{tile.y}.svg"


def preprocess_upper_air_layer(
    layer_type: str,
    level: int,
    style: dict[str, object],
    fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]],
    preprocessed_cache: dict[tuple[object, ...], object] | None = None,
) -> dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]:
    if preprocessed_cache is None:
        preprocessed_cache = {}
    if layer_type == "hght_contour":
        hght = five_point_smooth(fields["hght"])
        return {"hght": hght / 10.0}
    if layer_type == "temp_contour":
        return {"temp": five_point_smooth(temperature_celsius(fields["temp"]))}
    if layer_type == "vort_fill":
        return {"vort": fields["vort"] * float(style["scale_factor"])}
    if layer_type == "rhum_fill":
        return {"rhum": relative_humidity_percent(fields["rhum"])}
    u, v = fields["wind"]
    if layer_type == "wind_speed_fill":
        key = ("upper_wind_speed", level, float(style["sigma"]))
        if key not in preprocessed_cache:
            preprocessed_cache[key] = smooth_array(wind_speed(u, v), float(style["sigma"]))
        return {"speed": preprocessed_cache[key]}

    key = ("upper_wind_vector", level, float(style["sigma"]))
    if key not in preprocessed_cache:
        preprocessed_cache[key] = (
            smooth_array(u, float(style["sigma"])),
            smooth_array(v, float(style["sigma"])),
        )
    return {"wind": preprocessed_cache[key]}


def preprocess_surface_layer(
    layer_type: str,
    style: dict[str, object],
    fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]],
    preprocessed_cache: dict[tuple[object, ...], object] | None = None,
) -> dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]:
    if preprocessed_cache is None:
        preprocessed_cache = {}
    if layer_type == "mslp_contour":
        return {"mslp": five_point_smooth(mslp_hpa(fields["mslp"]))}
    u, v = fields["wind"]
    if layer_type == "surface_speed_fill":
        key = ("surface_wind_speed", float(style["sigma"]))
        if key not in preprocessed_cache:
            preprocessed_cache[key] = smooth_array(wind_speed(u, v), float(style["sigma"]))
        return {"speed": preprocessed_cache[key]}

    key = ("surface_wind_vector", float(style["sigma"]))
    if key not in preprocessed_cache:
        preprocessed_cache[key] = (
            smooth_array(u, float(style["sigma"])),
            smooth_array(v, float(style["sigma"])),
        )
    return {"wind": preprocessed_cache[key]}


def crop_padding_for_layer(layer_type: str) -> float:
    if layer_type.endswith("_contour") or layer_type.endswith("_fill"):
        return 1.0
    return 0.0


def render_upper_air_tile(
    layer_type: str,
    level: int,
    tile: Tile,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
    fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]],
) -> None:
    padding = crop_padding_for_layer(layer_type)
    if layer_type == "hght_contour":
        draw_hght_contour(crop_to_bounds(fields["hght"], tile.bounds, padding), level, tile.bounds, output_path, dpi, style)
    elif layer_type == "temp_contour":
        draw_temp_contour(crop_to_bounds(fields["temp"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "vort_fill":
        draw_vort_fill(crop_to_bounds(fields["vort"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "rhum_fill":
        draw_rhum_fill(crop_to_bounds(fields["rhum"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "wind_speed_fill":
        draw_wind_speed_fill(crop_to_bounds(fields["speed"], tile.bounds, padding), tile.bounds, output_path, dpi, level, style)
    else:
        u, v = fields["wind"]
        u_tile = crop_to_bounds(u, tile.bounds, padding)
        v_tile = crop_to_bounds(v, tile.bounds, padding)
        if layer_type == "wind_quiver":
            draw_wind_quiver(u_tile, v_tile, tile.bounds, output_path, dpi, style)
        elif layer_type == "wind_barb":
            draw_wind_barb(u_tile, v_tile, tile.bounds, output_path, dpi, style)
        elif layer_type == "wind_streamline":
            draw_wind_streamline(u_tile, v_tile, tile.bounds, output_path, dpi, style)


def render_surface_tile(
    layer_type: str,
    tile: Tile,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
    fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]],
) -> None:
    padding = crop_padding_for_layer(layer_type)
    if layer_type == "mslp_contour":
        draw_mslp_contour(crop_to_bounds(fields["mslp"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "surface_speed_fill":
        draw_wind_speed_fill(crop_to_bounds(fields["speed"], tile.bounds, padding), tile.bounds, output_path, dpi, None, style)
    else:
        u, v = fields["wind"]
        u_tile = crop_to_bounds(u, tile.bounds, padding)
        v_tile = crop_to_bounds(v, tile.bounds, padding)
        if layer_type == "surface_quiver":
            draw_wind_quiver(u_tile, v_tile, tile.bounds, output_path, dpi, style)
        elif layer_type == "surface_barb":
            draw_wind_barb(u_tile, v_tile, tile.bounds, output_path, dpi, style)
        elif layer_type == "surface_streamline":
            draw_wind_streamline(u_tile, v_tile, tile.bounds, output_path, dpi, style)


def generate_upper_air_layers(
    args,
    fc_hour: str,
    level: int,
    bounds: Bounds,
    manifest: dict[str, object] | None = None,
    cache: DatasetCache | None = None,
) -> list[dict[str, object]]:
    output_root = Path(args.output)
    common = {
        "init_time": args.init_time,
        "level": level,
        "bounds": bounds,
        "cache": cache,
    }
    u_path = default_path(args.uwnd_path, args.init_time, args.source, "uwnd.nc", args.base_url_template)
    v_path = default_path(args.vwnd_path, args.init_time, args.source, "vwnd.nc", args.base_url_template)
    hght_path = default_path(args.hght_path, args.init_time, args.source, "hght.nc", args.base_url_template)
    temp_path = default_path(args.temp_path, args.init_time, args.source, "temp.nc", args.base_url_template)
    vort_path = default_path(args.vort_path, args.init_time, args.source, "vort.nc", args.base_url_template)
    rhum_path = default_path(args.rhum_path, args.init_time, args.source, "rhum.nc", args.base_url_template)

    u_candidates = [args.uwnd_var.format(fc_hour=fc_hour), f"uwnd{fc_hour}", "uwnd", "u"]
    v_candidates = [args.vwnd_var.format(fc_hour=fc_hour), f"vwnd{fc_hour}", "vwnd", "v"]
    hght_candidates = [args.hght_var.format(fc_hour=fc_hour), f"hght{fc_hour}", "hght", "z"]
    temp_candidates = [args.temp_var.format(fc_hour=fc_hour), f"temp{fc_hour}", "temp", "t"]
    vort_candidates = [args.vort_var.format(fc_hour=fc_hour), f"vort{fc_hour}", "vort", "vo"]
    rhum_candidates = [args.rhum_var.format(fc_hour=fc_hour), f"rhum{fc_hour}", "rhum", "r"]

    records: list[dict[str, object]] = []
    wind_fields = None
    preprocessed_cache: dict[tuple[object, ...], object] = {}
    for layer_type in HIGH_LAYER_TYPES:
        product_start = time.perf_counter()
        timings = {"data_load_s": 0.0, "preprocess_s": 0.0, "render_s": 0.0}
        tile_results: list[tuple[Tile, Path, str, str | None]] = []
        layer_tile_levels = tile_levels_for_layer(layer_type, args.tile_levels)
        tiles = iter_tiles(bounds, layer_tile_levels)
        output_paths = tile_output_paths(output_root, args.init_time, fc_hour, level, layer_type, tiles)
        if args.skip_existing and all_tiles_exist(output_paths):
            tile_results = tile_results_with_status(output_paths, "skipped")
            timings["total_s"] = time.perf_counter() - product_start
            log_product_result(fc_hour, level, layer_type, tile_results, timings)
            record = product_tile_record(
                args.init_time, fc_hour, level, layer_type, output_root, bounds, tile_results, timings
            )
            records.append(record)
            if manifest is not None:
                add_manifest_record(manifest, record)
            continue

        fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]] = {}

        try:
            data_start = time.perf_counter()
            if layer_type == "hght_contour":
                fields["hght"] = open_data_array(hght_path, hght_candidates, **common)
            elif layer_type == "temp_contour":
                fields["temp"] = open_data_array(temp_path, temp_candidates, **common)
            elif layer_type == "vort_fill":
                fields["vort"] = open_data_array(vort_path, vort_candidates, **common)
            elif layer_type == "rhum_fill":
                fields["rhum"] = open_data_array(rhum_path, rhum_candidates, **common)
            else:
                if wind_fields is None:
                    wind_fields = (
                        open_data_array(u_path, u_candidates, **common),
                        open_data_array(v_path, v_candidates, **common),
                    )
                fields["wind"] = wind_fields
            timings["data_load_s"] = time.perf_counter() - data_start
            preprocess_start = time.perf_counter()
            fields = preprocess_upper_air_layer(
                layer_type,
                level,
                layer_style(args, layer_type, level, min(layer_tile_levels)),
                fields,
                preprocessed_cache,
            )
            timings["preprocess_s"] = time.perf_counter() - preprocess_start
        except Exception as exc:
            error = str(exc)
            tile_results = tile_results_with_status(output_paths, "failed", error)
            for tile, output_path, _, _ in tile_results:
                maybe_log_tile_result(args, fc_hour, level, layer_type, "failed", output_path, error, tile)
        if fields:
            render_start = time.perf_counter()
            for tile, output_path in output_paths:
                if args.skip_existing and output_path.exists():
                    tile_results.append((tile, output_path, "skipped", None))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "skipped", output_path, tile=tile)
                    continue
                try:
                    render_upper_air_tile(
                        layer_type,
                        level,
                        tile,
                        output_path,
                        args.dpi,
                        layer_style(args, layer_type, level, tile.z),
                        fields,
                    )
                except Exception as exc:
                    error = str(exc)
                    tile_results.append((tile, output_path, "failed", error))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "failed", output_path, error, tile)
                else:
                    tile_results.append((tile, output_path, "generated", None))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "generated", output_path, tile=tile)
            timings["render_s"] = time.perf_counter() - render_start

        timings["total_s"] = time.perf_counter() - product_start
        log_product_result(fc_hour, level, layer_type, tile_results, timings)

        record = product_tile_record(
            args.init_time, fc_hour, level, layer_type, output_root, bounds, tile_results, timings
        )
        records.append(record)
        if manifest is not None:
            add_manifest_record(manifest, record)

    return records


def generate_surface_layers(
    args,
    fc_hour: str,
    bounds: Bounds,
    manifest: dict[str, object] | None = None,
    cache: DatasetCache | None = None,
) -> list[dict[str, object]]:
    output_root = Path(args.output)
    common = {
        "init_time": args.init_time,
        "level": None,
        "bounds": bounds,
        "cache": cache,
    }
    u_path = default_path(
        args.u10_path, args.init_time, args.source, "u10m.nc", args.base_url_template
    )
    v_path = default_path(
        args.v10_path, args.init_time, args.source, "v10m.nc", args.base_url_template
    )
    u_candidates = [
        args.u10_var.format(fc_hour=fc_hour),
        f"u10m{fc_hour}",
        "u10m",
        f"u10{fc_hour}",
        "u10",
        "10u",
        "u",
    ]
    v_candidates = [
        args.v10_var.format(fc_hour=fc_hour),
        f"v10m{fc_hour}",
        "v10m",
        f"v10{fc_hour}",
        "v10",
        "10v",
        "v",
    ]
    mslp_path = default_path(args.mslp_path, args.init_time, args.source, "mslp.nc", args.base_url_template)
    mslp_candidates = [args.mslp_var.format(fc_hour=fc_hour), f"mslp{fc_hour}", "mslp", "msl"]

    records: list[dict[str, object]] = []
    wind_fields = None
    preprocessed_cache: dict[tuple[object, ...], object] = {}
    for layer_type in SURFACE_LAYER_TYPES:
        product_start = time.perf_counter()
        timings = {"data_load_s": 0.0, "preprocess_s": 0.0, "render_s": 0.0}
        tile_results: list[tuple[Tile, Path, str, str | None]] = []
        layer_tile_levels = tile_levels_for_layer(layer_type, args.tile_levels)
        tiles = iter_tiles(bounds, layer_tile_levels)
        output_paths = tile_output_paths(output_root, args.init_time, fc_hour, "surface", layer_type, tiles)
        if args.skip_existing and all_tiles_exist(output_paths):
            tile_results = tile_results_with_status(output_paths, "skipped")
            timings["total_s"] = time.perf_counter() - product_start
            log_product_result(fc_hour, "surface", layer_type, tile_results, timings)
            record = product_tile_record(
                args.init_time, fc_hour, "surface", layer_type, output_root, bounds, tile_results, timings
            )
            records.append(record)
            if manifest is not None:
                add_manifest_record(manifest, record)
            continue

        fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]] = {}

        try:
            data_start = time.perf_counter()
            if layer_type == "mslp_contour":
                fields["mslp"] = open_data_array(mslp_path, mslp_candidates, **common)
            else:
                if wind_fields is None:
                    wind_fields = (
                        open_data_array(u_path, u_candidates, **common),
                        open_data_array(v_path, v_candidates, **common),
                    )
                fields["wind"] = wind_fields
            timings["data_load_s"] = time.perf_counter() - data_start
            preprocess_start = time.perf_counter()
            fields = preprocess_surface_layer(
                layer_type,
                layer_style(args, layer_type, None, min(layer_tile_levels)),
                fields,
                preprocessed_cache,
            )
            timings["preprocess_s"] = time.perf_counter() - preprocess_start
        except Exception as exc:
            error = str(exc)
            tile_results = tile_results_with_status(output_paths, "failed", error)
            for tile, output_path, _, _ in tile_results:
                maybe_log_tile_result(args, fc_hour, "surface", layer_type, "failed", output_path, error, tile)
        if fields:
            render_start = time.perf_counter()
            for tile, output_path in output_paths:
                if args.skip_existing and output_path.exists():
                    tile_results.append((tile, output_path, "skipped", None))
                    maybe_log_tile_result(args, fc_hour, "surface", layer_type, "skipped", output_path, tile=tile)
                    continue
                try:
                    render_surface_tile(
                        layer_type,
                        tile,
                        output_path,
                        args.dpi,
                        layer_style(args, layer_type, None, tile.z),
                        fields,
                    )
                except Exception as exc:
                    error = str(exc)
                    tile_results.append((tile, output_path, "failed", error))
                    maybe_log_tile_result(args, fc_hour, "surface", layer_type, "failed", output_path, error, tile)
                else:
                    tile_results.append((tile, output_path, "generated", None))
                    maybe_log_tile_result(args, fc_hour, "surface", layer_type, "generated", output_path, tile=tile)
            timings["render_s"] = time.perf_counter() - render_start

        timings["total_s"] = time.perf_counter() - product_start
        log_product_result(fc_hour, "surface", layer_type, tile_results, timings)

        record = product_tile_record(
            args.init_time, fc_hour, "surface", layer_type, output_root, bounds, tile_results, timings
        )
        records.append(record)
        if manifest is not None:
            add_manifest_record(manifest, record)

    return records


def write_json_atomic(path: Path, payload: dict[str, object]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)
    return path


def write_manifest(output_root: Path, init_time: str, manifest: dict[str, object]) -> Path:
    rebuild_manifest_indexes(manifest)
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    manifest["fc_hours"] = sorted(manifest["fc_hours"])
    manifest["levels"] = sorted(manifest["levels"], key=lambda item: (item == "surface", str(item)))
    manifest_path = output_root / init_time / "manifest.json"
    return write_json_atomic(manifest_path, manifest)


def write_generation_stats(output_root: Path, init_time: str, stats: list[dict[str, object]]) -> Path:
    stats_path = output_root / init_time / "generation_stats.json"
    payload: dict[str, object] = {
        "init_time": init_time,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "jobs": stats,
    }
    return write_json_atomic(stats_path, payload)


def default_worker_count() -> int:
    return max((os.cpu_count() or 1) - 1, 1)


def build_generation_jobs(args, fc_hours: list[str]) -> list[tuple[str, str, int | None]]:
    jobs: list[tuple[str, str, int | None]] = []
    for fc_hour in fc_hours:
        if args.schedule == "fc-hour":
            jobs.append(("fc_hour", fc_hour, None))
            continue
        if not args.surface_only:
            for level in args.levels:
                jobs.append(("upper_air", fc_hour, level))
        if not args.upper_only:
            jobs.append(("surface", fc_hour, None))
    return jobs


def run_generation_job(
    args, bounds: Bounds, job: tuple[str, str, int | None]
) -> dict[str, object]:
    job_start = time.perf_counter()
    cache = DatasetCache()
    layer_group, fc_hour, level = job
    try:
        records: list[dict[str, object]] = []
        if layer_group == "fc_hour":
            if not args.surface_only:
                for selected_level in args.levels:
                    records.extend(generate_upper_air_layers(args, fc_hour, selected_level, bounds, cache=cache))
            if not args.upper_only:
                records.extend(generate_surface_layers(args, fc_hour, bounds, cache=cache))
        elif layer_group == "upper_air":
            assert level is not None
            records = generate_upper_air_layers(args, fc_hour, level, bounds, cache=cache)
        elif layer_group == "surface":
            records = generate_surface_layers(args, fc_hour, bounds, cache=cache)
        else:
            raise ValueError(f"Unknown generation job type: {layer_group}")
        return {
            "job": {"type": layer_group, "fc_hour": fc_hour, "level": level},
            "records": records,
            "total_s": time.perf_counter() - job_start,
        }
    finally:
        cache.close()


def add_manifest_records(manifest: dict[str, object], records: Iterable[dict[str, object]]) -> None:
    for record in records:
        add_manifest_record(manifest, record)


def generation_stats_from_result(result: dict[str, object]) -> dict[str, object]:
    records = result.get("records", [])
    product_stats: list[dict[str, object]] = []
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, dict):
                continue
            product_stats.append(
                {
                    "fc_hour": record.get("fc_hour"),
                    "level": record.get("level"),
                    "layer_type": record.get("layer_type"),
                    "status": record.get("status"),
                    "timings": record.get("timings", {}),
                }
            )
    return {
        "job": result.get("job", {}),
        "total_s": result.get("total_s", 0.0),
        "products": product_stats,
    }


def run_generation_jobs(
    args, fc_hours: list[str], bounds: Bounds, manifest: dict[str, object]
) -> list[dict[str, object]]:
    jobs = build_generation_jobs(args, fc_hours)
    if not jobs:
        return []

    worker_limit = args.workers
    if args.data_workers is not None:
        worker_limit = min(worker_limit, args.data_workers)
    workers = min(worker_limit, len(jobs))
    stats: list[dict[str, object]] = []
    completed_jobs = 0
    if workers <= 1:
        for job in jobs:
            result = run_generation_job(args, bounds, job)
            records = result["records"]
            assert isinstance(records, list)
            add_manifest_records(manifest, records)
            stats.append(generation_stats_from_result(result))
            completed_jobs += 1
            if completed_jobs % args.manifest_checkpoint_interval == 0:
                write_manifest(Path(args.output), args.init_time, manifest)
        return stats

    print(
        f"Using parallel SVG generation workers: {workers}, schedule={args.schedule}",
        flush=True,
    )
    with ProcessPoolExecutor(max_workers=workers) as executor:
        future_to_job = {
            executor.submit(run_generation_job, args, bounds, job): job
            for job in jobs
        }
        for future in as_completed(future_to_job):
            result = future.result()
            records = result["records"]
            assert isinstance(records, list)
            add_manifest_records(manifest, records)
            stats.append(generation_stats_from_result(result))
            completed_jobs += 1
            if completed_jobs % args.manifest_checkpoint_interval == 0:
                write_manifest(Path(args.output), args.init_time, manifest)
    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate transparent SVG weather layers.")
    parser.add_argument(
        "--init-time",
        default=None,
        help="Initial time, e.g. 2026062900. If omitted, use the latest ECMWF base time.",
    )
    parser.add_argument(
        "--fc-hours",
        nargs="+",
        default=TIME_STR_LIST_ECMWFTHIN,
        help="Forecast hours. Defaults to all ECMWFThin forecast hours.",
    )
    parser.add_argument("--levels", nargs="+", type=int, default=list(DEFAULT_LEVELS), help="Pressure levels in hPa.")
    parser.add_argument("--output", default="data/products", help="Output root directory.")
    parser.add_argument("--bounds", nargs=4, type=float, default=list(DEFAULT_BOUNDS), metavar=("LON_MIN", "LON_MAX", "LAT_MIN", "LAT_MAX"))
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="THREDDS source name.")
    parser.add_argument("--base-url-template", default=DEFAULT_BASE_URL_TEMPLATE)
    parser.add_argument("--uwnd-path", help="Local path or URL for upper-air U wind NetCDF.")
    parser.add_argument("--vwnd-path", help="Local path or URL for upper-air V wind NetCDF.")
    parser.add_argument("--hght-path", help="Local path or URL for geopotential height NetCDF.")
    parser.add_argument("--temp-path", help="Local path or URL for upper-air temperature NetCDF.")
    parser.add_argument("--vort-path", help="Local path or URL for upper-air relative vorticity NetCDF.")
    parser.add_argument("--rhum-path", help="Local path or URL for upper-air relative humidity NetCDF.")
    parser.add_argument("--mslp-path", help="Local path or URL for mean sea level pressure NetCDF.")
    parser.add_argument(
        "--u10-path",
        "--u10m-path",
        dest="u10_path",
        help="Local path or URL for 10 m U wind NetCDF.",
    )
    parser.add_argument(
        "--v10-path",
        "--v10m-path",
        dest="v10_path",
        help="Local path or URL for 10 m V wind NetCDF.",
    )
    parser.add_argument("--uwnd-var", default="uwnd{fc_hour}")
    parser.add_argument("--vwnd-var", default="vwnd{fc_hour}")
    parser.add_argument("--hght-var", default="hght{fc_hour}")
    parser.add_argument("--temp-var", default="temp{fc_hour}")
    parser.add_argument("--vort-var", default="vort{fc_hour}")
    parser.add_argument("--rhum-var", default="rhum{fc_hour}")
    parser.add_argument("--mslp-var", default="mslp")
    parser.add_argument("--u10-var", "--u10m-var", dest="u10_var", default="u10m")
    parser.add_argument("--v10-var", "--v10m-var", dest="v10_var", default="v10m")
    parser.add_argument("--surface-only", action="store_true", help="Generate only surface layers.")
    parser.add_argument("--upper-only", action="store_true", help="Generate only upper-air layers.")
    parser.set_defaults(skip_existing=True)
    parser.add_argument(
        "--skip-existing",
        dest="skip_existing",
        action="store_true",
        help="Reuse existing SVG files. This is the default.",
    )
    parser.add_argument(
        "--overwrite",
        dest="skip_existing",
        action="store_false",
        help="Regenerate SVG files even when they already exist.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=default_worker_count(),
        help="Parallel worker process count. Defaults to CPU thread count minus 1.",
    )
    parser.add_argument(
        "--data-workers",
        "--max-remote-workers",
        dest="data_workers",
        type=int,
        default=None,
        help="Maximum concurrent data-reading workers. Defaults to --workers.",
    )
    parser.add_argument(
        "--schedule",
        choices=("fc-hour", "product"),
        default="fc-hour",
        help="Parallel scheduling unit. fc-hour groups all products for one forecast hour in one worker.",
    )
    parser.add_argument(
        "--manifest-checkpoint-interval",
        type=int,
        default=1,
        help="Write manifest.json after every N completed jobs. Defaults to 1.",
    )
    parser.add_argument(
        "--no-backfill",
        action="store_true",
        help="Skip startup scan of existing SVG files and rely on manifest plus expected tile-path checks.",
    )
    parser.add_argument(
        "--verbose-tiles",
        action="store_true",
        help="Print one log line per tile instead of product-level summaries only.",
    )
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--skip", type=int, default=8, help="Vector/barb grid skip.")
    parser.add_argument("--sigma", type=float, default=2.0, help="Gaussian smoothing sigma.")
    parser.add_argument(
        "--tile-levels",
        nargs="+",
        type=int,
        default=list(TILE_SCHEME["levels"]),
        help="Tile zoom levels to generate. Defaults to 0 1 2.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.init_time is None:
        args.init_time = calLatestBaseTime()
    if args.workers < 1:
        raise ValueError("--workers must be at least 1")
    if args.data_workers is not None and args.data_workers < 1:
        raise ValueError("--data-workers must be at least 1")
    if args.manifest_checkpoint_interval < 1:
        raise ValueError("--manifest-checkpoint-interval must be at least 1")
    args.tile_levels = sorted(set(args.tile_levels))
    bounds = Bounds(*args.bounds)
    output_root = Path(args.output)
    fc_hours = [format_fc_hour(fc_hour) for fc_hour in args.fc_hours]
    manifest = load_manifest(output_root, args.init_time, bounds)
    manifest["tile_scheme"] = tile_scheme_manifest(bounds, args.tile_levels)
    if not args.no_backfill:
        backfilled = backfill_manifest_from_existing_svgs(output_root, args.init_time, bounds, manifest)
        if backfilled:
            print(f"Backfilled manifest records from existing SVG files: {backfilled}", flush=True)
    print(
        f"Start SVG layer generation: init_time={args.init_time}, "
        f"fc_hours={len(fc_hours)}, levels={len(args.levels)}, workers={args.workers}, "
        f"schedule={args.schedule}",
        flush=True,
    )

    stats = run_generation_jobs(args, fc_hours, bounds, manifest)

    manifest_path = write_manifest(output_root, args.init_time, manifest)
    print(f"Wrote manifest: {manifest_path}", flush=True)
    stats_path = write_generation_stats(output_root, args.init_time, stats)
    print(f"Wrote generation stats: {stats_path}", flush=True)


if __name__ == "__main__":
    main()
