import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from situation_maps.generate_situation_maps import (  # noqa: E402
    SituationJob,
    job_is_ready,
    process_job,
    should_skip_existing,
    sources_are_stable,
)
from situation_maps.situation_map_config import (  # noqa: E402
    PRODUCTS,
    REGIONS,
    filter_trough_lines,
    filter_vortex_centers,
    filter_vortex_tracks,
    forecast_bjt_label,
    required_json_paths,
    required_svg_paths,
    should_thicken_height_contours,
    situation_jpg_path,
    situation_title,
    tile_zoom_for_layer,
)
from situation_maps.situation_map_basemap import (  # noqa: E402
    CHINA_TOPO_PATH,
    WORLD_TOPO_PATH,
    decode_arcs,
    geometry_lines,
    object_lines,
)
from draw.svg_layer_geometry import iter_tiles  # noqa: E402


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>")


class SituationMapFilterTests(unittest.TestCase):
    def test_trough_keeps_v_shear_above_wind_threshold_at_500(self):
        data = {
            "trough_lines": [
                {
                    "shear_type": "shear_v_up",
                    "attributes": {"avg_wind_speed": 5.0},
                },
                {
                    "shear_type": "shear_v_down",
                    "attributes": {"avg_wind_speed": 2.5},
                },
                {
                    "shear_type": "shear_u_left",
                    "attributes": {"avg_wind_speed": 10.0},
                },
            ]
        }
        visible = filter_trough_lines(data, 500)
        self.assertEqual([line["shear_type"] for line in visible], ["shear_v_up"])

    def test_trough_keeps_u_shear_at_850(self):
        data = {
            "trough_lines": [
                {"shear_type": "shear_u_right", "attributes": {"avg_wind_speed": 3.0}},
                {"shear_type": "shear_v_up", "attributes": {"avg_wind_speed": 8.0}},
            ]
        }
        visible = filter_trough_lines(data, 850)
        self.assertEqual([line["shear_type"] for line in visible], ["shear_u_right"])

    def test_vortex_centers_use_vorticity_threshold(self):
        centers = [
            {"lat": 20.0, "lon": 110.0, "vort": 0.00007},
            {"lat": 21.0, "lon": 111.0, "vort": 0.00005},
            {"lat": 22.0, "lon": 112.0, "vort": "bad"},
        ]
        visible = filter_vortex_centers(centers)
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]["lat"], 20.0)

    def test_vortex_tracks_keep_warm_active_paths(self):
        tracks = {
            "tracks": [
                {
                    "warm": True,
                    "track": [
                        {"step": 0, "lat": 18.0, "lon": 120.0},
                        {"step": 6, "lat": 19.0, "lon": 121.0},
                        {"step": 12, "lat": 20.0, "lon": 122.0},
                    ],
                },
                {
                    "warm": False,
                    "track": [
                        {"step": 0, "lat": 10.0, "lon": 130.0},
                        {"step": 12, "lat": 11.0, "lon": 131.0},
                    ],
                },
                {
                    "warm": True,
                    "track": [
                        {"step": 24, "lat": 15.0, "lon": 125.0},
                        {"step": 36, "lat": 16.0, "lon": 126.0},
                    ],
                },
            ]
        }
        visible = filter_vortex_tracks(tracks, "006")
        self.assertEqual(len(visible), 1)
        self.assertTrue(visible[0]["warm"])


class SituationMapTitleTests(unittest.TestCase):
    def test_forecast_bjt_label_from_utc_init_and_lead(self):
        self.assertEqual(forecast_bjt_label("2026080100", "024"), "2日08时 BJT")
        self.assertEqual(forecast_bjt_label("2026080100", "000"), "1日08时 BJT")
        self.assertEqual(forecast_bjt_label("2026080112", "012"), "2日08时 BJT")
        self.assertEqual(forecast_bjt_label("2026080100", "003"), "1日11时 BJT")

    def test_situation_title_includes_bjt_without_year_month(self):
        title = situation_title("2026080100", "024", PRODUCTS[500], REGIONS["china"])
        self.assertIn("2日08时 BJT", title)
        self.assertIn("起报 2026-08-01 00UTC", title)
        self.assertIn("时效 024h", title)
        self.assertNotIn("2026-08-02", title)


