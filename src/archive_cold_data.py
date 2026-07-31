"""把超过保留期的起报时次从本地热盘迁移到 NFS 冷盘。

背景：`/data` 整体挂载在 NFS 上，实测冷文件读取约 1 s/文件，而本地盘约 2 ms。
因此把近期数据放本地盘、旧数据留在 NFS，由 nginx 按「先热后冷」顺序查找。

目录布局（热盘与冷盘同构，便于 nginx try_files 直接回落）::

    <root>/products/<init_time>/...   SVG 瓦片与 manifest.json
    <root>/<init_time>/...           槽线/急流/涡旋等 JSON

迁移语义：
- 只迁移 **早于** 保留期的时次；保留期内的一律不动。
- 逐个时次用 ``rsync --remove-source-files`` 搬运，成功后再删空目录；
  中断后重跑会继续未完成的部分，不会产生半个时次两边都不完整的状态。
- 冷盘已存在同名时次时按合并处理（rsync 覆盖同名文件），不会先删目标。
- 正在生成的最新时次即使超期也跳过，避免与 draw_schedule 的写入竞争。
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from weather_common import default_output_root
except ModuleNotFoundError:
    from src.weather_common import default_output_root


INIT_TIME_RE = re.compile(r"^\d{10}$")
DEFAULT_RETENTION_DAYS = 7
# 最新的若干个时次即使超期也不迁移，留出生成流水线的安全边界。
KEEP_NEWEST_COUNT = 2


def _log(message: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] [archive] {message}", flush=True)


def parse_init_time(value: str) -> datetime | None:
    """把 ``YYYYMMDDHH`` 解析为 UTC 时间；格式不符返回 ``None``。"""
    if not INIT_TIME_RE.match(value):
        return None
    try:
        return datetime.strptime(value, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def list_init_times(directory: Path) -> list[str]:
    """列出目录下形如 ``YYYYMMDDHH`` 的子目录名，按时间升序。"""
    if not directory.is_dir():
        return []
    names = [
        entry.name
        for entry in directory.iterdir()
        if entry.is_dir() and parse_init_time(entry.name) is not None
    ]
    return sorted(names)


def expired_init_times(
    hot_root: Path,
    retention_days: int,
    now: datetime | None = None,
    keep_newest: int = KEEP_NEWEST_COUNT,
) -> list[str]:
    """返回热盘上应迁移的时次。

    以 ``products/`` 下的时次为准（SVG 是体积主体）。保留期按起报时间计算，
    并且无论如何都保留最新的 ``keep_newest`` 个时次。
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    candidates = list_init_times(hot_root / "products")
    if keep_newest > 0:
        candidates = candidates[:-keep_newest] if len(candidates) > keep_newest else []
    return [name for name in candidates if (parse_init_time(name) or now) < cutoff]


def _rsync_move(source: Path, destination: Path, dry_run: bool) -> bool:
    """用 rsync 把 ``source`` 内容搬到 ``destination``，成功后源端文件被移除。

    ``--remove-source-files`` 只删已确认传输成功的文件，因此中断可安全重跑。
    """
    destination.mkdir(parents=True, exist_ok=True)
    command = [
        "rsync",
        "-a",
        "--remove-source-files",
        f"{source}/",
        f"{destination}/",
    ]
    if dry_run:
        _log(f"DRY-RUN {' '.join(command)}")
        return True

    started = time.monotonic()
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    elapsed = time.monotonic() - started
    if completed.returncode != 0:
        _log(
            f"rsync 失败 returncode={completed.returncode} 耗时={elapsed:.1f}s "
            f"source={source}\n{completed.stderr.strip()[:500]}"
        )
        return False
    _log(f"rsync 完成 {source} -> {destination} 耗时={elapsed:.1f}s")
    return True


def _remove_empty_tree(directory: Path, dry_run: bool) -> None:
    """删除 rsync 搬空后残留的目录骨架；仍有文件则保留并告警。"""
    if not directory.is_dir():
        return
    leftovers = [path for path in directory.rglob("*") if path.is_file()]
    if leftovers:
        _log(f"跳过删除 {directory}：仍有 {len(leftovers)} 个文件未迁移")
        return
    if dry_run:
        _log(f"DRY-RUN rmtree {directory}")
        return
    shutil.rmtree(directory, ignore_errors=True)


def archive_init_time(init_time: str, hot_root: Path, cold_root: Path, dry_run: bool) -> bool:
    """迁移单个时次的 products 与同名 JSON 目录。两者都成功才算成功。"""
    ok = True
    for relative in (Path("products") / init_time, Path(init_time)):
        source = hot_root / relative
        if not source.is_dir():
            continue
        if not _rsync_move(source, cold_root / relative, dry_run):
            ok = False
            continue
        _remove_empty_tree(source, dry_run)
    return ok


def run_archive(
    hot_root: Path,
    cold_root: Path,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    dry_run: bool = False,
    keep_newest: int = KEEP_NEWEST_COUNT,
) -> tuple[int, int]:
    """迁移所有超期时次，返回 ``(成功数, 失败数)``。"""
    if hot_root.resolve() == cold_root.resolve():
        _log("热盘与冷盘路径相同，跳过归档")
        return (0, 0)

    expired = expired_init_times(hot_root, retention_days, keep_newest=keep_newest)
    if not expired:
        _log(f"没有超过 {retention_days} 天的时次需要迁移")
        return (0, 0)

    _log(f"待迁移 {len(expired)} 个时次（保留 {retention_days} 天）：{', '.join(expired)}")
    moved = failed = 0
    for init_time in expired:
        if archive_init_time(init_time, hot_root, cold_root, dry_run):
            moved += 1
        else:
            failed += 1
    _log(f"归档结束：成功={moved} 失败={failed}")
    return (moved, failed)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="把超期起报时次从本地热盘迁移到 NFS 冷盘。")
    parser.add_argument(
        "--hot-root",
        default=default_output_root(),
        help="本地热盘数据根目录（默认取 default_output_root()）。",
    )
    parser.add_argument(
        "--cold-root",
        required=True,
        help="NFS 冷盘数据根目录，例如 /data/weather_vis。",
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"热盘保留天数（默认 {DEFAULT_RETENTION_DAYS}）。",
    )
    parser.add_argument(
        "--keep-newest",
        type=int,
        default=KEEP_NEWEST_COUNT,
        help=f"无论是否超期都保留的最新时次个数（默认 {KEEP_NEWEST_COUNT}）。",
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印将要执行的操作。")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.retention_days < 1:
        raise ValueError("--retention-days 至少为 1")
    _, failed = run_archive(
        hot_root=Path(args.hot_root),
        cold_root=Path(args.cold_root),
        retention_days=args.retention_days,
        dry_run=args.dry_run,
        keep_newest=args.keep_newest,
    )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
