"""SVG 图层的场预处理与 Matplotlib 渲染。"""

from __future__ import annotations

from pathlib import Path

import cartopy.crs as ccrs
import matplotlib

matplotlib.use("Agg")

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr

from draw.svg_layer_data import (
    coord_name,
    crop_to_bounds,
    five_point_smooth,
    mslp_hpa,
    relative_humidity_percent,
    smooth_array,
    temperature_celsius,
    wind_speed,
)
from draw.svg_layer_geometry import Bounds, Tile


COLORDICT_WIND = ["#ffffff", "#ededed", "#dbdbdb", "#cbcbcb", "#b9b9b9", "#5f9fd3", "#7fb3d9", "#9fc7e0", "#bfdbe7", "#c7e5d3", "#cff0bf", "#d7fbab", "#f7eb8b", "#f7d884", "#f9c67e", "#fab478", "#fba171", "#fb8e6a", "#fd7c64", "#fe695d", "#ff5757", "#ebabd7", "#efbadf", "#f3c9e8", "#f7d7f2", "#fbe7fb", "#f3c9d3", "#ebacab", "#e38e83"]
BOUND_WIND = [0.0, 3.0, 6.0, 9.0, 9.5, 10, 10.5, 11, 11.5, 12.0, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22]
COLORDICT_WIND_HIGH = ["#6fd069", "#ade780", "#fbfbaa", "#f6bc6d", "#f66d4d", "#d65144", "#7b342d", "#b449f7", "#cb73ef", "#e7a4fd", "#fcdcfe"]
BOUND_WIND_HIGH = [12.0, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6, 36.9, 41.0, 50.9, 56.0, 61.2]
TEMP_COLOR_DICT = {
    "red": ((0, .149019608, .149019608), (.0625, .047058824, .098039216), (.125, .392156863, .584313725), (.1875, .929411765, .784313725), (.25, .490196078, .596078431), (.3125, .8, .905882353), (.375, .258823529, 0), (.4375, .007843137, .003921569), (.5, .023529412, 0), (.5625, 0, .011764706), (.625, .054901961, .97254902), (.6875, .996078431, .988235294), (.75, .992156863, .91372549), (.8125, .623529412, .478431373), (.875, .780392157, .925490196), (.9375, .929411765, .988235294), (1, 1, .980392157)),
    "green": ((0, .403921569, .403921569), (.0625, .588235294, .690196078), (.125, .807843137, .635294118), (.1875, .266666667, .22745098), (.25, .243137255, .384313725), (.3125, .701960784, .898039216), (.375, .301960784, .062745098), (.4375, .435294118, .580392157), (.5, .858823529, .207843137), (.5625, .462745098, .552941176), (.625, .819607843, .945098039), (.6875, .619607843, .525490196), (.75, .152941176, .082352941), (.8125, .101960784, .082352941), (.875, .141176471, .28627451), (.9375, .517647059, .698039216), (1, .901960784, .960784314)),
    "blue": ((0, .694117647, .694117647), (.0625, .705882353, .780392157), (.125, .917647647, .952941176), (.1875, .894117647, .91372549), (.25, .847058824, .905882353), (.3125, .980392157, 1), (.375, .890196078, .894117647), (.4375, 1, 1), (.5, .980392157, .011764706), (.5625, 0, .011764706), (.625, 0, 0), (.6875, 0, 0), (.75, .007843137, 0), (.8125, .043137255, .478431373), (.875, .733333333, .843137255), (.9375, .890196078, .929411765), (1, .976470588, .976470588)),
}
COLOR_ARR_RHUM = [[.541176471, .31372549, .078431373], [.611764706, .380392157, .121568627], [.674509804, .439215686, .160784314], [.745098039, .505882353, .207843137], [.784313725, .584313725, .298039216], [.82745098, .674509804, .403921569], [.866666667, .756862745, .498039216], [.901960784, .811764706, .592156863], [.933333333, .858823529, .674509804], [.964705882, .909803922, .77254902], [.964705882, .925490196, .831372549], [.960784314, .945098039, .894117647], [.956862745, .960784314, .960784314], [.901960784, .960784314, .819607843], [.780392157, .909803922, .635294118], [.647058824, .835294118, .454901961], [.501960784, .737254902, .28627451], [.37254902, .62745098, .203921569], [.254901961, .51372549, .149019608], [.101960784, .207843137, .070588235]]
COLOR_ARR_VORT_ORIGINAL = [[1, 1, 1, 0], [1, 1, .164705882], [1, 1, .101960784], [1, .996078431, 0], [1, .996078431, 0], [1, .952941176, 0], [1, .921568627, 0], [1, .882352941, 0], [1, .850980392, 0], [1, .811764706, 0], [1, .768627451, 0], [1, .737254902, 0], [1, .698039216, 0], [1, .666666667, 0], [1, .623529412, 0], [1, .596078431, 0], [1, .552941176, 0], [1, .51372549, 0], [1, .482352941, 0], [1, .439215686, 0], [1, .407843137, 0], [1, .368627451, 0], [1, .325490196, 0], [1, .298039216, 0], [1, .254901961, 0], [1, .223529412, 0], [1, .164705882, 0], [1, .137254902, 0], [1, .109803922, 0], [1, .054901961, 0], [1, 0, 0], [.980392157, 0, 0], [.964705882, 0, 0], [.925490196, 0, 0], [.882352941, 0, 0], [.811764706, 0, 0], [.62745098, .003921569, 0], [.596078431, .003921569, 0], [.537254902, .003921569, .003921569], [.709803922, 0, 0], [.666666667, 0, 0], [.62745098, .003921569, 0], [.596078431, .003921569, 0], [.537254902, .003921569, .003921569], [.482352941, .007843137, 0], [.482352941, .007843137, 0], [.42745098, 0, 0], [.396078431, .003921569, 0], [.37254902, .011764706, 0], [.325490196, .007843137, 0]]
# 低值段（蓝色）只保留 2 档。0.05–0.15 仅跨 0.1，却正好落在噪声主导的近零涡度区，
# 是碎片化最严重的区间：实测 4 档时它单独占 4.0 MB，而 6 档高值段只占 1.6 MB。
# 从原 4 色中取浅、深两色，保留「有弱涡度」到「接近显著」的递进。
VORT_LOW_BAND_COUNT = 2
COLOR_ARR_VORT_LOW = ["#abd9e9", "#4575b4"]
# 高值段去除原色阶中的透明色、重复黄和错序深红，确保黄橙红连续渐变。
COLOR_ARR_VORT_HIGH_BASE = (
    COLOR_ARR_VORT_ORIGINAL[1:4]
    + COLOR_ARR_VORT_ORIGINAL[5:36]
    + COLOR_ARR_VORT_ORIGINAL[39:]
)
# 黄橙红高值段只保留 6 档。涡度是噪声较大的场，色阶越密 contourf 产生的多边形碎片
# 越多：此前 85 档使单块瓦片 SVG 最大达 71 MB，占全部产品体积的 60%，而该图层仅占
# 3.8% 的请求量。6 档在保留黄→橙→红判读能力的同时把体积降一个量级。
VORT_HIGH_BAND_COUNT = 6
COLOR_ARR_VORT_HIGH = mcolors.LinearSegmentedColormap.from_list(
    "vort_yellow_orange_red",
    COLOR_ARR_VORT_HIGH_BASE,
    N=VORT_HIGH_BAND_COUNT,
)(np.linspace(0.0, 1.0, VORT_HIGH_BAND_COUNT)).tolist()
COLOR_ARR_VORT = COLOR_ARR_VORT_LOW + COLOR_ARR_VORT_HIGH
COLORDICT_R24 = ["#a5f18f", "#3cb83e", "#23baff", "#0004fd", "#ff00f2", "#91003d", "#f0d013", "#fe5e00", "#8915da"]
BOUND_R24 = [0.1, 10, 25, 50, 100, 250, 400, 600, 900]
COLORDICT_R1 = ["#a5f18f", "#3cb93c", "#00ffff", "#0000ff", "#ff0000", "#320032", "#fb00fb"]
BOUND_R1 = [1, 10, 20, 30, 50, 80, 100]

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
CLRMAP_VORT.set_under((1.0, 1.0, 1.0, 0.0))
# 低值段 0.05–0.15 分 2 档（0.05 / 0.10 起）；高值段 0.15 起每 0.15 一档，
# 末档 0.9–1.0 略窄以便图例落在 1.0，超出部分由 extend="both" 收进溢出色。
BOUND_VORT = np.concatenate((
    np.linspace(0.05, 0.15, VORT_LOW_BAND_COUNT + 1)[:-1],
    [0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 1.00],
))
NORMS_VORT = mcolors.BoundaryNorm(BOUND_VORT, CLRMAP_VORT.N)
CLRMAP_R24 = mcolors.ListedColormap(COLORDICT_R24)
NORMS_R24 = mcolors.BoundaryNorm(BOUND_R24, CLRMAP_R24.N)
CLRMAP_R1 = mcolors.ListedColormap(COLORDICT_R1)
NORMS_R1 = mcolors.BoundaryNorm(BOUND_R1, CLRMAP_R1.N)


