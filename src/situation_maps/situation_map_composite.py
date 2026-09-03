"""将 SVG 瓦片合成为天气形势 JPG，并叠加槽线/涡旋。"""

from __future__ import annotations

import io
from pathlib import Path

import cartopy.crs as ccrs
import matplotlib

matplotlib.use("Agg")

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
from cartopy.mpl.ticker import LatitudeFormatter, LongitudeFormatter
from matplotlib.lines import Line2D

from situation_maps.situation_map_basemap import draw_frontend_basemap
from situation_maps.situation_map_config import (
    PRODUCTS,
    REGIONS,
    TRACK_ARROW_FRACTIONS,
    TRACK_ARROW_LINEWIDTH,
    TRACK_ARROW_MUTATION_SCALE,
    TROUGH_COLOR,
    VORTEX_CENTER_COLOR,
    VORTEX_TRACK_FUTURE_COLOR,
    VORTEX_TRACK_PAST_COLOR,
    ProductSpec,
    RegionSpec,
    filter_trough_lines,
    filter_vortex_centers,
    filter_vortex_tracks,
    is_fill_layer,
    polyline_arrow_segment,
    should_thicken_height_contours,
    situation_title,
    tile_zoom_for_layer,
    trough_json_path,
    trough_line_points,
)
from draw.svg_layer_config import LAYER_STYLES
from draw.svg_layer_data import default_path, open_data_array, smooth_array
from draw.svg_layer_geometry import Bounds, iter_tiles, layer_output_path
from draw.svg_layer_rendering import BOUND_WIND_HIGH, CLRMAP_WIND_HIGH, NORMS_WIND_HIGH, lon_lat_values
from vortex_common import center_json_path, read_json, track_json_path
from weather_common import DEFAULT_SOURCE, format_fc_hour


THREDDS_BASE_URL = "http://10.148.8.71:7080/thredds/dodsC/{source}/"


DEFAULT_DPI = 150
JPG_QUALITY = 92
MAX_SVG_RASTER_WIDTH = 4096


class SvgRasterizeError(RuntimeError):
    """SVG 无法栅格化。"""


def rasterize_svg(path: Path, output_width: int) -> np.ndarray:
    """把透明 SVG 栅格成 RGBA 数组。优先 cairosvg，回退 PyMuPDF。"""
    from PIL import Image

    path = Path(path)
    width = max(32, min(int(output_width), MAX_SVG_RASTER_WIDTH))
    cairo_error = None
    try:
        import cairosvg

        png_bytes = cairosvg.svg2png(url=str(path), output_width=width)
        image = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        return np.asarray(image)
    except Exception as exc:
        cairo_error = exc

    try:
        import fitz

        document = fitz.open(path)
        try:
            page = document[0]
            scale = width / max(page.rect.width, 1.0)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
            image = Image.frombytes("RGBA", (pixmap.width, pixmap.height), pixmap.samples)
            return np.asarray(image)
        finally:
            document.close()
    except Exception as exc:
        detail = f"{exc}"
        if cairo_error is not None:
            detail = f"cairosvg: {cairo_error}; pymupdf: {exc}"
        raise SvgRasterizeError(f"Cannot rasterize SVG {path}: {detail}") from exc


def figure_size_for_bounds(bounds: Bounds, colorbar: bool = False) -> tuple[float, float]:
    """按经纬跨度选择接近气象图比例的画布。"""
    lon_span = max(bounds.lon_max - bounds.lon_min, 1e-6)
    lat_span = max(bounds.lat_max - bounds.lat_min, 1e-6)
    aspect = lon_span / lat_span
    max_width, max_height = 14.5, 10.0
    if aspect >= max_width / max_height:
        width, height = max_width, max_width / aspect
    else:
        width, height = max_height * aspect, max_height
    if colorbar:
        width += 1.4
    return (round(width, 2), round(height, 2))


def pixels_per_degree(bounds: Bounds, figsize: tuple[float, float], dpi: int) -> float:
    lon_span = max(bounds.lon_max - bounds.lon_min, 1e-6)
    return (figsize[0] * dpi) / lon_span


def _layer_zorder(layer_type: str, level: int) -> int:
    if is_fill_layer(layer_type, level):
        return 1
    if "contour" in layer_type:
        return 6
    if "barb" in layer_type:
        return 7
    return 5


