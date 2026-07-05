"""Scheduled wrapper for SVG weather-layer generation."""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import traceback
from collections.abc import Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

try:
    from weather_common import default_output_root
except ModuleNotFoundError:
    from src.weather_common import default_output_root


SCHEDULE_MINUTES = (9, 19, 29, 39, 49, 59)
SCRIPT_PATH = Path(__file__).resolve().parent / "draw" / "generate_svg_layers.py"
DEFAULT_OUTPUT_ROOT = f"{default_output_root()}/products"


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


def _run_generate_svg_layers(script_args: Sequence[str], python: str) -> bool:
    command = [python, str(SCRIPT_PATH), *script_args]
    started = time.monotonic()
    _log(f"Start generate_svg_layers.py: {' '.join(command)}")

    try:
        completed = subprocess.run(command, check=False)
    except Exception:
        elapsed = time.monotonic() - started
        _log(f"Failed to launch generate_svg_layers.py after {elapsed:.1f}s")
        traceback.print_exc()
        return False

    elapsed = time.monotonic() - started
    if completed.returncode != 0:
        _log(
            "Failed generate_svg_layers.py "
            f"after {elapsed:.1f}s, returncode={completed.returncode}"
        )
        return False

    _log(f"Finished generate_svg_layers.py in {elapsed:.1f}s")
    return True


def _has_output_arg(script_args: Sequence[str]) -> bool:
    return any(arg == "--output" or arg.startswith("--output=") for arg in script_args)


def _script_args_with_defaults(script_args: Sequence[str]) -> list[str]:
    args = list(script_args)
    if not _has_output_arg(args):
        args.extend(["--output", DEFAULT_OUTPUT_ROOT])
    return args


def _submit_if_idle(
    executor: ThreadPoolExecutor,
    current_job: Future[bool] | None,
    script_args: Sequence[str],
    python: str,
) -> Future[bool]:
    if current_job is not None and not current_job.done():
        _log("Skip scheduled SVG generation: previous job is still running.")
        return current_job

    if current_job is not None:
        try:
            current_job.result()
        except Exception:
            _log("Previous SVG generation job ended with an unexpected scheduler error.")
            traceback.print_exc()

    return executor.submit(_run_generate_svg_layers, _script_args_with_defaults(script_args), python)


def run_scheduler(
    *,
    script_args: Sequence[str],
    python: str = sys.executable,
    run_immediately: bool = False,
) -> None:
    """Run SVG generation at :09, :19, :29, :39, :49, and :59."""
    current_job: Future[bool] | None = None

    with ThreadPoolExecutor(max_workers=1) as executor:
        if run_immediately:
            current_job = _submit_if_idle(executor, current_job, script_args, python)

        while True:
            next_run = _next_run_time()
            sleep_seconds = max(0.0, (next_run - datetime.now()).total_seconds())
            _log(f"Next scheduled SVG generation: {next_run:%Y-%m-%d %H:%M:%S}")
            time.sleep(sleep_seconds)
            current_job = _submit_if_idle(executor, current_job, script_args, python)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run draw/generate_svg_layers.py every 10 minutes at "
            "each hour's :09, :19, :29, :39, :49, and :59."
        )
    )
    parser.add_argument(
        "--run-immediately",
        action="store_true",
        help="Run once on scheduler startup before waiting for the next scheduled time.",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable used to launch generate_svg_layers.py.",
    )
    args, script_args = parser.parse_known_args()
    args.script_args = script_args
    return args


def main() -> None:
    args = parse_args()
    try:
        run_scheduler(
            script_args=args.script_args,
            python=args.python,
            run_immediately=args.run_immediately,
        )
    except KeyboardInterrupt:
        _log("SVG generation scheduler stopped by user.")


if __name__ == "__main__":
    main()