def finite_values(data: xr.DataArray | np.ndarray, field_name: str) -> np.ndarray:
    values = np.asarray(data.values if isinstance(data, xr.DataArray) else data, dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise ValueError(f"{field_name} field contains no finite values")
    return finite


def contour_levels_from_data(values: np.ndarray, interval: float) -> np.ndarray:
    finite = finite_values(values, "Contour")
    return np.arange(np.floor(np.nanmin(finite) / interval) * interval, np.ceil(np.nanmax(finite) / interval) * interval + interval, interval)


def wind_speed_style(level: int | None, style: dict[str, object]) -> tuple[list[float], mcolors.Colormap, mcolors.BoundaryNorm, str]:
    if level is not None and level <= int(style.get("high_level_threshold", 500)):
        return BOUND_WIND_HIGH, CLRMAP_WIND_HIGH, NORMS_WIND_HIGH, str(style.get("high_extend", "max"))
    return BOUND_WIND, CLRMAP_WIND, NORMS_WIND, str(style.get("extend", "both"))


def lon_lat_values(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray]:
    return np.asarray(data[coord_name(data, "lon")].values, dtype=float), np.asarray(data[coord_name(data, "lat")].values, dtype=float)


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
    """写入 SVG 后始终释放 Matplotlib 图形。"""
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, bbox_inches="tight", format="svg", transparent=True, pad_inches=0)
    finally:
        plt.close(fig)


