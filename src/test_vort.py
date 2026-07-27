"""针对固定个例调试 500 hPa 相对涡度填色。"""

from __future__ import annotations

from pathlib import Path

import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib

matplotlib.use("Agg")

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np

from draw.svg_layer_data import coord_name, default_path, open_data_array, smooth_array
from draw.svg_layer_geometry import Bounds
from draw.svg_layer_rendering import COLOR_ARR_VORT_HIGH, COLOR_ARR_VORT_LOW
from weather_common import DEFAULT_SOURCE


# 固定个例。若需查看其他预报时效，仅修改 FC_HOURS。
INIT_TIME = "2026072612"
FC_HOURS = ("000",)
TARGET_LEVEL = 500  # hPa
OUTPUT_DIR = Path("demo/vort_debug") / INIT_TIME

# ============================== 涡度填色调参区 ==============================
# 原始相对涡度通常以 s^-1 保存；乘以 100000 后以 10^-5 s^-1 显示。
VORT_SCALE_FACTOR = 100000.0

# 色阶一：0.05 至 0.15，分为四档浅蓝色以区分弱正涡度。
# 小于 0.05 的值（包括负涡度）保持透明。
VORT_LOW_LEVELS = np.linspace(0.05, 0.15, 5)
VORT_LOW_COLORS = COLOR_ARR_VORT_LOW.copy()

# 色阶二：0.15 至 1.0，沿用原 SVG 图层的黄—红色阶。
# 原色阶的首个透明色已移除，以避免蓝色与黄橙色之间出现白色间隔。
VORT_HIGH_LEVELS = np.linspace(0.15, 1.0, len(COLOR_ARR_VORT_HIGH) + 1)
VORT_HIGH_COLORS = COLOR_ARR_VORT_HIGH.copy()

# 合并后的分级边界与颜色。相邻两个边界定义一个填色区间。
VORT_LEVELS = np.concatenate((VORT_LOW_LEVELS[:-1], VORT_HIGH_LEVELS))
VORT_COLORS = VORT_LOW_COLORS + VORT_HIGH_COLORS
VORT_EXTEND = "both"  # "neither"、"min"、"max" 或 "both"
VORT_UNDER_COLOR = (1.0, 1.0, 1.0, 0.0)  # 负涡度保持透明
VORT_OVER_COLOR = None  # 例如 "#67000d"；None 表示沿用末个颜色
VORT_COLORBAR_LABEL = r"Relative vorticity ($10^{-5}\ \mathrm{s}^{-1}$)"
# 每个刻度均落在分级边界上，避免图例刻度线与色块错位。
VORT_COLORBAR_TICKS = np.concatenate((VORT_LOW_LEVELS, np.arange(0.2, 1.01, 0.1)))
TITLE_TEMPLATE = "{init_time} +{fc_hour}h  {level} hPa Relative vorticity"

# 图片外观调参区。
PLOT_BOUNDS = Bounds(60.0, 150.0, 0.0, 60.0)
FIGSIZE = (13, 8)
DPI = 150
DRAW_GRIDLINES = True
DRAW_COASTLINES = True
DRAW_BORDERS = True
MAP_RESOLUTION = "110m"  # "110m"、"50m" 或 "10m"；精度越高，首次可能需下载更多地图数据
MAP_LINE_COLOR = "#374151"
MAP_LINE_WIDTH = 0.6

# 风场叠加调参区。风场使用与 SVG 图层一致的高斯平滑，单位为 m s^-1。
DRAW_WIND = True
WIND_RENDER_MODE = "barbs"  # "barbs" 或 "quiver"
WIND_SMOOTH_SIGMA = 2.0
WIND_SKIP = 8
WIND_COLOR = "#111827"
WIND_BARB_LENGTH = 5.5
WIND_BARB_LINEWIDTH = 0.45
WIND_BARB_INCREMENTS = {"half": 2, "full": 4, "flag": 20}
WIND_QUIVER_SCALE = 320
WIND_QUIVER_WIDTH = 0.0024
WIND_QUIVER_KEY_SPEED = 20