def thicken_contour_rgba(rgba: np.ndarray) -> np.ndarray:
    """对等值线栅格做 3×3 膨胀，约把 1 像素描边加粗为 2 倍。"""
    from PIL import Image, ImageFilter

    if rgba.size == 0:
        return rgba
    image = Image.fromarray(rgba)
    return np.asarray(image.filter(ImageFilter.MaxFilter(3)))


def _draw_svg_tiles(
    ax,
    products_root: Path,
    init_time: str,
    fc_hour: str,
    product: ProductSpec,
    region: RegionSpec,
    px_per_deg: float,
    skip_layer_types: set[str] | None = None,
) -> None:
    skip = skip_layer_types or set()
    for layer_type in product.svg_layers:
        if layer_type in skip:
            continue
        z = tile_zoom_for_layer(layer_type, region.tile_z)
        zorder = _layer_zorder(layer_type, product.level)
        for tile in iter_tiles(region.bounds, [z]):
            svg_path = layer_output_path(
                products_root, init_time, fc_hour, product.level, layer_type, tile
            )
            width_px = max(32, int(round((tile.bounds.lon_max - tile.bounds.lon_min) * px_per_deg)))
            rgba = rasterize_svg(svg_path, width_px)
            if should_thicken_height_contours(region.key, product.level, layer_type):
                rgba = thicken_contour_rgba(rgba)
            ax.imshow(
                rgba,
                origin="upper",
                extent=[
                    tile.bounds.lon_min,
                    tile.bounds.lon_max,
                    tile.bounds.lat_min,
                    tile.bounds.lat_max,
                ],
                transform=ccrs.PlateCarree(),
                interpolation="bilinear",
                zorder=zorder,
            )


def _configure_cjk_font() -> str | None:
    """Windows/Linux 上选一个能显示中文的字体。"""
    from matplotlib import font_manager

    for name in ("Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei"):
        try:
            path = font_manager.findfont(name, fallback_to_default=False)
        except Exception:
            continue
        if path and "dejavu" not in path.lower():
            plt.rcParams["font.sans-serif"] = [name, "DejaVu Sans"]
            plt.rcParams["axes.unicode_minus"] = False
            return name
    return None


def _tick_interval(span: float) -> float:
    if span >= 40:
        return 10.0
    if span >= 20:
        return 5.0
    if span >= 8:
        return 2.0
    return 1.0


def _draw_basemap(ax, bounds: Bounds) -> None:
    draw_frontend_basemap(ax)
    ax.gridlines(linewidth=0.4, color="gray", alpha=0.45, linestyle="--", zorder=4)
    lon_step = _tick_interval(bounds.lon_max - bounds.lon_min)
    lat_step = _tick_interval(bounds.lat_max - bounds.lat_min)
    xticks = np.arange(np.ceil(bounds.lon_min / lon_step) * lon_step, bounds.lon_max + 1e-6, lon_step)
    yticks = np.arange(np.ceil(bounds.lat_min / lat_step) * lat_step, bounds.lat_max + 1e-6, lat_step)
    ax.set_xticks(xticks, crs=ccrs.PlateCarree())
    ax.set_yticks(yticks, crs=ccrs.PlateCarree())
    ax.xaxis.set_major_formatter(LongitudeFormatter())
    ax.yaxis.set_major_formatter(LatitudeFormatter())
    ax.tick_params(labelsize=16)


def _load_upper_wind(init_time: str, fc_hour: str, level: int, bounds: Bounds):
    """读取指定层次风场；广东加密风向杆时使用。失败则返回 None。"""
    import socket

    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(25)
    try:
        u_path = default_path(None, init_time, DEFAULT_SOURCE, "uwnd.nc", THREDDS_BASE_URL)
        v_path = default_path(None, init_time, DEFAULT_SOURCE, "vwnd.nc", THREDDS_BASE_URL)
        candidates_u = [f"uwnd{fc_hour}", "uwnd", "u"]
        candidates_v = [f"vwnd{fc_hour}", "vwnd", "v"]
        u = open_data_array(u_path, candidates_u, init_time, int(level), bounds)
        v = open_data_array(v_path, candidates_v, init_time, int(level), bounds)
        return smooth_array(u, 2.0), smooth_array(v, 2.0)
    except Exception:
        return None
    finally:
        socket.setdefaulttimeout(previous)