class SituationMapTileTests(unittest.TestCase):
    def test_region_tile_zoom_matches_frontend_named_views(self):
        self.assertEqual(REGIONS["china"].tile_z, 0)
        self.assertEqual(REGIONS["huanan"].tile_z, 2)
        self.assertEqual(REGIONS["guangdong"].tile_z, 2)

    def test_barb_uses_region_z_other_layers_stay_at_zero(self):
        self.assertEqual(tile_zoom_for_layer("wind_barb", 2), 2)
        self.assertEqual(tile_zoom_for_layer("hght_contour", 2), 0)
        self.assertEqual(tile_zoom_for_layer("wind_speed_fill", 2), 0)

    def test_barb_tile_paths_use_region_zoom(self):
        china = REGIONS["china"]
        guangdong = REGIONS["guangdong"]
        china_barbs = iter_tiles(china.bounds, [china.tile_z])
        guangdong_barbs = iter_tiles(guangdong.bounds, [guangdong.tile_z])
        self.assertTrue(china_barbs)
        self.assertTrue(guangdong_barbs)
        self.assertTrue(all(tile.z == 0 for tile in china_barbs))
        self.assertTrue(all(tile.z == 2 for tile in guangdong_barbs))
        china_paths = required_svg_paths(Path("products"), "2026062900", "006", PRODUCTS[500], china)
        guangdong_paths = required_svg_paths(Path("products"), "2026062900", "006", PRODUCTS[500], guangdong)
        self.assertTrue(any("/0/" in path.as_posix() and "wind_barb" in path.as_posix() for path in china_paths))
        self.assertTrue(any("/2/" in path.as_posix() and "wind_barb" in path.as_posix() for path in guangdong_paths))
        self.assertTrue(all("/0/" in path.as_posix() for path in china_paths if "hght_contour" in path.as_posix()))
        self.assertTrue(all("/0/" in path.as_posix() for path in guangdong_paths if "hght_contour" in path.as_posix()))

    def test_fixed_region_bounds(self):
        self.assertEqual(REGIONS["china"].bounds.as_dict(), {
            "lon_min": 60.0, "lon_max": 150.0, "lat_min": 0.0, "lat_max": 60.0,
        })
        self.assertEqual(REGIONS["huanan"].bounds.as_dict(), {
            "lon_min": 100.0, "lon_max": 125.0, "lat_min": 15.0, "lat_max": 30.0,
        })
        self.assertEqual(REGIONS["guangdong"].bounds.as_dict(), {
            "lon_min": 109.0, "lon_max": 118.0, "lat_min": 20.0, "lat_max": 26.0,
        })

    def test_guangdong_uses_denser_barb_skip(self):
        self.assertEqual(REGIONS["guangdong"].barb_skip, 1)
        self.assertIsNone(REGIONS["china"].barb_skip)
        self.assertIsNone(REGIONS["huanan"].barb_skip)

    def test_china_thickens_non_500_height_contours(self):
        self.assertTrue(should_thicken_height_contours("china", 200, "hght_contour"))
        self.assertTrue(should_thicken_height_contours("china", 850, "hght_contour"))
        self.assertTrue(should_thicken_height_contours("china", 925, "hght_contour"))
        self.assertFalse(should_thicken_height_contours("china", 500, "hght_contour"))
        self.assertFalse(should_thicken_height_contours("huanan", 200, "hght_contour"))
        self.assertFalse(should_thicken_height_contours("china", 200, "wind_barb"))


class SituationMapBasemapTests(unittest.TestCase):
    def test_decode_topojson_line_and_polygon(self):
        topo = {
            "transform": {"scale": [1.0, 1.0], "translate": [100.0, 20.0]},
            "arcs": [[[0, 0], [2, 0], [0, 2]], [[0, 0], [0, 3]]],
            "objects": {
                "lines": {
                    "type": "GeometryCollection",
                    "geometries": [{"type": "LineString", "arcs": [0]}],
                }
            },
        }
        decoded = decode_arcs(topo)
        self.assertEqual(decoded[0], [(100.0, 20.0), (102.0, 20.0), (102.0, 22.0)])
        lines = geometry_lines({"type": "LineString", "arcs": [0]}, decoded)
        self.assertEqual(len(lines[0]), 3)

    def test_frontend_map_files_decode(self):
        self.assertTrue(WORLD_TOPO_PATH.is_file())
        self.assertTrue(CHINA_TOPO_PATH.is_file())
        import json

        world = json.loads(WORLD_TOPO_PATH.read_text(encoding="utf-8"))
        china = json.loads(CHINA_TOPO_PATH.read_text(encoding="utf-8"))
        world_lines = object_lines(world, "land")
        china_lines = object_lines(china, "bou2_4l")
        self.assertGreater(len(world_lines), 0)
        self.assertGreater(len(china_lines), 100)