# 数据位置。使用本地 NetCDF 时，将 VORT_PATH 改为文件路径。
VORT_PATH: str | None = None
VORT_VARIABLE_TEMPLATE = "vort{fc_hour}"
UWND_PATH: str | None = None
VWND_PATH: str | None = None
UWND_VARIABLE_TEMPLATE = "uwnd{fc_hour}"
VWND_VARIABLE_TEMPLATE = "vwnd{fc_hour}"
BASE_URL_TEMPLATE = "http://10.148.8.71:7080/thredds/dodsC/{source}/"


def build_vort_colormap() -> tuple[mcolors.ListedColormap, mcolors.BoundaryNorm]:
    """根据文件顶部参数创建与 SVG 图层相同类型的离散色标。"""
    levels = np.asarray(VORT_LEVELS, dtype=float)
    if levels.ndim != 1 or levels.size < 2 or not np.all(np.diff(levels) > 0):
        raise ValueError("VORT_LEVELS 必须是至少包含两个严格递增值的一维数组")
    if len(VORT_COLORS) < levels.size - 1:
        raise ValueError("VORT_COLORS 至少应包含 len(VORT_LEVELS) - 1 个颜色")

    cmap = mcolors.ListedColormap(VORT_COLORS)
    if VORT_UNDER_COLOR is not None:
        cmap.set_under(VORT_UNDER_COLOR)
    if VORT_OVER_COLOR is not None:
        cmap.set_over(VORT_OVER_COLOR)
    return cmap, mcolors.BoundaryNorm(levels, cmap.N)


def load_vorticity(fc_hour: str):
    """读取固定起报时次、时效和 500 hPa 的相对涡度场。"""
    path_or_url = default_path(
        VORT_PATH,
        INIT_TIME,
        DEFAULT_SOURCE,
        "vort.nc",
        BASE_URL_TEMPLATE,
    )
    candidates = (
        VORT_VARIABLE_TEMPLATE.format(fc_hour=fc_hour),
        f"vort{fc_hour}",
        f"vo{fc_hour}",
        "vort",
        "vo",
    )
    return open_data_array(
        path_or_url,
        candidates,
        init_time=INIT_TIME,
        level=TARGET_LEVEL,
        bounds=PLOT_BOUNDS,
    )


def load_wind(fc_hour: str):
    """读取固定个例的 500 hPa U、V 风场。"""
    common = {
        "init_time": INIT_TIME,
        "level": TARGET_LEVEL,
        "bounds": PLOT_BOUNDS,
    }
    u_wind = open_data_array(
        default_path(UWND_PATH, INIT_TIME, DEFAULT_SOURCE, "uwnd.nc", BASE_URL_TEMPLATE),
        (
            UWND_VARIABLE_TEMPLATE.format(fc_hour=fc_hour),
            f"uwnd{fc_hour}",
            f"u{fc_hour}",
            "uwnd",
            "u",
        ),
        **common,
    )
    v_wind = open_data_array(
        default_path(VWND_PATH, INIT_TIME, DEFAULT_SOURCE, "vwnd.nc", BASE_URL_TEMPLATE),
        (
            VWND_VARIABLE_TEMPLATE.format(fc_hour=fc_hour),
            f"vwnd{fc_hour}",
            f"v{fc_hour}",
            "vwnd",
            "v",
        ),
        **common,
    )
    if WIND_SMOOTH_SIGMA > 0:
        u_wind = smooth_array(u_wind, WIND_SMOOTH_SIGMA)
        v_wind = smooth_array(v_wind, WIND_SMOOTH_SIGMA)
    return u_wind, v_wind


def draw_map_features(ax) -> None:
    """叠加定位所需的海岸线和国界。"""
    if DRAW_COASTLINES:
        ax.add_feature(
            cfeature.COASTLINE.with_scale(MAP_RESOLUTION),
            edgecolor=MAP_LINE_COLOR,
            linewidth=MAP_LINE_WIDTH,
            zorder=4,
        )
    if DRAW_BORDERS:
        ax.add_feature(
            cfeature.BORDERS.with_scale(MAP_RESOLUTION),
            edgecolor=MAP_LINE_COLOR,
            linewidth=MAP_LINE_WIDTH,
            zorder=4,
        )