def _draw_dense_barbs(ax, u, v, skip: int) -> None:
    style = LAYER_STYLES["wind_barb"]
    lon, lat = lon_lat_values(u)
    ax.barbs(
        lon[::skip],
        lat[::skip],
        np.asarray(u.values)[::skip, ::skip],
        np.asarray(v.values)[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        length=style["length"],
        linewidth=style["linewidth"],
        barbcolor=style["barbcolor"],
        barb_increments=style["barb_increments"],
        sizes=style["sizes"],
        zorder=7,
    )


def _draw_troughs(ax, lines: list[dict], linewidth: float) -> None:
    for line in lines:
        coords = trough_line_points(line)
        if len(coords) < 2:
            continue
        lons, lats = zip(*coords)
        ax.plot(
            lons,
            lats,
            color=TROUGH_COLOR,
            linewidth=linewidth,
            solid_capstyle="round",
            solid_joinstyle="round",
            transform=ccrs.PlateCarree(),
            zorder=8,
        )


def _track_point_step(point: dict) -> float | None:
    raw = point.get("step", point.get("fc_hour"))
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _draw_track_arrows(ax, lons: list[float], lats: list[float], color: str) -> None:
    if len(lons) < 2:
        return
    for fraction in TRACK_ARROW_FRACTIONS:
        segment = polyline_arrow_segment(lons, lats, fraction)
        if segment is None:
            continue
        (x0, y0), (x1, y1) = segment
        ax.annotate(
            "",
            xy=(x1, y1),
            xytext=(x0, y0),
            arrowprops={
                "arrowstyle": "-|>",
                "color": color,
                "lw": TRACK_ARROW_LINEWIDTH,
                "mutation_scale": TRACK_ARROW_MUTATION_SCALE,
            },
            transform=ccrs.PlateCarree(),
            zorder=9,
            annotation_clip=True,
        )


def _draw_tracks(ax, tracks: list[dict], fc_hour: str, linewidth: float) -> None:
    current_step = int(fc_hour)
    for track in tracks:
        points = [
            point
            for point in (track.get("track") or [])
            if _finite_lon_lat(point)
        ]
        if len(points) < 2:
            continue
        past = [point for point in points if (_track_point_step(point) or 0) <= current_step]
        future = [point for point in points if (_track_point_step(point) or 0) >= current_step]
        for segment, color in (
            (past, VORTEX_TRACK_PAST_COLOR),
            (future, VORTEX_TRACK_FUTURE_COLOR),
        ):
            if len(segment) < 2:
                continue
            lons = [float(point["lon"]) for point in segment]
            lats = [float(point["lat"]) for point in segment]
            ax.plot(
                lons,
                lats,
                color=color,
                linewidth=linewidth,
                linestyle="-",
                solid_capstyle="round",
                transform=ccrs.PlateCarree(),
                zorder=9,
            )
            _draw_track_arrows(ax, lons, lats, color)


def _finite_lon_lat(point: dict) -> bool:
    try:
        return np.isfinite(float(point["lon"])) and np.isfinite(float(point["lat"]))
    except (KeyError, TypeError, ValueError):
        return False


def _draw_centers(ax, centers: list[dict], fontsize: float) -> None:
    for center in centers:
        try:
            lon = float(center["lon"])
            lat = float(center["lat"])
        except (KeyError, TypeError, ValueError):
            continue
        if not np.isfinite(lon) or not np.isfinite(lat):
            continue
        ax.text(
            lon,
            lat,
            "L",
            color=VORTEX_CENTER_COLOR,
            fontsize=fontsize,
            fontweight="bold",
            ha="center",
            va="center",
            transform=ccrs.PlateCarree(),
            zorder=10,
            clip_on=True,
        )


def _add_legends(fig, ax, product: ProductSpec) -> None:
    handles: list = [
        Line2D([0], [0], color=TROUGH_COLOR, lw=2, label="槽线"),
        Line2D([0], [0], color=VORTEX_CENTER_COLOR, lw=0, marker="$L$", markersize=10, label="涡旋中心"),
    ]
    if product.overlay_tracks:
        handles.extend(
            [
                Line2D([0], [0], color=VORTEX_TRACK_PAST_COLOR, lw=2, label="过去路径"),
                Line2D([0], [0], color=VORTEX_TRACK_FUTURE_COLOR, lw=2, label="未来路径"),
            ]
        )
    if product.height_fill_legend:
        handles.extend(
            [
                mpatches.Patch(facecolor="yellow", alpha=0.5, label="586–588 dagpm"),
                mpatches.Patch(facecolor="orange", alpha=0.5, label="≥588 dagpm"),
            ]
        )
    legend = ax.legend(
        handles=handles,
        loc="lower left",
        fontsize=12,
        framealpha=0.92,
        borderpad=0.5,
        fancybox=False,
        frameon=True,
    )
    legend.set_zorder(30)
    if product.wind_speed_colorbar:
        sm = plt.cm.ScalarMappable(cmap=CLRMAP_WIND_HIGH, norm=NORMS_WIND_HIGH)
        sm.set_array([])
        colorbar = fig.colorbar(sm, ax=ax, shrink=0.72, pad=0.02, extend="max")
        colorbar.set_label("风速 (m/s)", fontsize=13.5)
        colorbar.set_ticks(BOUND_WIND_HIGH)
        colorbar.ax.tick_params(labelsize=7)
        colorbar.ax.set_zorder(30)
        colorbar.ax.patch.set_alpha(1.0)


def _overlay_linewidth(region: RegionSpec) -> tuple[float, float, float]:
    """按范围疏密调整线宽与 L 字号，中国全图略细、广东略粗。"""
    if region.tile_z == 0:
        return 2.25, 1.6, 22.0
    if region.key == "guangdong":
        return 3.0, 2.1, 26.0
    return 2.7, 1.9, 24.0


def render_situation_map(
    *,
    products_root: Path | str,
    output_root: Path | str,
    init_time: str,
    fc_hour: int | str,
    level: int,
    region_key: str,
    output_path: Path | str,
    dpi: int = DEFAULT_DPI,
) -> Path:
    """合成一张天气形势 JPG。调用方须保证所需 SVG/JSON 已就绪。"""
    product = PRODUCTS[int(level)]
    region = REGIONS[region_key]
    products_root = Path(products_root)
    output_root = Path(output_root)
    fc_str = format_fc_hour(fc_hour)
    output_path = Path(output_path)

    figsize = figure_size_for_bounds(region.bounds, colorbar=product.wind_speed_colorbar)
    _configure_cjk_font()
    fig = plt.figure(figsize=figsize, dpi=dpi, facecolor="white")
    try:
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
        ax.set_extent(region.bounds.as_list(), crs=ccrs.PlateCarree())
        ax.set_facecolor("white")
        _draw_basemap(ax, region.bounds)
        skip_svg_barbs = False
        if region.barb_skip:
            wind = _load_upper_wind(init_time, fc_str, product.level, region.bounds)
            if wind is not None:
                skip_svg_barbs = True
                _draw_dense_barbs(ax, wind[0], wind[1], region.barb_skip)
        _draw_svg_tiles(
            ax,
            products_root,
            init_time,
            fc_str,
            product,
            region,
            pixels_per_degree(region.bounds, figsize, dpi),
            skip_layer_types={"wind_barb"} if skip_svg_barbs else None,
        )

        trough_lw, track_lw, center_fs = _overlay_linewidth(region)
        if product.overlay_trough:
            trough_path = trough_json_path(output_root, init_time, fc_str, product.level)
            trough_data = read_json(trough_path) if trough_path.exists() else None
            _draw_troughs(ax, filter_trough_lines(trough_data, product.level), trough_lw)
        if product.overlay_tracks:
            tracks_path = track_json_path(output_root, init_time)
            tracks_data = read_json(tracks_path) if tracks_path.exists() else None
            _draw_tracks(ax, filter_vortex_tracks(tracks_data, fc_str), fc_str, track_lw)
        if product.overlay_centers:
            centers_path = center_json_path(output_root, init_time, fc_str, product.level)
            centers = read_json(centers_path) if centers_path.exists() else []
            _draw_centers(ax, filter_vortex_centers(centers), center_fs)

        ax.set_title(situation_title(init_time, fc_str, product, region), fontsize=24, pad=12)
        _add_legends(fig, ax, product)
        fig.tight_layout()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(
            output_path,
            format="jpeg",
            dpi=dpi,
            bbox_inches="tight",
            facecolor="white",
            pil_kwargs={"quality": JPG_QUALITY, "optimize": True},
        )
    finally:
        plt.close(fig)
    return output_path
