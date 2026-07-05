"""Scheduled runner for weather-system identification workflows."""

from __future__ import annotations

import argparse
import time
import traceback
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from jet import main as run_jet
from trough import main as run_trough
from vortex_workflow import run_vortex_workflow
from weather_common import calLatestBaseTime, default_output_root


SCHEDULE_MINUTES = (16, 46)


def _log(message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def _next_run_time(now: datetime | None = None) -> datetime:
    """Return the next local time whose minute is in ``SCHEDULE_MINUTES``."""
    if now is None:
        now = datetime.now()

    current_hour = now.replace(second=0, microsecond=0)
    candidates = [
        current_hour.replace(minute=minute)
        for minute in SCHEDULE_MINUTES
        if current_hour.replace(minute=minute) > now
    ]
    if candidates:
        return min(candidates)

    next_hour = current_hour + timedelta(hours=1)
    return next_hour.replace(minute=SCHEDULE_MINUTES[0])


def _run_job(name: str, func: Callable[..., Any], **kwargs: Any) -> bool:
    _log(f"Start {name}")
    started = time.monotonic()
    try:
        func(**kwargs)
    except Exception:
        elapsed = time.monotonic() - started
        _log(f"Failed {name} after {elapsed:.1f}s")
        traceback.print_exc()
        return False

    elapsed = time.monotonic() - started
    _log(f"Finished {name} in {elapsed:.1f}s")
    return True


def run_cycle(
    *,
    output_root: str | None = None,
    source: str = "ecmwfthin",
    save_image: bool = True,
    save_json: bool = True,
    show_progress: bool = True,
) -> dict[str, bool]:
    """Run jet, trough, and vortex workflows for the latest base time."""
    if output_root is None:
        output_root = default_output_root()
    init_time = calLatestBaseTime()
    _log(f"Start scheduled cycle: init_time={init_time}")

    results = {
        "jet": _run_job(
            "jet.py",
            run_jet,
            init_time=init_time,
            output_root=output_root,
            source=source,
            save_image=save_image,
            save_json=save_json,
            show_progress=show_progress,
        ),
        "trough": _run_job(
            "trough.py",
            run_trough,
            init_time=init_time,
            output_root=output_root,
            source=source,
            save_image=save_image,
            save_json=save_json,
            show_progress=show_progress,
        ),
        "vortex_workflow": _run_job(
            "vortex_workflow.py",
            run_vortex_workflow,
            init_time=init_time,
            output_root=output_root,
            source=source,
            show_progress=show_progress,
        ),
    }

    succeeded = sum(results.values())
    _log(f"Finished scheduled cycle: {succeeded}/{len(results)} workflows succeeded")
    return results


def run_scheduler(
    *,
    output_root: str | None = None,
    source: str = "ecmwfthin",
    save_image: bool = True,
    save_json: bool = True,
    show_progress: bool = True,
) -> None:
    """Run once immediately, then every hour at :16 and :46."""
    if output_root is None:
        output_root = default_output_root()
    run_cycle(
        output_root=output_root,
        source=source,
        save_image=save_image,
        save_json=save_json,
        show_progress=show_progress,
    )

    while True:
        next_run = _next_run_time()
        sleep_seconds = max(0.0, (next_run - datetime.now()).total_seconds())
        _log(f"Next scheduled cycle: {next_run:%Y-%m-%d %H:%M:%S}")
        time.sleep(sleep_seconds)
        run_cycle(
            output_root=output_root,
            source=source,
            save_image=save_image,
            save_json=save_json,
            show_progress=show_progress,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run weather-system workflows immediately, then at every hour's :16 and :46."
    )
    parser.add_argument("--output-root", default=default_output_root())
    parser.add_argument("--source", default="ecmwfthin")
    parser.add_argument("--save-image", dest="save_image", action="store_true", default=True)
    parser.add_argument("--no-save-image", dest="save_image", action="store_false")
    parser.add_argument("--save-json", dest="save_json", action="store_true", default=True)
    parser.add_argument("--no-save-json", dest="save_json", action="store_false")
    parser.add_argument("--quiet", action="store_true", help="Hide workflow progress output.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        run_scheduler(
            output_root=args.output_root,
            source=args.source,
            save_image=args.save_image,
            save_json=args.save_json,
            show_progress=not args.quiet,
        )
    except KeyboardInterrupt:
        _log("Scheduler stopped by user.")


if __name__ == "__main__":
    main()