def draw_wind(ax, fc_hour: str) -> None:
    """按顶部配置将平滑后的 500 hPa 风场叠加到当前坐标轴。"""
    if not DRAW_WIND:
        return

    u_wind, v_wind = load_wind(fc_hour)
    lon = np.asarray(u_wind[coord_name(u_wind, "lon")].values, dtype=float)
    lat = np.asarray(u_wind[coord_name(u_wind, "lat")].values, dtype=float)
    skip = max(int(WIND_SKIP), 1)
    u_values = np.asarray(u_wind.values, dtype=float)[::skip, ::skip]
    v_values = np.asarray(v_wind.values, dtype=float)[::skip, ::skip]
    lon, lat = lon[::skip], lat[::skip]

    if WIND_RENDER_MODE == "barbs":
        ax.barbs(
            lon,
            lat,
            u_values,
            v_values,
            length=WIND_BARB_LENGTH,
            linewidth=WIND_BARB_LINEWIDTH,
            barbcolor=WIND_COLOR,
            flagcolor=WIND_COLOR,
            barb_increments=WIND_BARB_INCREMENTS,
            transform=ccrs.PlateCarree(),
            zorder=5,
        )
    elif WIND_RENDER_MODE == "quiver":
        quiver = ax.quiver(
            lon,
            lat,
            u_values,
            v_values,
            color=WIND_COLOR,
            scale=WIND_QUIVER_SCALE,
            width=WIND_QUIVER_WIDTH,
            transform=ccrs.PlateCarree(),
            zorder=5,
        )
        ax.quiverkey(
            quiver,
            0.91,
            1.02,
            WIND_QUIVER_KEY_SPEED,
            f"{WIND_QUIVER_KEY_SPEED} m s$^{{-1}}$",
            labelpos="E",
        )
    else:
        raise ValueError("WIND_RENDER_MODE 仅支持 'barbs' 或 'quiver'")


def plot_vorticity(fc_hour: str) -> Path:
    """读取并输出一张带色标的 500 hPa 涡度调试图。"""
    vort = load_vorticity(fc_hour) * VORT_SCALE_FACTOR
    lon = np.asarray(vort[coord_name(vort, "lon")].values, dtype=float)
    lat = np.asarray(vort[coord_name(vort, "lat")].values, dtype=float)
    values = np.asarray(vort.values, dtype=float)
    cmap, norm = build_vort_colormap()

    fig, ax = plt.subplots(
        figsize=FIGSIZE,
        dpi=DPI,
        subplot_kw={"projection": ccrs.PlateCarree()},
        layout="constrained",
    )
    ax.set_extent(PLOT_BOUNDS.as_list(), crs=ccrs.PlateCarree())
    filled = ax.contourf(
        lon,
        lat,
        values,
        levels=VORT_LEVELS,
        cmap=cmap,
        norm=norm,
        extend=VORT_EXTEND,
        transform=ccrs.PlateCarree(),
    )
    if DRAW_GRIDLINES:
        ax.gridlines(draw_labels=True, x_inline=False, y_inline=False)
    draw_map_features(ax)
    draw_wind(ax, fc_hour)
    colorbar = fig.colorbar(
        filled,
        ax=ax,
        pad=0.02,
        shrink=0.9,
        ticks=VORT_COLORBAR_TICKS,
        spacing="proportional",
    )
    colorbar.set_label(VORT_COLORBAR_LABEL)
    ax.set_title(
        TITLE_TEMPLATE.format(
            init_time=INIT_TIME,
            fc_hour=fc_hour,
            level=TARGET_LEVEL,
        )
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"vort_debug_{INIT_TIME}_{fc_hour}_{TARGET_LEVEL}hPa.png"
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)

    finite = values[np.isfinite(values)]
    print(
        f"输出涡度调试图: {output_path} "
        f"(范围: {finite.min():.2f} 至 {finite.max():.2f} {VORT_COLORBAR_LABEL})"
    )
    return output_path


def run_debug_cases() -> list[Path]:
    """按文件顶部的固定个例配置输出涡度调试图。"""
    return [plot_vorticity(fc_hour) for fc_hour in FC_HOURS]


if __name__ == "__main__":
    run_debug_cases()
