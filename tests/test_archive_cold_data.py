"""冷数据归档的单元测试：保留期判定与实际迁移语义。"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from archive_cold_data import (  # noqa: E402
    archive_init_time,
    expired_init_times,
    list_init_times,
    parse_init_time,
    run_archive,
)


class ParseInitTimeTests(unittest.TestCase):
    def test_parses_valid_init_time_as_utc(self):
        parsed = parse_init_time("2026072912")
        self.assertEqual(parsed, datetime(2026, 7, 29, 12, tzinfo=timezone.utc))

    def test_rejects_wrong_length_and_non_digits(self):
        for value in ("202607291", "20260729123", "202607zz", "", "products"):
            self.assertIsNone(parse_init_time(value), value)

    def test_rejects_impossible_calendar_date(self):
        self.assertIsNone(parse_init_time("2026073212"))


class ListInitTimesTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def test_lists_only_init_time_dirs_sorted(self):
        for name in ("2026072912", "2026072800", "notatime", "2026072812"):
            (self.root / name).mkdir()
        (self.root / "2026072900.json").write_text("x", encoding="utf-8")
        self.assertEqual(
            list_init_times(self.root),
            ["2026072800", "2026072812", "2026072912"],
        )

    def test_missing_directory_returns_empty(self):
        self.assertEqual(list_init_times(self.root / "absent"), [])


class ExpiredInitTimesTests(unittest.TestCase):
    def setUp(self):
        self.hot = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.hot, ignore_errors=True)
        self.products = self.hot / "products"
        self.products.mkdir()

    def _add(self, *names):
        for name in names:
            (self.products / name).mkdir()

    def test_selects_only_times_older_than_retention(self):
        # now = 2026-07-30 00Z, retention 7d -> cutoff 2026-07-23 00Z
        self._add("2026072012", "2026072200", "2026072400", "2026072800", "2026072912")
        now = datetime(2026, 7, 30, tzinfo=timezone.utc)
        self.assertEqual(
            expired_init_times(self.hot, 7, now=now, keep_newest=0),
            ["2026072012", "2026072200"],
        )

    def test_keep_newest_protects_recent_times_even_if_expired(self):
        self._add("2026070100", "2026070112", "2026070200")
        now = datetime(2026, 7, 30, tzinfo=timezone.utc)
        # all three are far older than retention, but the newest 2 are protected
        self.assertEqual(
            expired_init_times(self.hot, 7, now=now, keep_newest=2),
            ["2026070100"],
        )

    def test_keep_newest_larger_than_count_yields_nothing(self):
        self._add("2026070100", "2026070112")
        now = datetime(2026, 7, 30, tzinfo=timezone.utc)
        self.assertEqual(expired_init_times(self.hot, 7, now=now, keep_newest=5), [])

    def test_nothing_expired_when_all_recent(self):
        self._add("2026072900", "2026072912")
        now = datetime(2026, 7, 30, tzinfo=timezone.utc)
        self.assertEqual(expired_init_times(self.hot, 7, now=now, keep_newest=0), [])


class ArchiveMoveTests(unittest.TestCase):
    def setUp(self):
        base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, base, ignore_errors=True)
        self.hot = base / "hot"
        self.cold = base / "cold"
        for root in (self.hot, self.cold):
            (root / "products").mkdir(parents=True)

    def _seed(self, init_time: str):
        tile = self.hot / "products" / init_time / "096" / "500" / "wind_barb" / "1" / "4"
        tile.mkdir(parents=True)
        (tile / "2.svg").write_text(f"tile-{init_time}", encoding="utf-8")
        (self.hot / "products" / init_time / "manifest.json").write_text("{}", encoding="utf-8")
        json_dir = self.hot / init_time / "trough_data"
        json_dir.mkdir(parents=True)
        (json_dir / "t.json").write_text("[]", encoding="utf-8")

    @unittest.skipUnless(shutil.which("rsync"), "rsync 不可用")
    def test_moves_products_and_json_then_clears_source(self):
        self._seed("2026070400")
        self.assertTrue(archive_init_time("2026070400", self.hot, self.cold, dry_run=False))

        moved_tile = self.cold / "products/2026070400/096/500/wind_barb/1/4/2.svg"
        self.assertEqual(moved_tile.read_text(encoding="utf-8"), "tile-2026070400")
        self.assertEqual(
            (self.cold / "products/2026070400/manifest.json").read_text(encoding="utf-8"), "{}"
        )
        self.assertEqual(
            (self.cold / "2026070400/trough_data/t.json").read_text(encoding="utf-8"), "[]"
        )
        # 源端目录应被清空删除
        self.assertFalse((self.hot / "products/2026070400").exists())
        self.assertFalse((self.hot / "2026070400").exists())

    @unittest.skipUnless(shutil.which("rsync"), "rsync 不可用")
    def test_dry_run_leaves_source_untouched(self):
        self._seed("2026070400")
        archive_init_time("2026070400", self.hot, self.cold, dry_run=True)
        self.assertTrue((self.hot / "products/2026070400/manifest.json").exists())
        self.assertFalse((self.cold / "products/2026070400/manifest.json").exists())

    @unittest.skipUnless(shutil.which("rsync"), "rsync 不可用")
    def test_missing_json_dir_is_not_an_error(self):
        tile_root = self.hot / "products" / "2026070400"
        tile_root.mkdir(parents=True)
        (tile_root / "manifest.json").write_text("{}", encoding="utf-8")
        self.assertTrue(archive_init_time("2026070400", self.hot, self.cold, dry_run=False))
        self.assertTrue((self.cold / "products/2026070400/manifest.json").exists())

    @unittest.skipUnless(shutil.which("rsync"), "rsync 不可用")
    def test_merges_into_existing_cold_init_time(self):
        self._seed("2026070400")
        existing = self.cold / "products/2026070400/000/500/hght_contour/0/2"
        existing.mkdir(parents=True)
        (existing / "1.svg").write_text("pre-existing", encoding="utf-8")

        self.assertTrue(archive_init_time("2026070400", self.hot, self.cold, dry_run=False))
        # 既有文件保留，新文件合并进来
        self.assertEqual((existing / "1.svg").read_text(encoding="utf-8"), "pre-existing")
        self.assertTrue((self.cold / "products/2026070400/manifest.json").exists())

    def test_same_hot_and_cold_root_is_a_noop(self):
        self._seed("2026070400")
        self.assertEqual(run_archive(self.hot, self.hot, retention_days=1), (0, 0))
        self.assertTrue((self.hot / "products/2026070400/manifest.json").exists())

    @unittest.skipUnless(shutil.which("rsync"), "rsync 不可用")
    def test_run_archive_respects_retention_and_reports_counts(self):
        for name in ("2026070400", "2026072912"):
            self._seed(name)
        moved, failed = run_archive(
            self.hot, self.cold, retention_days=7, keep_newest=0
        )
        self.assertEqual((moved, failed), (1, 0))
        self.assertTrue((self.cold / "products/2026070400/manifest.json").exists())
        # 近期时次留在热盘
        self.assertTrue((self.hot / "products/2026072912/manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