def draw_hght_contour(hght_values: xr.DataArray, level: int, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(hght_values)
    values, finite = np.asarray(hght_values.values, dtype=float), finite_values(hght_values, "Height")
    if level == 500:
        maximum = np.nanmax(finite)
        if maximum > 586:
            ax.contourf(lon, lat, values, levels=[586, min(588, maximum)], colors=[style["hght_500_fill"][0]["color"]], alpha=style["hght_500_fill"][0]["alpha"], transform=ccrs.PlateCarree())
        if maximum > 588:
            ax.contourf(lon, lat, values, levels=[588, maximum], colors=[style["hght_500_fill"][1]["color"]], alpha=style["hght_500_fill"][1]["alpha"], transform=ccrs.PlateCarree())
        for contour in style["hght_500_contours"]:
            levels = np.arange(500, 600, 2) if contour["levels"] == "range_500_600_2" else contour["levels"]
            ax.contour(lon, lat, values, levels=levels, colors=contour["color"], linewidths=contour["linewidth"], transform=ccrs.PlateCarree(), zorder=contour["zorder"])
    else:
        ax.contour(lon, lat, values, levels=contour_levels_from_data(values, float(style["contour_interval"])), colors=style["contour_color"], linewidths=style["contour_linewidth"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def _draw_wind(method: str, u: xr.DataArray, v: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    lon, lat = lon_lat_values(u)
    if method == "quiver":
        skip = int(style["skip"])
        ax.quiver(lon[::skip], lat[::skip], u.values[::skip, ::skip], v.values[::skip, ::skip], transform=ccrs.PlateCarree(), scale=style["scale"], width=style["width"], color=style["color"])
    elif method == "barb":
        skip = int(style["skip"])
        ax.barbs(lon[::skip], lat[::skip], u.values[::skip, ::skip], v.values[::skip, ::skip], transform=ccrs.PlateCarree(), length=style["length"], linewidth=style["linewidth"], barbcolor=style["barbcolor"], barb_increments=style["barb_increments"], sizes=style["sizes"])
    else:
        ax.streamplot(lon, lat, u.values, v.values, density=style["density"], linewidth=style["linewidth"], arrowsize=style["arrowsize"], color=style["color"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def draw_wind_quiver(u: xr.DataArray, v: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    _draw_wind("quiver", u, v, bounds, output_path, dpi, style)


def draw_wind_barb(u: xr.DataArray, v: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    _draw_wind("barb", u, v, bounds, output_path, dpi, style)


def draw_wind_streamline(u: xr.DataArray, v: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    _draw_wind("streamline", u, v, bounds, output_path, dpi, style)


def draw_wind_speed_fill(speed: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, level: int | None, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    finite_values(speed, "Wind speed")
    levels, cmap, norm, extend = wind_speed_style(level, style)
    ax.contourf(*lon_lat_values(speed), speed.values, levels=levels, cmap=cmap, norm=norm, extend=extend, transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def draw_temp_contour(temp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    finite_values(temp, "Temperature")
    ax.contour(*lon_lat_values(temp), temp.values, levels=BOUND_TEMP, cmap=CLRMAP_TEMP, norm=NORMS_TEMP, linewidths=style["contour_linewidth"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def draw_vort_fill(vort: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    finite_values(vort, "Vorticity")
    ax.contourf(*lon_lat_values(vort), vort.values, levels=BOUND_VORT, cmap=CLRMAP_VORT, norm=NORMS_VORT, extend=style["extend"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def draw_rhum_fill(rhum: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    finite_values(rhum, "Relative humidity")
    ax.contourf(*lon_lat_values(rhum), rhum.values, levels=BOUND_RHUM, cmap=CLRMAP_RHUM, norm=NORMS_RHUM, extend=style["extend"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def draw_precipitation_fill(
    precipitation: xr.DataArray,
    accumulation_hours: int,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    style: dict[str, object],
) -> None:
    """以示例脚本同款色标绘制窗口累计降水。"""
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    finite_values(precipitation, "Precipitation")
    if accumulation_hours == 24:
        levels, cmap, norm = BOUND_R24, CLRMAP_R24, NORMS_R24
    else:
        levels, cmap, norm = BOUND_R1, CLRMAP_R1, NORMS_R1
    ax.contourf(
        *lon_lat_values(precipitation),
        precipitation.values,
        levels=levels,
        cmap=cmap,
        norm=norm,
        extend=style.get("extend", "max"),
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_mslp_contour(mslp: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int, style: dict[str, object]) -> None:
    fig, ax = setup_axis(bounds, tuple(style.get("figure_size", (10, 8))), dpi)
    values = np.asarray(mslp.values, dtype=float)
    ax.contour(*lon_lat_values(mslp), values, levels=contour_levels_from_data(values, float(style["contour_interval"])), colors=style["contour_color"], linewidths=style["contour_linewidth"], transform=ccrs.PlateCarree())
    save_svg(fig, output_path)


def preprocess_upper_air_layer(layer_type: str, level: int, style: dict[str, object], fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]], cache: dict[tuple[object, ...], object] | None = None) -> dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]:
    cache = {} if cache is None else cache
    if layer_type == "hght_contour": return {"hght": five_point_smooth(fields["hght"]) / 10.0}
    if layer_type == "temp_contour": return {"temp": five_point_smooth(temperature_celsius(fields["temp"]))}
    if layer_type == "vort_fill": return {"vort": fields["vort"] * float(style["scale_factor"])}
    if layer_type == "rhum_fill": return {"rhum": relative_humidity_percent(fields["rhum"])}
    u, v = fields["wind"]
    key = ("upper_wind_speed" if layer_type == "wind_speed_fill" else "upper_wind_vector", level, float(style["sigma"]))
    if key not in cache:
        cache[key] = smooth_array(wind_speed(u, v), float(style["sigma"])) if layer_type == "wind_speed_fill" else (smooth_array(u, float(style["sigma"])), smooth_array(v, float(style["sigma"])))
    return {"speed" if layer_type == "wind_speed_fill" else "wind": cache[key]}


def preprocess_surface_layer(layer_type: str, style: dict[str, object], fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]], cache: dict[tuple[object, ...], object] | None = None) -> dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]:
    cache = {} if cache is None else cache
    if layer_type == "mslp_contour": return {"mslp": five_point_smooth(mslp_hpa(fields["mslp"]))}
    if layer_type in {"rain_24h_fill", "rain_6h_fill", "rain_3h_fill"}:
        return {"precipitation": fields["precipitation"]}
    u, v = fields["wind"]
    key = ("surface_wind_speed" if layer_type == "surface_speed_fill" else "surface_wind_vector", float(style["sigma"]))
    if key not in cache:
        cache[key] = smooth_array(wind_speed(u, v), float(style["sigma"])) if layer_type == "surface_speed_fill" else (smooth_array(u, float(style["sigma"])), smooth_array(v, float(style["sigma"])))
    return {"speed" if layer_type == "surface_speed_fill" else "wind": cache[key]}


def crop_padding_for_layer(layer_type: str) -> float:
    return 1.0 if layer_type.endswith(("_contour", "_fill")) else 0.0


def render_upper_air_tile(layer_type: str, level: int, tile: Tile, output_path: Path, dpi: int, style: dict[str, object], fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]) -> None:
    padding = crop_padding_for_layer(layer_type)
    if layer_type == "hght_contour": draw_hght_contour(crop_to_bounds(fields["hght"], tile.bounds, padding), level, tile.bounds, output_path, dpi, style)
    elif layer_type == "temp_contour": draw_temp_contour(crop_to_bounds(fields["temp"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "vort_fill": draw_vort_fill(crop_to_bounds(fields["vort"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "rhum_fill": draw_rhum_fill(crop_to_bounds(fields["rhum"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "wind_speed_fill": draw_wind_speed_fill(crop_to_bounds(fields["speed"], tile.bounds, padding), tile.bounds, output_path, dpi, level, style)
    else:
        u, v = fields["wind"]
        renderer = {"wind_quiver": draw_wind_quiver, "wind_barb": draw_wind_barb, "wind_streamline": draw_wind_streamline}[layer_type]
        renderer(crop_to_bounds(u, tile.bounds, padding), crop_to_bounds(v, tile.bounds, padding), tile.bounds, output_path, dpi, style)


def render_surface_tile(layer_type: str, tile: Tile, output_path: Path, dpi: int, style: dict[str, object], fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]]) -> None:
    padding = crop_padding_for_layer(layer_type)
    if layer_type == "mslp_contour": draw_mslp_contour(crop_to_bounds(fields["mslp"], tile.bounds, padding), tile.bounds, output_path, dpi, style)
    elif layer_type == "surface_speed_fill": draw_wind_speed_fill(crop_to_bounds(fields["speed"], tile.bounds, padding), tile.bounds, output_path, dpi, None, style)
    elif layer_type in {"rain_24h_fill", "rain_6h_fill", "rain_3h_fill"}:
        accumulation_hours = int(layer_type.split("_")[1].removesuffix("h"))
        draw_precipitation_fill(crop_to_bounds(fields["precipitation"], tile.bounds, padding), accumulation_hours, tile.bounds, output_path, dpi, style)
    else:
        u, v = fields["wind"]
        renderer = {"surface_quiver": draw_wind_quiver, "surface_barb": draw_wind_barb, "surface_streamline": draw_wind_streamline}[layer_type]
        renderer(crop_to_bounds(u, tile.bounds, padding), crop_to_bounds(v, tile.bounds, padding), tile.bounds, output_path, dpi, style)
