"""独立生成天气形势 JPG：目录变化检测 + 一次性补齐。"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[1]
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from situation_maps.situation_map_config import (  # noqa: E402
    PRODUCT_LEVELS,
    PRODUCTS,
    REGIONS,
    ProductSpec,
    RegionSpec,
    required_json_paths,
    required_svg_paths,
    situation_jpg_path,
)
from weather_common import (  # noqa: E402
    TIME_STR_LIST_ECMWFTHIN,
    calLatestBaseTime,
    default_output_root,
    format_fc_hour,
)


INIT_TIME_RE = re.compile(r"^\d{10}$")
DEFAULT_POLL_INTERVAL = 30.0
DEFAULT_DEBOUNCE_S = 15.0
DEFAULT_DPI = 150


@dataclass(frozen=True)
class SituationJob:
    init_time: str
    fc_hour: str
    level: int
    region_key: str

    @property
    def product(self) -> ProductSpec:
        return PRODUCTS[self.level]

    @property
    def region(self) -> RegionSpec:
        return REGIONS[self.region_key]


def _log(message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def resolve_output_root(cli_value: str | None = None) -> Path:
    if cli_value:
        return Path(cli_value)
    env = os.environ.get("WEATHER_OUTPUT_ROOT")
    if env:
        return Path(env)
    return Path(default_output_root())


def resolve_products_root(cli_value: str | None = None, output_root: Path | None = None) -> Path:
    if cli_value:
        return Path(cli_value)
    env = os.environ.get("WEATHER_PRODUCTS_ROOT")
    if env:
        return Path(env)
    root = output_root if output_root is not None else resolve_output_root()
    return Path(root) / "products"


def newest_mtime(paths: list[Path]) -> float | None:
    mtimes = [path.stat().st_mtime for path in paths if path.exists()]
    return max(mtimes) if mtimes else None


def source_paths_for_job(job: SituationJob, products_root: Path, output_root: Path) -> list[Path]:
    return [
        *required_svg_paths(products_root, job.init_time, job.fc_hour, job.product, job.region),
        *required_json_paths(output_root, job.init_time, job.fc_hour, job.product),
    ]


def job_is_ready(job: SituationJob, products_root: Path, output_root: Path) -> bool:
    paths = source_paths_for_job(job, products_root, output_root)
    return all(path.exists() for path in paths)


def sources_are_stable(paths: list[Path], debounce_s: float, now: float | None = None) -> bool:
    newest = newest_mtime(paths)
    if newest is None:
        return False
    current = time.time() if now is None else now
    return current - newest >= debounce_s


def should_skip_existing(
    jpg_path: Path,
    source_paths: list[Path],
    overwrite: bool = False,
) -> bool:
    if overwrite or not jpg_path.exists():
        return False
    newest = newest_mtime(source_paths)
    if newest is None:
        return True
    return jpg_path.stat().st_mtime >= newest


def discover_init_times(products_root: Path, output_root: Path) -> list[str]:
    names = set()
    for root in (products_root, output_root):
        if not root.exists():
            continue
        for child in root.iterdir():
            if child.is_dir() and INIT_TIME_RE.match(child.name):
                names.add(child.name)
    return sorted(names)


def discover_fc_hours(products_root: Path, init_time: str, requested: list[str] | None = None) -> list[str]:
    if requested:
        return [format_fc_hour(hour) for hour in requested]
    init_dir = products_root / init_time
    if not init_dir.exists():
        return list(TIME_STR_LIST_ECMWFTHIN)
    hours = []
    for child in init_dir.iterdir():
        if child.is_dir() and re.fullmatch(r"\d{3}", child.name):
            hours.append(child.name)
    return sorted(hours) if hours else list(TIME_STR_LIST_ECMWFTHIN)


def iter_jobs(
    init_times: list[str],
    fc_hours: list[str] | None,
    levels: list[int] | None,
    region_keys: list[str] | None,
    products_root: Path,
) -> list[SituationJob]:
    selected_levels = [int(level) for level in (levels or PRODUCT_LEVELS)]
    selected_regions = list(region_keys or REGIONS)
    jobs: list[SituationJob] = []
    for init_time in init_times:
        hours = discover_fc_hours(products_root, init_time, fc_hours)
        for fc_hour in hours:
            for level in selected_levels:
                if level not in PRODUCTS:
                    continue
                for region_key in selected_regions:
                    jobs.append(SituationJob(init_time, format_fc_hour(fc_hour), level, region_key))
    return jobs


def render_situation_map(*args, **kwargs):
    """延迟导入合成模块，避免 watch/测试启动时加载 Cartopy。"""
    from situation_maps.situation_map_composite import render_situation_map as _render

    return _render(*args, **kwargs)


def process_job(
    job: SituationJob,
    products_root: Path,
    output_root: Path,
    *,
    overwrite: bool,
    debounce_s: float,
    dpi: int,
    now: float | None = None,
) -> str:
    """处理单个任务，返回 skip / wait / written / error。"""
    jpg_path = situation_jpg_path(output_root, job.init_time, job.fc_hour, job.level, job.region_key)
    sources = source_paths_for_job(job, products_root, output_root)
    if not job_is_ready(job, products_root, output_root):
        return "wait"
    if not sources_are_stable(sources, debounce_s, now=now):
        return "wait"
    if should_skip_existing(jpg_path, sources, overwrite=overwrite):
        return "skip"
    try:
        render_situation_map(
            products_root=products_root,
            output_root=output_root,
            init_time=job.init_time,
            fc_hour=job.fc_hour,
            level=job.level,
            region_key=job.region_key,
            output_path=jpg_path,
            dpi=dpi,
        )
    except Exception:
        _log(
            f"Failed {job.init_time} {job.fc_hour} {job.level}hPa {job.region.label}: "
            f"{traceback.format_exc()}"
        )
        return "error"
    _log(f"Wrote {jpg_path}")
    return "written"


def run_cycle(
    *,
    products_root: Path,
    output_root: Path,
    init_times: list[str],
    fc_hours: list[str] | None,
    levels: list[int] | None,
    region_keys: list[str] | None,
    overwrite: bool,
    debounce_s: float,
    dpi: int,
) -> dict[str, int]:
    jobs = iter_jobs(init_times, fc_hours, levels, region_keys, products_root)
    counts = {"written": 0, "skip": 0, "wait": 0, "error": 0}
    for job in jobs:
        status = process_job(
            job,
            products_root,
            output_root,
            overwrite=overwrite,
            debounce_s=debounce_s,
            dpi=dpi,
        )
        counts[status] = counts.get(status, 0) + 1
    return counts


def run_watch(
    *,
    products_root: Path,
    output_root: Path,
    init_times: list[str] | None,
    fc_hours: list[str] | None,
    levels: list[int] | None,
    region_keys: list[str] | None,
    overwrite: bool,
    debounce_s: float,
    poll_interval: float,
    dpi: int,
) -> None:
    _log(
        f"Watch situation maps: products={products_root}, output={output_root}, "
        f"poll={poll_interval}s, debounce={debounce_s}s"
    )
    while True:
        discovered = init_times or discover_init_times(products_root, output_root)
        if not discovered:
            _log("No init_time directories found; waiting.")
        else:
            counts = run_cycle(
                products_root=products_root,
                output_root=output_root,
                init_times=discovered,
                fc_hours=fc_hours,
                levels=levels,
                region_keys=region_keys,
                overwrite=overwrite,
                debounce_s=debounce_s,
                dpi=dpi,
            )
            _log(
                "Cycle "
                f"written={counts['written']} skip={counts['skip']} "
                f"wait={counts['wait']} error={counts['error']}"
            )
        time.sleep(poll_interval)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compose SVG weather tiles into situation-map JPEGs.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--watch", action="store_true", help="Poll directories and generate as sources appear (default).")
    mode.add_argument("--once", action="store_true", help="Scan once and exit.")
    parser.add_argument("--init-time", help="YYYYMMDDHH. Default: latest ECMWF base time for --once, all found dirs for --watch.")
    parser.add_argument("--fc-hours", nargs="+", help="Forecast hours. Default: discovered product hours.")
    parser.add_argument("--levels", nargs="+", type=int, default=list(PRODUCT_LEVELS), help="Pressure levels.")
    parser.add_argument("--regions", nargs="+", choices=list(REGIONS), default=list(REGIONS), help="Map extents.")
    parser.add_argument("--output-root", help="JSON/JPG root. Default: WEATHER_OUTPUT_ROOT or OS default.")
    parser.add_argument("--products-root", help="SVG products root. Default: WEATHER_PRODUCTS_ROOT or <output-root>/products.")
    parser.set_defaults(overwrite=False)
    parser.add_argument("--skip-existing", dest="overwrite", action="store_false", help="Reuse up-to-date JPEGs (default).")
    parser.add_argument("--overwrite", dest="overwrite", action="store_true", help="Regenerate existing JPEGs.")
    parser.add_argument(
        "--debounce-seconds",
        type=float,
        default=None,
        help=f"Wait after last source write. Default: {DEFAULT_DEBOUNCE_S}s in --watch, 0 in --once.",
    )
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL)
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_root = resolve_output_root(args.output_root)
    products_root = resolve_products_root(args.products_root, output_root)
    watch = not args.once
    debounce_s = args.debounce_seconds
    if debounce_s is None:
        debounce_s = DEFAULT_DEBOUNCE_S if watch else 0.0
    if args.init_time:
        init_times = [args.init_time]
    elif args.once:
        init_times = [calLatestBaseTime()]
    else:
        init_times = None
    fc_hours = [format_fc_hour(hour) for hour in args.fc_hours] if args.fc_hours else None
    if watch:
        run_watch(
            products_root=products_root,
            output_root=output_root,
            init_times=init_times,
            fc_hours=fc_hours,
            levels=args.levels,
            region_keys=args.regions,
            overwrite=args.overwrite,
            debounce_s=debounce_s,
            poll_interval=args.poll_interval,
            dpi=args.dpi,
        )
        return
    discovered = init_times or discover_init_times(products_root, output_root)
    counts = run_cycle(
        products_root=products_root,
        output_root=output_root,
        init_times=discovered,
        fc_hours=fc_hours,
        levels=args.levels,
        region_keys=args.regions,
        overwrite=args.overwrite,
        debounce_s=debounce_s,
        dpi=args.dpi,
    )
    _log(
        "Finished "
        f"written={counts['written']} skip={counts['skip']} "
        f"wait={counts['wait']} error={counts['error']}"
    )


if __name__ == "__main__":
    main()
