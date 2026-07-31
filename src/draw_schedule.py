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

try:
    from archive_cold_data import DEFAULT_RETENTION_DAYS, run_archive
except ModuleNotFoundError:
    from src.archive_cold_data import DEFAULT_RETENTION_DAYS, run_archive


SCHEDULE_MINUTES = (9, 19, 29, 39, 49, 59)
SCRIPT_PATH = Path(__file__).resolve().parent / "draw" / "generate_svg_layers.py"
DEFAULT_OUTPUT_ROOT = f"{default_output_root()}/products"
# 归档每天只需一次：放在 SCHEDULE_MINUTES 之外的时刻，避免和生成任务抢 IO。
ARCHIVE_HOUR = 3
ARCHIVE_MINUTE = 39


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


def _run_archive(hot_root: str, cold_root: str, retention_days: int) -> bool:
    """在调度线程池中执行冷数据归档；异常不向外抛，避免中断调度循环。"""
    try:
        _, failed = run_archive(
            hot_root=Path(hot_root),
            cold_root=Path(cold_root),
            retention_days=retention_days,
        )
        return failed == 0
    except Exception:
        _log("冷数据归档出现未预期错误。")
        traceback.print_exc()
        return False


def _should_archive(now: datetime, last_archive_date: object) -> bool:
    """到达归档时刻且当天尚未归档时返回 True。"""
    return (
        now.hour == ARCHIVE_HOUR
        and now.minute == ARCHIVE_MINUTE
        and last_archive_date != now.date()
    )


def run_scheduler(
    *,
    script_args: Sequence[str],
    python: str = sys.executable,
    run_immediately: bool = False,
    archive_hot_root: str | None = None,
    archive_cold_root: str | None = None,
    archive_retention_days: int = DEFAULT_RETENTION_DAYS,
) -> None:
    """Run SVG generation at :09, :19, :29, :39, :49, and :59.

    配置了 ``archive_cold_root`` 时，每天 ARCHIVE_HOUR:ARCHIVE_MINUTE 追加一次冷数据
    归档。归档与生成共用同一个单 worker 线程池，因此二者永不并发，不会互相抢 IO。
    """
    current_job: Future[bool] | None = None
    last_archive_date: object = None
    archive_enabled = bool(archive_cold_root)
    if archive_enabled:
        _log(
            f"冷数据归档已启用：热盘={archive_hot_root} 冷盘={archive_cold_root} "
            f"保留={archive_retention_days} 天，每天 {ARCHIVE_HOUR:02d}:{ARCHIVE_MINUTE:02d} 执行"
        )

    with ThreadPoolExecutor(max_workers=1) as executor:
        if run_immediately:
            current_job = _submit_if_idle(executor, current_job, script_args, python)

        while True:
            next_run = _next_run_time()
            sleep_seconds = max(0.0, (next_run - datetime.now()).total_seconds())
            _log(f"Next scheduled SVG generation: {next_run:%Y-%m-%d %H:%M:%S}")
            time.sleep(sleep_seconds)
            current_job = _submit_if_idle(executor, current_job, script_args, python)

            now = datetime.now()
            if archive_enabled and _should_archive(now, last_archive_date):
                last_archive_date = now.date()
                # 排在生成任务之后入队；单 worker 保证它等生成结束才开始。
                executor.submit(
                    _run_archive,
                    archive_hot_root or default_output_root(),
                    archive_cold_root,
                    archive_retention_days,
                )


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
    parser.add_argument(
        "--archive-cold-root",
        default=None,
        help=(
            "NFS 冷盘根目录（如 /data/weather_vis）。设置后每天定时把超过保留期的"
            "起报时次从热盘迁移过去；不设置则不做归档。"
        ),
    )
    parser.add_argument(
        "--archive-hot-root",
        default=None,
        help="本地热盘根目录，默认取 default_output_root()。",
    )
    parser.add_argument(
        "--archive-retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"热盘保留天数（默认 {DEFAULT_RETENTION_DAYS}）。",
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
            archive_hot_root=args.archive_hot_root,
            archive_cold_root=args.archive_cold_root,
            archive_retention_days=args.archive_retention_days,
        )
    except KeyboardInterrupt:
        _log("SVG generation scheduler stopped by user.")


if __name__ == "__main__":
    main()
