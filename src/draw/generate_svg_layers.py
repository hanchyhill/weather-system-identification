"""Generate transparent SVG weather layers and a frontend manifest.

The output is organized for the Vue viewer:

    data/products/{init_time}/manifest.json
    data/products/{init_time}/{fc_hour}/{level}/{layer_type}.svg
    data/products/{init_time}/{fc_hour}/surface/{layer_type}.svg
"""

from __future__ import annotations

import argparse
import json
import sys
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
DEFAULT_BOUNDS = (60.0, 180.0, 0.0, 60.0)
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
    "#a5fdfe", "#95deea", "#79c3d3", "#65abbe", "#5393a9",
    "#6fd069", "#ade780", "#fbfbaa", "#f6bc6d", "#f66d4d",
    "#d65144", "#7b342d", "#b449f7", "#cb73ef", "#e7a4fd",
    "#fcdcfe",
]
BOUND_WIND_HIGH = [
    0, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7,
    24.4, 28.4, 32.6, 36.9, 41.0, 50.9, 56.0, 61.2,
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


def open_data_array(
    path_or_url: str,
    variable_candidates: Iterable[str],
    init_time: str,
    level: int | None,
    bounds: Bounds,
) -> xr.DataArray:
    dataset = xr.open_dataset(path_or_url)
    variable = choose_variable(dataset, variable_candidates)
    data = dataset[variable]

    time_name = first_present(data.coords, ("time", "valid_time"))
    if time_name is not None:
        try:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))})
        except Exception:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))}, method="nearest")

    if level is not None:
        level_name = first_present(data.coords, ("level", "lev", "isobaricInhPa", "pressure"))
        if level_name is not None:
            data = data.sel({level_name: level}, method="nearest")

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
            f"No data remains after cropping to bounds {bounds.as_list()} from {path_or_url}"
        )

    return data.squeeze(drop=True)


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


def wind_speed_style(level: int | None) -> tuple[list[float], mcolors.Colormap, mcolors.BoundaryNorm]:
    if level is not None and level <= 500:
        return BOUND_WIND_HIGH, CLRMAP_WIND_HIGH, NORMS_WIND_HIGH
    return BOUND_WIND, CLRMAP_WIND, NORMS_WIND


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


def lon_lat_values(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray(data[coord_name(data, "lon")].values, dtype=float),
        np.asarray(data[coord_name(data, "lat")].values, dtype=float),
    )


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
    hght: xr.DataArray,
    level: int,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    lon, lat = lon_lat_values(hght)
    values = np.asarray(hght.values, dtype=float) / 10.0
    finite = finite_values(values, "Height")
    if level == 500:
        if np.nanmax(finite) > 586:
            ax.contourf(
                lon,
                lat,
                values,
                levels=[586, min(588, np.nanmax(finite))],
                colors=["yellow"],
                alpha=0.5,
                transform=ccrs.PlateCarree(),
            )
        if np.nanmax(finite) > 588:
            ax.contourf(
                lon,
                lat,
                values,
                levels=[588, np.nanmax(finite)],
                colors=["orange"],
                alpha=0.5,
                transform=ccrs.PlateCarree(),
            )
        ax.contour(
            lon,
            lat,
            values,
            levels=np.arange(500, 600, 2),
            colors="black",
            linewidths=0.7,
            transform=ccrs.PlateCarree(),
            zorder=3,
        )
        ax.contour(
            lon,
            lat,
            values,
            levels=[588],
            colors="red",
            linewidths=3,
            transform=ccrs.PlateCarree(),
            zorder=4,
        )
        ax.contour(
            lon,
            lat,
            values,
            levels=[584],
            colors="orange",
            linewidths=2,
            transform=ccrs.PlateCarree(),
            zorder=4,
        )
    else:
        levels = contour_levels_from_data(values, 2)
        ax.contour(
            lon,
            lat,
            values,
            levels=levels,
            colors="black",
            linewidths=0.7,
            transform=ccrs.PlateCarree(),
        )
    save_svg(fig, output_path)


