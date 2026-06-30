"""Run vortex center, warm-core, and tracking stages as one workflow."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

from vortex_center import run_center_identification
from vortex_common import (
    DEFAULT_AREA,
    DEFAULT_FC_HOURS,
    DEFAULT_LEVELS,
    DEFAULT_SOURCE,
    DEFAULT_WARM_LEVELS,
    VortexDataError,
    calLatestBaseTime,
    center_json_path,
    normalize_fc_hours,
    track_json_path,
    warm_json_path,
)
from vortex_tracker import run_tracking_workflow
from vortex_warm_core import run_warm_core_identification


def _completed_fc_hours(summary: list[dict], output_root: str | Path, init_time: str) -> list[str]:
    """Return forecast hours with completed/readable 850 hPa center output."""
    completed = []
    for item in summary:
        fc_hour = item.get("fc_hour")
        level = item.get("level")
        if fc_hour is None or level != 850:
            continue
        if item.get("status") == "completed" and center_json_path(output_root, init_time, fc_hour, 850).exists():
            completed.append(fc_hour)
    return normalize_fc_hours(completed)


def _completed_warm_fc_hours(summary: list[dict], output_root: str | Path, init_time: str) -> list[str]:
    """Return forecast hours with completed/readable warm-core output."""
    completed = []
    for item in summary:
        fc_hour = item.get("fc_hour")
        if fc_hour is None:
            continue
        if item.get("status") == "completed" and warm_json_path(output_root, init_time, fc_hour).exists():
            completed.append(fc_hour)
    return normalize_fc_hours(completed)


def run_vortex_workflow(
    init_time: str | None = None,
    fc_hours: Iterable[int | str] | None = None,
    levels: Iterable[int] | None = None,
    area: list[float] | None = None,
    source: str = DEFAULT_SOURCE,
    output_root: str | Path = "data",
    warm_levels: Iterable[int] = DEFAULT_WARM_LEVELS,
    save_center_image: bool = False,
    save_track_image: bool = False,
    smooth_threshold: float = 1.0,
    show_progress: bool = True,
) -> dict:
    """Run all vortex stages and return a workflow summary."""
    if init_time is None:
        init_time = calLatestBaseTime()
    fc_hours = normalize_fc_hours(fc_hours or DEFAULT_FC_HOURS)
    levels = [int(level) for level in (levels or DEFAULT_LEVELS)]
    area = [float(value) for value in (area or DEFAULT_AREA)]
    output_root = Path(output_root)

    if show_progress:
        print(
            f"Start vortex workflow: init_time={init_time}, "
            f"fc_hours={len(fc_hours)}, levels={levels}"
        )

    center_summary = []
    for index, fc_hour in enumerate(fc_hours, start=1):
        if show_progress:
            print(f"[center {index}/{len(fc_hours)}] init={init_time} fc={fc_hour}")
        result = run_center_identification(
            init_time=init_time,
            fc_hours=[fc_hour],
            levels=levels,
            area=area,
            source=source,
            output_root=output_root,
            save_json=True,
            save_image=save_center_image,
            smooth_threshold=smooth_threshold,
            show_progress=show_progress,
        )
        center_summary.extend(result)

    center_ready_fc_hours = _completed_fc_hours(center_summary, output_root, init_time)
    if show_progress:
        print(f"Center stage ready 850hPa hours: {len(center_ready_fc_hours)}")

    warm_summary = []
    if center_ready_fc_hours:
        for index, fc_hour in enumerate(center_ready_fc_hours, start=1):
            if show_progress:
                print(f"[warm-core {index}/{len(center_ready_fc_hours)}] init={init_time} fc={fc_hour}")
            result = run_warm_core_identification(
                init_time=init_time,
                fc_hours=[fc_hour],
                area=area,
                source=source,
                output_root=output_root,
                warm_levels=warm_levels,
                show_progress=show_progress,
            )
            warm_summary.extend(result)

    warm_ready_fc_hours = _completed_warm_fc_hours(warm_summary, output_root, init_time)
    if show_progress:
        print(f"Warm-core stage ready hours: {len(warm_ready_fc_hours)}")

    tracking_summary = None
    if warm_ready_fc_hours:
        tracking_summary = run_tracking_workflow(
            init_time=init_time,
            fc_hours=warm_ready_fc_hours,
            output_root=output_root,
            save_image=save_track_image,
            area=area,
            show_progress=show_progress,
        )
    elif show_progress:
        print("Skip tracking: no warm-core JSON files are ready.")

    return {
        "init_time": init_time,
        "requested_fc_hours": fc_hours,
        "center_ready_fc_hours": center_ready_fc_hours,
        "warm_ready_fc_hours": warm_ready_fc_hours,
        "center_summary": center_summary,
        "warm_summary": warm_summary,
        "tracking_summary": tracking_summary,
        "track_json_path": str(track_json_path(output_root, init_time)) if tracking_summary else None,
        "status": "completed" if tracking_summary is not None or not fc_hours else "partial",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run vortex center, warm-core, and tracking stages as one workflow."
    )
    parser.add_argument(
        "--init-time",
        default=None,
        help="Initialization time, YYYYMMDDHH. Defaults to latest ECMWF base time.",
    )
    parser.add_argument("--fc-hours", nargs="+", default=DEFAULT_FC_HOURS)
    parser.add_argument("--levels", nargs="+", type=int, default=DEFAULT_LEVELS)
    parser.add_argument("--area", nargs=4, type=float, default=DEFAULT_AREA, metavar=("W", "E", "S", "N"))
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output-root", default="data")
    parser.add_argument("--warm-levels", nargs="+", type=int, default=DEFAULT_WARM_LEVELS)
    parser.add_argument("--smooth-threshold", type=float, default=1.0)
    parser.add_argument("--save-center-image", action="store_true")
    parser.add_argument("--save-track-image", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        run_vortex_workflow(
            init_time=args.init_time,
            fc_hours=args.fc_hours,
            levels=args.levels,
            area=args.area,
            source=args.source,
            output_root=args.output_root,
            warm_levels=args.warm_levels,
            save_center_image=args.save_center_image,
            save_track_image=args.save_track_image,
            smooth_threshold=args.smooth_threshold,
        )
    except VortexDataError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
