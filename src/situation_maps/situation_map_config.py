"""天气形势图产品配方、区域范围与前端对齐的过滤/样式常量。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from draw.svg_layer_config import MULTI_Z_LAYER_TYPES
from draw.svg_layer_geometry import Bounds, iter_tiles, layer_output_path
from weather_common import format_fc_hour
from vortex_common import center_json_path, track_json_path


TROUGH_MIN_WIND_SPEED = 3.0
VORTEX_MIN_VORTICITY = 0.00006
TROUGH_COLOR = "#8B4513"
VORTEX_CENTER_COLOR = "#dc2626"
VORTEX_TRACK_PAST_COLOR = "#6b7280"
VORTEX_TRACK_FUTURE_COLOR = "#f97316"
TRACK_ARROW_FRACTIONS = (0.25, 0.75)
TRACK_ARROW_LINEWIDTH = 1.8  # 原 1.2 的 1.5 倍
TRACK_ARROW_MUTATION_SCALE = 9.0  # matplotlib 默认 6 的 1.5 倍
TRACK_ARROW_LOOKBACK_FRACTION = 0.05

SHEAR_U_TYPES = frozenset({"shear_u_left", "shear_u_right"})
SHEAR_V_TYPES = frozenset({"shear_v_up", "shear_v_down"})

LEVEL_SHEAR_TYPES = {
    200: SHEAR_V_TYPES,
    500: SHEAR_V_TYPES,
    850: SHEAR_U_TYPES,
    925: SHEAR_U_TYPES,
}


@dataclass(frozen=True)
class RegionSpec:
    """固定经纬度出图范围与对应 SVG 瓦片层级。"""

    key: str
    label: str
    bounds: Bounds
    tile_z: int
    barb_skip: int | None = None


@dataclass(frozen=True)
class ProductSpec:
    """单层天气形势图图层与叠加配方。"""

    level: int
    label: str
    svg_layers: tuple[str, ...]
    overlay_trough: bool = True
    overlay_centers: bool = True
    overlay_tracks: bool = False
    wind_speed_colorbar: bool = False
    height_fill_legend: bool = False


REGIONS: dict[str, RegionSpec] = {
    "china": RegionSpec(
        key="china",
        label="中国",
        bounds=Bounds(lon_min=60.0, lon_max=150.0, lat_min=0.0, lat_max=60.0),
        tile_z=0,
    ),
    "huanan": RegionSpec(
        key="huanan",
        label="华南",
        bounds=Bounds(lon_min=100.0, lon_max=125.0, lat_min=15.0, lat_max=30.0),
        tile_z=2,
    ),
    "guangdong": RegionSpec(
        key="guangdong",
        label="广东",
        bounds=Bounds(lon_min=109.0, lon_max=118.0, lat_min=20.0, lat_max=26.0),
        tile_z=2,
        barb_skip=1,
    ),
}

PRODUCTS: dict[int, ProductSpec] = {
    500: ProductSpec(
        level=500,
        label="500hPa天气形势图",
        svg_layers=("hght_contour", "wind_barb"),
        height_fill_legend=True,
    ),
    850: ProductSpec(
        level=850,
        label="850hPa天气形势图",
        svg_layers=("hght_contour", "wind_barb"),
        overlay_tracks=True,
    ),
    925: ProductSpec(
        level=925,
        label="925hPa天气形势图",
        svg_layers=("hght_contour", "wind_barb"),
        overlay_tracks=True,
    ),
    200: ProductSpec(
        level=200,
        label="200hPa天气形势图",
        svg_layers=("wind_speed_fill", "hght_contour", "wind_barb"),
        wind_speed_colorbar=True,
    ),
}

PRODUCT_LEVELS = tuple(PRODUCTS)


THICKEN_CHINA_CONTOUR_LEVELS = frozenset({200, 850, 925})


def tile_zoom_for_layer(layer_type: str, region_z: int) -> int:
    """风羽等多 z 图层用区域 z，其余图层仅有 z=0 全幅瓦片。"""
    if layer_type in MULTI_Z_LAYER_TYPES:
        return int(region_z)
    return 0


def is_fill_layer(layer_type: str, level: int) -> bool:
    """与前端 isFillLayerRecord 对齐：填色层及 500hPa 高度场视为底层。"""
    if str(layer_type).endswith("_fill"):
        return True
    return layer_type == "hght_contour" and int(level) == 500


def should_thicken_height_contours(region_key: str, level: int, layer_type: str) -> bool:
    """中国范围 200/850/925hPa 高度等值线在合成时加粗为约 2 倍线宽。"""
    return (
        layer_type == "hght_contour"
        and region_key == "china"
        and int(level) in THICKEN_CHINA_CONTOUR_LEVELS
    )


def passes_minimum(value, minimum: float) -> bool:
    """与 vis_web passesMinimum 一致：阈值 <= 0 时不过滤。"""
    threshold = float(minimum)
    if threshold <= 0:
        return True
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return False
    return numeric >= threshold


def trough_json_path(output_root: str | Path, init_time: str, fc_hour: int | str, level: int) -> Path:
    fc_str = format_fc_hour(fc_hour)
    return (
        Path(output_root)
        / init_time
        / "trough_data"
        / f"trough_{init_time}_{fc_str}_{int(level)}hPa_ecmwf.json"
    )


def situation_jpg_path(
    output_root: str | Path,
    init_time: str,
    fc_hour: int | str,
    level: int,
    region_key: str,
) -> Path:
    fc_str = format_fc_hour(fc_hour)
    return (
        Path(output_root)
        / init_time
        / "situation_maps"
        / region_key
        / f"{int(level)}hPa_{fc_str}.jpg"
    )


def filter_trough_lines(trough_data: dict | None, level: int) -> list[dict]:
    """按最小平均风速与层次切变类型过滤槽线。"""
    if not trough_data:
        return []
    allowed = LEVEL_SHEAR_TYPES.get(int(level), SHEAR_U_TYPES | SHEAR_V_TYPES)
    visible = []
    for line in trough_data.get("trough_lines") or []:
        if line.get("shear_type") not in allowed:
            continue
        attributes = line.get("attributes") or {}
        if not passes_minimum(attributes.get("avg_wind_speed"), TROUGH_MIN_WIND_SPEED):
            continue
        visible.append(line)
    return visible


def filter_vortex_centers(centers: list | None) -> list[dict]:
    """保留中心涡度达到前端默认阈值的涡旋中心。"""
    visible = []
    for center in centers or []:
        if not passes_minimum(center.get("vort"), VORTEX_MIN_VORTICITY):
            continue
        visible.append(center)
    return visible


def track_step_range(track: dict) -> tuple[float | None, float | None]:
    """轨迹点中最小/最大 step，与 vis_web trackStepRange 一致。"""
    min_step = None
    max_step = None
    for point in track.get("track") or []:
        raw = point.get("step", point.get("fc_hour"))
        try:
            step = float(raw)
        except (TypeError, ValueError):
            continue
        if min_step is None or step < min_step:
            min_step = step
        if max_step is None or step > max_step:
            max_step = step
    return min_step, max_step


def filter_vortex_tracks(tracks_data: dict | None, fc_hour: int | str, warm_only: bool = True) -> list[dict]:
    """仅保留暖心、且当前时效落在轨迹区间内的路径。"""
    if not tracks_data:
        return []
    try:
        current_step = int(format_fc_hour(fc_hour))
    except (TypeError, ValueError):
        return []
    visible = []
    for track in tracks_data.get("tracks") or []:
        if warm_only and not track.get("warm"):
            continue
        init_step, end_step = track_step_range(track)
        if init_step is None or end_step is None:
            continue
        if init_step > current_step or end_step < current_step:
            continue
        visible.append(track)
    return visible


def polyline_point_at_fraction(
    lons: list[float],
    lats: list[float],
    fraction: float,
) -> tuple[float, float] | None:
    """按折线弧长比例取样，fraction=0 为起点、1 为终点。"""
    if len(lons) < 2 or len(lons) != len(lats):
        return None
    cum = [0.0]
    for index in range(1, len(lons)):
        dx = lons[index] - lons[index - 1]
        dy = lats[index] - lats[index - 1]
        cum.append(cum[-1] + (dx * dx + dy * dy) ** 0.5)
    total = cum[-1]
    if total <= 0:
        return None
    target = max(0.0, min(float(fraction), 1.0)) * total
    for index in range(1, len(cum)):
        if cum[index] < target:
            continue
        segment = cum[index] - cum[index - 1]
        t = 0.0 if segment <= 0 else (target - cum[index - 1]) / segment
        return (
            lons[index - 1] + t * (lons[index] - lons[index - 1]),
            lats[index - 1] + t * (lats[index] - lats[index - 1]),
        )
    return lons[-1], lats[-1]


def polyline_arrow_segment(
    lons: list[float],
    lats: list[float],
    fraction: float,
    lookback_fraction: float = TRACK_ARROW_LOOKBACK_FRACTION,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    """返回沿前进方向的 (箭尾, 箭头) 经纬度。"""
    tip = polyline_point_at_fraction(lons, lats, fraction)
    if tip is None:
        return None
    tail_frac = max(0.0, float(fraction) - max(float(lookback_fraction), 1e-6))
    tail = polyline_point_at_fraction(lons, lats, tail_frac)
    if tail is None or tail == tip:
        return None
    return tail, tip


def trough_line_points(line: dict) -> list[tuple[float, float]]:
    """返回槽线 (lon, lat) 点列，优先平滑点。"""
    points = line.get("smoothed_points") or line.get("points") or []
    coords = []
    for point in points:
        try:
            lon = float(point["lon"])
            lat = float(point["lat"])
        except (KeyError, TypeError, ValueError):
            continue
        coords.append((lon, lat))
    return coords


def forecast_bjt_label(init_time: str, fc_hour: int | str) -> str:
    """预报有效时间的北京时，格式如 ``2日08时 BJT``（不含年月）。"""
    init_utc = datetime.strptime(str(init_time), "%Y%m%d%H").replace(tzinfo=timezone.utc)
    valid_utc = init_utc + timedelta(hours=int(format_fc_hour(fc_hour)))
    valid_bjt = valid_utc.astimezone(timezone(timedelta(hours=8)))
    return f"{valid_bjt.day}日{valid_bjt.hour:02d}时 BJT"


def situation_title(init_time: str, fc_hour: int | str, product: ProductSpec, region: RegionSpec) -> str:
    try:
        parsed = datetime.strptime(str(init_time), "%Y%m%d%H")
        init_label = parsed.strftime("%Y-%m-%d %HUTC")
    except ValueError:
        init_label = str(init_time)
    fc_str = format_fc_hour(fc_hour)
    try:
        bjt = forecast_bjt_label(init_time, fc_str)
    except ValueError:
        bjt = ""
    parts = [product.label, region.label, f"起报 {init_label}", f"时效 {fc_str}h"]
    if bjt:
        parts.append(bjt)
    return "  ".join(parts)


def required_svg_paths(
    products_root: Path | str,
    init_time: str,
    fc_hour: int | str,
    product: ProductSpec,
    region: RegionSpec,
) -> list[Path]:
    """某张形势图依赖的全部 SVG 瓦片路径。"""
    products_root = Path(products_root)
    fc_str = format_fc_hour(fc_hour)
    paths: list[Path] = []
    for layer_type in product.svg_layers:
        z = tile_zoom_for_layer(layer_type, region.tile_z)
        for tile in iter_tiles(region.bounds, [z]):
            paths.append(
                layer_output_path(
                    products_root, init_time, fc_str, product.level, layer_type, tile
                )
            )
    return paths


def required_json_paths(
    output_root: Path | str,
    init_time: str,
    fc_hour: int | str,
    product: ProductSpec,
) -> list[Path]:
    """某张形势图依赖的天气系统 JSON。"""
    output_root = Path(output_root)
    fc_str = format_fc_hour(fc_hour)
    paths = [
        trough_json_path(output_root, init_time, fc_str, product.level),
        center_json_path(output_root, init_time, fc_str, product.level),
    ]
    if product.overlay_tracks:
        paths.append(track_json_path(output_root, init_time))
    return paths