def draw_wind_quiver(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    skip: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.quiver(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        scale=320,
        width=0.0024,
        color="#111827",
    )
    save_svg(fig, output_path)


def draw_wind_barb(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    skip: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.barbs(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        length=6,
        linewidth=0.45,
        barbcolor="blue",
        barb_increments={"half": 2, "full": 4, "flag": 20},
        sizes={"emptybarb": 0},
    )
    save_svg(fig, output_path)


def draw_wind_speed_fill(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    sigma: float,
    level: int | None,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    speed = smooth_array(wind_speed(u, v), sigma)
    lon, lat = lon_lat_values(speed)
    finite_values(speed, "Wind speed")
    levels, cmap, norm = wind_speed_style(level)
    ax.contourf(
        lon,
        lat,
        speed.values,
        levels=levels,
        cmap=cmap,
        norm=norm,
        extend="both",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_wind_streamline(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.streamplot(
        lon,
        lat,
        u_smoothed.values,
        v_smoothed.values,
        density=1.45,
        linewidth=0.55,
        arrowsize=0.65,
        color="#0f172a",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_temp_contour(temp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    temp_c = temperature_celsius(temp)
    lon, lat = lon_lat_values(temp_c)
    finite_values(temp_c, "Temperature")
    ax.contour(
        lon,
        lat,
        temp_c.values,
        levels=BOUND_TEMP,
        cmap=CLRMAP_TEMP,
        norm=NORMS_TEMP,
        linewidths=0.7,
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_vort_fill(vort: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    lon, lat = lon_lat_values(vort)
    values = np.asarray(vort.values, dtype=float) * 100000.0
    finite_values(values, "Vorticity")
    ax.contourf(
        lon,
        lat,
        values,
        levels=BOUND_VORT,
        cmap=CLRMAP_VORT,
        norm=NORMS_VORT,
        extend="both",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_rhum_fill(rhum: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    rhum_pct = relative_humidity_percent(rhum)
    lon, lat = lon_lat_values(rhum_pct)
    finite_values(rhum_pct, "Relative humidity")
    ax.contourf(
        lon,
        lat,
        rhum_pct.values,
        levels=BOUND_RHUM,
        cmap=CLRMAP_RHUM,
        norm=NORMS_RHUM,
        extend="both",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_mslp_contour(mslp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    mslp_values = mslp_hpa(mslp)
    lon, lat = lon_lat_values(mslp_values)
    values = np.asarray(mslp_values.values, dtype=float)
    levels = contour_levels_from_data(values, 2)
    ax.contour(
        lon,
        lat,
        values,
        levels=levels,
        colors="black",
        linewidths=0.75,
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


def ensure_manifest_shape(init_time: str, bounds: Bounds) -> dict[str, object]:
    return {
        "init_time": init_time,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "fc_hours": [],
        "levels": [],
        "layer_types": {
            "upper_air": list(HIGH_LAYER_TYPES),
            "surface": list(SURFACE_LAYER_TYPES),
        },
        "products": {},
    }


def add_manifest_record(manifest: dict[str, object], record: dict[str, object]) -> None:
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


def log_layer_result(fc_hour: str, level: str | int, layer_type: str, status: str, output_path: Path, error: str | None = None) -> None:
    context = f"fc_hour={fc_hour}, level={level}, layer={layer_type}"
    if status == "generated":
        print(f"  Completed SVG: {context}, path={output_path}")
    elif status == "skipped":
        print(f"  Skipped existing SVG: {context}, path={output_path}")
    elif error:
        print(f"  Failed SVG: {context}, error={error}")
    else:
        print(f"  {status.capitalize()} SVG: {context}, path={output_path}")


def generate_upper_air_layers(args, fc_hour: str, level: int, bounds: Bounds, manifest) -> None:
    output_root = Path(args.output)
    layer_dir = output_root / args.init_time / fc_hour / str(level)
    common = {
        "init_time": args.init_time,
        "level": level,
        "bounds": bounds,
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

    wind_fields = None
    for layer_type in HIGH_LAYER_TYPES:
        output_path = layer_dir / f"{layer_type}.svg"
        if args.skip_existing and output_path.exists():
            add_manifest_record(
                manifest,
                product_record(args.init_time, fc_hour, level, layer_type, output_path, output_root, bounds, "skipped"),
            )
            log_layer_result(fc_hour, level, layer_type, "skipped", output_path)
            continue

        try:
            if layer_type == "hght_contour":
                hght = open_data_array(hght_path, hght_candidates, **common)
                draw_hght_contour(hght, level, bounds, output_path, args.dpi)
            elif layer_type == "temp_contour":
                temp = open_data_array(temp_path, temp_candidates, **common)
                draw_temp_contour(temp, bounds, output_path, args.dpi)
            elif layer_type == "vort_fill":
                vort = open_data_array(vort_path, vort_candidates, **common)
                draw_vort_fill(vort, bounds, output_path, args.dpi)
            elif layer_type == "rhum_fill":
                rhum = open_data_array(rhum_path, rhum_candidates, **common)
                draw_rhum_fill(rhum, bounds, output_path, args.dpi)
            else:
                if wind_fields is None:
                    wind_fields = (
                        open_data_array(u_path, u_candidates, **common),
                        open_data_array(v_path, v_candidates, **common),
                    )
                u, v = wind_fields
                if layer_type == "wind_quiver":
                    draw_wind_quiver(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "wind_barb":
                    draw_wind_barb(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "wind_speed_fill":
                    draw_wind_speed_fill(u, v, bounds, output_path, args.dpi, args.sigma, level)
                elif layer_type == "wind_streamline":
                    draw_wind_streamline(u, v, bounds, output_path, args.dpi, args.sigma)

            status = "generated"
            error = None
        except Exception as exc:
            status = "failed"
            error = str(exc)
            log_layer_result(fc_hour, level, layer_type, status, output_path, error)
        else:
            log_layer_result(fc_hour, level, layer_type, status, output_path)

        add_manifest_record(
            manifest,
            product_record(
                args.init_time, fc_hour, level, layer_type, output_path, output_root, bounds, status, error
            ),
        )


def generate_surface_layers(args, fc_hour: str, bounds: Bounds, manifest) -> None:
    output_root = Path(args.output)
    layer_dir = output_root / args.init_time / fc_hour / "surface"
    common = {
        "init_time": args.init_time,
        "level": None,
        "bounds": bounds,
    }
    u_candidates = [args.u10_var.format(fc_hour=fc_hour), f"u10{fc_hour}", "u10", "u"]
    v_candidates = [args.v10_var.format(fc_hour=fc_hour), f"v10{fc_hour}", "v10", "v"]
    mslp_path = default_path(args.mslp_path, args.init_time, args.source, "mslp.nc", args.base_url_template)
    mslp_candidates = [args.mslp_var.format(fc_hour=fc_hour), f"mslp{fc_hour}", "mslp", "msl"]

    wind_fields = None
    for layer_type in SURFACE_LAYER_TYPES:
        output_path = layer_dir / f"{layer_type}.svg"
        if args.skip_existing and output_path.exists():
            add_manifest_record(
                manifest,
                product_record(args.init_time, fc_hour, "surface", layer_type, output_path, output_root, bounds, "skipped"),
            )
            log_layer_result(fc_hour, "surface", layer_type, "skipped", output_path)
            continue

        try:
            if layer_type == "mslp_contour":
                mslp = open_data_array(mslp_path, mslp_candidates, **common)
                draw_mslp_contour(mslp, bounds, output_path, args.dpi)
            else:
                if not args.u10_path or not args.v10_path:
                    raise ValueError("Surface wind layers require --u10-path and --v10-path")
                if wind_fields is None:
                    wind_fields = (
                        open_data_array(args.u10_path, u_candidates, **common),
                        open_data_array(args.v10_path, v_candidates, **common),
                    )
                u, v = wind_fields
                if layer_type == "surface_quiver":
                    draw_wind_quiver(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "surface_barb":
                    draw_wind_barb(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "surface_speed_fill":
                    draw_wind_speed_fill(u, v, bounds, output_path, args.dpi, args.sigma, None)
                elif layer_type == "surface_streamline":
                    draw_wind_streamline(u, v, bounds, output_path, args.dpi, args.sigma)

            status = "generated"
            error = None
        except Exception as exc:
            status = "failed"
            error = str(exc)
            log_layer_result(fc_hour, "surface", layer_type, status, output_path, error)
        else:
            log_layer_result(fc_hour, "surface", layer_type, status, output_path)

        add_manifest_record(
            manifest,
            product_record(
                args.init_time, fc_hour, "surface", layer_type, output_path, output_root, bounds, status, error
            ),
        )


def write_manifest(output_root: Path, init_time: str, manifest: dict[str, object]) -> Path:
    manifest["fc_hours"] = sorted(manifest["fc_hours"])
    manifest["levels"] = sorted(manifest["levels"], key=lambda item: (item == "surface", str(item)))
    manifest_path = output_root / init_time / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


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
    parser.add_argument("--u10-path", help="Local path or URL for 10 m U wind NetCDF.")
    parser.add_argument("--v10-path", help="Local path or URL for 10 m V wind NetCDF.")
    parser.add_argument("--uwnd-var", default="uwnd{fc_hour}")
    parser.add_argument("--vwnd-var", default="vwnd{fc_hour}")
    parser.add_argument("--hght-var", default="hght{fc_hour}")
    parser.add_argument("--temp-var", default="temp{fc_hour}")
    parser.add_argument("--vort-var", default="vort{fc_hour}")
    parser.add_argument("--rhum-var", default="rhum{fc_hour}")
    parser.add_argument("--mslp-var", default="mslp{fc_hour}")
    parser.add_argument("--u10-var", default="u10")
    parser.add_argument("--v10-var", default="v10")
    parser.add_argument("--surface-only", action="store_true", help="Generate only surface layers.")
    parser.add_argument("--upper-only", action="store_true", help="Generate only upper-air layers.")
    parser.add_argument("--skip-existing", action="store_true", help="Reuse existing SVG files.")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--skip", type=int, default=8, help="Vector/barb grid skip.")
    parser.add_argument("--sigma", type=float, default=2.0, help="Gaussian smoothing sigma.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.init_time is None:
        args.init_time = calLatestBaseTime()
    bounds = Bounds(*args.bounds)
    output_root = Path(args.output)
    fc_hours = [format_fc_hour(fc_hour) for fc_hour in args.fc_hours]
    manifest = ensure_manifest_shape(args.init_time, bounds)
    print(
        f"Start SVG layer generation: init_time={args.init_time}, "
        f"fc_hours={len(fc_hours)}, levels={len(args.levels)}"
    )

    for fc_hour in fc_hours:
        if not args.surface_only:
            for level in args.levels:
                generate_upper_air_layers(args, fc_hour, level, bounds, manifest)
        if not args.upper_only:
            generate_surface_layers(args, fc_hour, bounds, manifest)

    manifest_path = write_manifest(output_root, args.init_time, manifest)
    print(f"Wrote manifest: {manifest_path}")


if __name__ == "__main__":
    main()
