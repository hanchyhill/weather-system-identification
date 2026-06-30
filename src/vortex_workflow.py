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


def _new_center_fc_hours(summary: list[dict], output_root: str | Path, init_time: str) -> list[str]:
    """Return forecast hours with newly generated 850 hPa center output."""
    generated = []
    for item in summary:
        fc_hour = item.get("fc_hour")
        level = item.get("level")
        if fc_hour is None or level != 850:
            continue
        if item.get("generated") and center_json_path(output_root, init_time, fc_hour, 850).exists():
            generated.append(fc_hour)
    return normalize_fc_hours(generated)


def _new_warm_fc_hours(summary: list[dict], output_root: str | Path, init_time: str) -> list[str]:
    """Return forecast hours with newly generated warm-core output."""
    generated = []
    for item in summary:
        fc_hour = item.get("fc_hour")
        if fc_hour is None:
            continue
        if item.get("generated") and warm_json_path(output_root, init_time, fc_hour).exists():
            generated.append(fc_hour)
    return normalize_fc_hours(generated)


def _ready_tracking_fc_hours(output_root: str | Path, init_time: str, fc_hours: Iterable[int | str]) -> list[str]:
    """Return requested forecast hours with both center and warm-core JSON files ready."""
    ready = []
    for fc_hour in normalize_fc_hours(fc_hours):
        if (
            center_json_path(output_root, init_time, fc_hour, 850).exists()
            and warm_json_path(output_root, init_time, fc_hour).exists()
        ):
            ready.append(fc_hour)
    return ready


def _collect_files(summary: list[dict], key: str) -> list[str]:
    files = []
    for item in summary:
        files.extend(item.get(key, []))
    return files


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
            skip_existing=True,
        )
        center_summary.extend(result)

    center_new_fc_hours = _new_center_fc_hours(center_summary, output_root, init_time)
    center_generated_files = _collect_files(center_summary, "generated_files")
    center_skipped_files = _collect_files(center_summary, "skipped_files")
    if show_progress:
        print(
            f"Center stage generated files: {len(center_generated_files)}, "
            f"skipped existing files: {len(center_skipped_files)}"
        )
        if center_skipped_files:
            print("Skipped existing center JSON files:")
            for path in center_skipped_files:
                print(f"  {path}")
        if center_generated_files:
            print("Generated center JSON files:")
            for path in center_generated_files:
                print(f"  {path}")
        print(f"New 850hPa center hours for warm-core stage: {len(center_new_fc_hours)}")

    warm_summary = []
    if center_new_fc_hours:
        for index, fc_hour in enumerate(center_new_fc_hours, start=1):
            if show_progress:
                print(f"[warm-core {index}/{len(center_new_fc_hours)}] init={init_time} fc={fc_hour}")
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
    elif show_progress:
        print("Skip warm-core stage: no newly generated 850hPa center JSON files.")

    warm_new_fc_hours = _new_warm_fc_hours(warm_summary, output_root, init_time)
    warm_generated_files = _collect_files(warm_summary, "generated_files")
    if show_progress:
        print(f"Warm-core stage generated files: {len(warm_generated_files)}")
        if warm_generated_files:
            print("Generated warm-core JSON files:")
            for path in warm_generated_files:
                print(f"  {path}")

    tracking_summary = None
    tracking_ready_fc_hours = _ready_tracking_fc_hours(output_root, init_time, fc_hours)
    tracking_skipped = False
    if warm_new_fc_hours:
        if show_progress:
            print(
                "New warm-core files detected; rerun tracker over all ready "
                f"requested hours: {len(tracking_ready_fc_hours)}"
            )
        tracking_summary = run_tracking_workflow(
            init_time=init_time,
            fc_hours=tracking_ready_fc_hours,
            output_root=output_root,
            save_image=save_track_image,
            area=area,
            show_progress=show_progress,
        )
    else:
        tracking_skipped = True
        if show_progress:
            print("Skip tracking: no newly generated warm-core JSON files.")

    return {
        "init_time": init_time,
        "requested_fc_hours": fc_hours,
        "center_new_fc_hours": center_new_fc_hours,
        "center_generated_files": center_generated_files,
        "center_skipped_files": center_skipped_files,
        "warm_new_fc_hours": warm_new_fc_hours,
        "warm_generated_files": warm_generated_files,
        "tracking_ready_fc_hours": tracking_ready_fc_hours,
        "tracking_skipped": tracking_skipped,
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
