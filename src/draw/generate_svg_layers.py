"""SVG 天气图层生成的命令行入口。

实现按职责拆分在 ``svg_layer_geometry``、``svg_layer_data``、
``svg_layer_rendering``、``svg_layer_manifest`` 与 ``svg_layer_workflow``。
本模块保留历史导入路径和命令行接口。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[1]
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from draw.svg_layer_config import TILE_SCHEME
from draw import (
    svg_layer_data as _svg_layer_data,
    svg_layer_geometry as _svg_layer_geometry,
    svg_layer_manifest as _svg_layer_manifest,
    svg_layer_rendering as _svg_layer_rendering,
    svg_layer_workflow as _svg_layer_workflow,
)
from draw.svg_layer_data import format_fc_hour
from draw.svg_layer_geometry import (
    Bounds,
    tile_scheme_manifest,
)
from draw.svg_layer_manifest import (
    backfill_manifest_from_existing_svgs,
    load_manifest,
    write_generation_stats,
    write_manifest,
)
from draw.svg_layer_workflow import (
    HIGH_LAYER_TYPES,
    SURFACE_LAYER_TYPES,
    default_worker_count,
    run_generation_jobs,
)
from weather_common import (
    DEFAULT_SOURCE,
    TIME_STR_LIST_ECMWFTHIN,
    calLatestBaseTime,
    default_output_root,
)

_COMPATIBILITY_MODULES = (
    _svg_layer_data,
    _svg_layer_geometry,
    _svg_layer_manifest,
    _svg_layer_rendering,
    _svg_layer_workflow,
)


def __getattr__(name: str):
    """延迟转发拆分前可从本模块直接导入的辅助对象。"""
    for module in _COMPATIBILITY_MODULES:
        try:
            return getattr(module, name)
        except AttributeError:
            continue
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


DEFAULT_OUTPUT_ROOT = f"{default_output_root()}/products"
DEFAULT_LEVELS = (200, 500, 700, 850, 925, 950, 1000)
DEFAULT_BOUNDS = (
    TILE_SCHEME["bounds"]["lon_min"],
    TILE_SCHEME["bounds"]["lon_max"],
    TILE_SCHEME["bounds"]["lat_min"],
    TILE_SCHEME["bounds"]["lat_max"],
)
DEFAULT_BASE_URL_TEMPLATE = "http://10.148.8.71:7080/thredds/dodsC/{source}/"


def parse_args() -> argparse.Namespace:
    """解析 SVG 图层生成命令行参数。"""
    parser = argparse.ArgumentParser(description="Generate transparent SVG weather layers.")
    parser.add_argument("--init-time", help="Initial time, e.g. 2026062900. Defaults to latest ECMWF base time.")
    parser.add_argument("--fc-hours", nargs="+", default=TIME_STR_LIST_ECMWFTHIN, help="Forecast hours.")
    parser.add_argument("--levels", nargs="+", type=int, default=list(DEFAULT_LEVELS), help="Pressure levels in hPa.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_ROOT, help="Output root directory.")
    parser.add_argument("--bounds", nargs=4, type=float, default=list(DEFAULT_BOUNDS), metavar=("LON_MIN", "LON_MAX", "LAT_MIN", "LAT_MAX"))
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="THREDDS source name.")
    parser.add_argument("--base-url-template", default=DEFAULT_BASE_URL_TEMPLATE)
    for name, description in (("uwnd", "upper-air U wind"), ("vwnd", "upper-air V wind"), ("hght", "geopotential height"), ("temp", "upper-air temperature"), ("vort", "upper-air relative vorticity"), ("rhum", "upper-air relative humidity"), ("mslp", "mean sea level pressure"), ("tppm", "accumulated precipitation")):
        parser.add_argument(f"--{name}-path", help=f"Local path or URL for {description} NetCDF.")
    parser.add_argument("--u10-path", "--u10m-path", dest="u10_path", help="Local path or URL for 10 m U wind NetCDF.")
    parser.add_argument("--v10-path", "--v10m-path", dest="v10_path", help="Local path or URL for 10 m V wind NetCDF.")
    for name, default in (("uwnd", "uwnd{fc_hour}"), ("vwnd", "vwnd{fc_hour}"), ("hght", "hght{fc_hour}"), ("temp", "temp{fc_hour}"), ("vort", "vort{fc_hour}"), ("rhum", "rhum{fc_hour}"), ("mslp", "mslp"), ("tppm", "tppm{fc_hour}")):
        parser.add_argument(f"--{name}-var", default=default)
    parser.add_argument("--u10-var", "--u10m-var", dest="u10_var", default="u10m")
    parser.add_argument("--v10-var", "--v10m-var", dest="v10_var", default="v10m")
    parser.add_argument("--surface-only", action="store_true", help="Generate only surface layers.")
    parser.add_argument("--upper-only", action="store_true", help="Generate only upper-air layers.")
    parser.set_defaults(skip_existing=True)
    parser.add_argument("--skip-existing", dest="skip_existing", action="store_true", help="Reuse existing SVG files (default).")
    parser.add_argument("--overwrite", dest="skip_existing", action="store_false", help="Regenerate existing SVG files.")
    parser.add_argument("--workers", type=int, default=default_worker_count(), help="Parallel worker process count.")
    parser.add_argument("--data-workers", "--max-remote-workers", dest="data_workers", type=int, help="Maximum concurrent data-reading workers.")
    parser.add_argument("--schedule", choices=("fc-hour", "product"), default="fc-hour", help="Parallel scheduling unit.")
    parser.add_argument("--manifest-checkpoint-interval", type=int, default=1, help="Write manifest after every N jobs.")
    parser.add_argument("--no-backfill", action="store_true", help="Skip startup scan of existing SVG files.")
    parser.add_argument("--verbose-tiles", action="store_true", help="Print one log line per tile.")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--skip", type=int, default=8, help="Vector/barb grid skip.")
    parser.add_argument("--sigma", type=float, default=2.0, help="Gaussian smoothing sigma.")
    parser.add_argument("--tile-levels", nargs="+", type=int, default=list(TILE_SCHEME["levels"]), help="Tile zoom levels to generate.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.init_time = args.init_time or calLatestBaseTime()
    if args.workers < 1:
        raise ValueError("--workers must be at least 1")
    if args.data_workers is not None and args.data_workers < 1:
        raise ValueError("--data-workers must be at least 1")
    if args.manifest_checkpoint_interval < 1:
        raise ValueError("--manifest-checkpoint-interval must be at least 1")
    args.tile_levels = sorted(set(args.tile_levels))
    bounds, output_root = Bounds(*args.bounds), Path(args.output)
    fc_hours = [format_fc_hour(fc_hour) for fc_hour in args.fc_hours]
    manifest = load_manifest(output_root, args.init_time, bounds, HIGH_LAYER_TYPES, SURFACE_LAYER_TYPES)
    manifest["tile_scheme"] = tile_scheme_manifest(bounds, args.tile_levels)
    if not args.no_backfill:
        backfilled = backfill_manifest_from_existing_svgs(output_root, args.init_time, bounds, manifest)
        if backfilled:
            print(f"Backfilled manifest records from existing SVG files: {backfilled}", flush=True)
    print(f"Start SVG layer generation: init_time={args.init_time}, fc_hours={len(fc_hours)}, levels={len(args.levels)}, workers={args.workers}, schedule={args.schedule}", flush=True)
    stats = run_generation_jobs(args, fc_hours, bounds, manifest)
    print(f"Wrote manifest: {write_manifest(output_root, args.init_time, manifest)}", flush=True)
    print(f"Wrote generation stats: {write_generation_stats(output_root, args.init_time, stats)}", flush=True)


if __name__ == "__main__":
    main()
