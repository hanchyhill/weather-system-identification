"""针对固定个例调试 500 hPa 相对涡度填色。"""

from __future__ import annotations

from pathlib import Path

import cartopy.crs as ccrs
import matplotlib

matplotlib.use("Agg")

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np

from draw.svg_layer_data import coord_name, default_path, open_data_array
from draw.svg_layer_geometry import Bounds
from draw.svg_layer_rendering import COLOR_ARR_VORT
from weather_common import DEFAULT_SOURCE


# 固定个例。若需查看其他预报时效，仅修改 FC_HOURS。
INIT_TIME = "2026072612"
FC_HOURS = ("000",)
TARGET_LEVEL = 500  # hPa
OUTPUT_DIR = Path("demo/vort_debug") / INIT_TIME

# ============================== 涡度填色调参区 ==============================
# 原始相对涡度通常以 s^-1 保存；乘以 100000 后以 10^-5 s^-1 显示。
VORT_SCALE_FACTOR = 100000.0

# 分级边界。该个例换算后范围约为 -0.5 至 0.9；负涡度保持透明，
# 正涡度按 0 至 1.0 填色。可改为 np.arange(0, 5.1, 0.5) 等。
VORT_LEVELS = np.linspace(0.0, 1.0, 21)

# 颜色数组沿用 SVG 图层；首个透明色与原实现保持一致。
# 可直接替换为自定义的十六进制颜色列表或 RGBA 列表。
VORT_COLORS = COLOR_ARR_VORT.copy()
VORT_EXTEND = "both"  # "neither"、"min"、"max" 或 "both"
VORT_UNDER_COLOR = None  # 例如 "#f0f0f0"；None 表示沿用首个颜色
VORT_OVER_COLOR = None  # 例如 "#67000d"；None 表示沿用末个颜色
VORT_COLORBAR_LABEL = r"Relative vorticity ($10^{-5}\ \mathrm{s}^{-1}$)"
VORT_COLORBAR_TICKS = np.arange(0.0, 1.01, 0.1)
TITLE_TEMPLATE = "{init_time} +{fc_hour}h  {level} hPa Relative vorticity"

# 图片外观调参区。
PLOT_BOUNDS = Bounds(60.0, 150.0, 0.0, 60.0)
FIGSIZE = (13, 8)
DPI = 150
DRAW_GRIDLINES = True
DRAW_COASTLINES = False  # True 时 Cartopy 可能首次下载海岸线数据

# 数据位置。使用本地 NetCDF 时，将 VORT_PATH 改为文件路径。
VORT_PATH: str | None = None
VORT_VARIABLE_TEMPLATE = "vort{fc_hour}"
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
    if DRAW_COASTLINES:
        ax.coastlines(resolution="110m", linewidth=0.6)
    colorbar = fig.colorbar(
        filled,
        ax=ax,
        pad=0.02,
        shrink=0.9,
        ticks=VORT_COLORBAR_TICKS,
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