class SituationMapReadinessTests(unittest.TestCase):
    def test_job_waits_until_svg_and_json_exist(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "data"
            products_root = output_root / "products"
            job = SituationJob("2026062900", "006", 500, "china")
            self.assertFalse(job_is_ready(job, products_root, output_root))

            for path in required_svg_paths(products_root, job.init_time, job.fc_hour, job.product, job.region):
                _touch(path)
            self.assertFalse(job_is_ready(job, products_root, output_root))

            for path in required_json_paths(output_root, job.init_time, job.fc_hour, job.product):
                _write_json(path, [] if "vortex_center" in path.name else {"trough_lines": []})
            self.assertTrue(job_is_ready(job, products_root, output_root))

    def test_850_requires_track_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "data"
            products_root = output_root / "products"
            job = SituationJob("2026062900", "006", 850, "huanan")
            for path in required_svg_paths(products_root, job.init_time, job.fc_hour, job.product, job.region):
                _touch(path)
            json_paths = required_json_paths(output_root, job.init_time, job.fc_hour, job.product)
            self.assertTrue(any("vortex_tracks" in str(path) for path in json_paths))
            for path in json_paths:
                if "vortex_tracks" in str(path):
                    continue
                _write_json(path, [] if "vortex_center" in path.name else {"trough_lines": []})
            self.assertFalse(job_is_ready(job, products_root, output_root))
            track_path = next(path for path in json_paths if "vortex_tracks" in str(path))
            _write_json(track_path, {"tracks": []})
            self.assertTrue(job_is_ready(job, products_root, output_root))

    def test_skip_existing_when_jpg_is_newer(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "source.svg"
            jpg = Path(tmpdir) / "out.jpg"
            _touch(source)
            time.sleep(0.05)
            jpg.write_bytes(b"jpeg")
            self.assertTrue(should_skip_existing(jpg, [source], overwrite=False))
            self.assertFalse(should_skip_existing(jpg, [source], overwrite=True))
            time.sleep(0.05)
            source.write_bytes(b"updated")
            self.assertFalse(should_skip_existing(jpg, [source], overwrite=False))

    def test_sources_are_stable_after_debounce(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "layer.svg"
            _touch(source)
            now = source.stat().st_mtime
            self.assertFalse(sources_are_stable([source], debounce_s=10, now=now + 1))
            self.assertTrue(sources_are_stable([source], debounce_s=10, now=now + 11))

    def test_process_job_skips_without_rendering(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "data"
            products_root = output_root / "products"
            job = SituationJob("2026062900", "006", 500, "china")
            sources = [
                *required_svg_paths(products_root, job.init_time, job.fc_hour, job.product, job.region),
                *required_json_paths(output_root, job.init_time, job.fc_hour, job.product),
            ]
            for path in sources:
                if path.suffix == ".json":
                    _write_json(path, [] if "vortex_center" in path.name else {"trough_lines": []})
                else:
                    _touch(path)
            jpg = situation_jpg_path(output_root, job.init_time, job.fc_hour, job.level, job.region_key)
            time.sleep(0.05)
            jpg.parent.mkdir(parents=True, exist_ok=True)
            jpg.write_bytes(b"existing")
            with patch("situation_maps.generate_situation_maps.render_situation_map") as render_mock:
                status = process_job(
                    job,
                    products_root,
                    output_root,
                    overwrite=False,
                    debounce_s=0,
                    dpi=72,
                )
            self.assertEqual(status, "skip")
            render_mock.assert_not_called()

    def test_process_job_writes_when_ready(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "data"
            products_root = output_root / "products"
            job = SituationJob("2026062900", "006", 200, "guangdong")
            for path in required_svg_paths(products_root, job.init_time, job.fc_hour, job.product, job.region):
                _touch(path)
            for path in required_json_paths(output_root, job.init_time, job.fc_hour, job.product):
                _write_json(path, [] if "vortex_center" in path.name else {"trough_lines": []})
            with patch("situation_maps.generate_situation_maps.render_situation_map") as render_mock:
                status = process_job(
                    job,
                    products_root,
                    output_root,
                    overwrite=False,
                    debounce_s=0,
                    dpi=72,
                )
            self.assertEqual(status, "written")
            render_mock.assert_called_once()
            self.assertTrue(PRODUCTS[200].wind_speed_colorbar)


if __name__ == "__main__":
    unittest.main()
