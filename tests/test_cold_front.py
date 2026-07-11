import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import xarray as xr


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

import cold_front  # noqa: E402


def _field(values, lat=None, lon=None):
    lat = np.asarray(lat if lat is not None else [30.0, 31.0, 32.0])
    lon = np.asarray(lon if lon is not None else [110.0, 111.0, 112.0])
    return xr.DataArray(values, coords={"lat": lat, "lon": lon}, dims=("lat", "lon"))


class ColdFrontTests(unittest.TestCase):
    def test_warm_boundary_returns_east_and_south_edges(self):
        coarse = np.zeros((4, 4), dtype=bool)
        coarse[1:3, 1:3] = True

        boundary = cold_front.extract_warm_boundary(coarse)

        self.assertTrue(boundary[1, 2])
        self.assertTrue(boundary[1, 1])
        self.assertTrue(boundary[2, 2])
        self.assertFalse(boundary[2, 1])

    def test_aggregate_uses_fraction_threshold_and_partial_edge_blocks(self):
        mask = np.zeros((3, 5), dtype=bool)
        mask[:2, :2] = True
        coarse, lat, lon, lat_factor, lon_factor = cold_front.aggregate_frontal_zone(
            mask, np.asarray([0.0, 1.0, 2.0]), np.asarray([10.0, 11.0, 12.0, 13.0, 14.0]), 2.0, 0.5
        )

        self.assertEqual((lat_factor, lon_factor), (2, 2))
        self.assertEqual(coarse.shape, (2, 3))
        self.assertTrue(coarse[0, 0])
        self.assertFalse(coarse[1, 2])
        self.assertEqual(lat.tolist(), [0.5, 2.0])
        self.assertEqual(lon.tolist(), [10.5, 12.5, 14.0])

    def test_build_json_uses_lat_lon_points(self):
        advection = _field(np.full((3, 3), -2e-4))
        tfp = _field(np.full((3, 3), 1e-12))
        payload = cold_front.build_cold_front_json(
            "2026071100", "006", "ecmwfthin", cold_front.COLD_FRONT_CONFIG,
            [np.asarray([[30.0, 110.0], [31.0, 111.0]])], {"advection": advection, "tfp": tfp},
        )

        record = payload["cold_front_lines"][0]
        self.assertEqual(record["points"][0], {"lat": 30.0, "lon": 110.0})
        self.assertEqual(payload["fore_time"], "2026-07-11 06:00:00")
        self.assertGreater(record["attributes"]["length_km"], 0)

    def test_fitted_line_is_bezier_smoothed_and_has_east_to_west_direction(self):
        boundary = np.zeros((10, 10), dtype=bool)
        boundary[1:9, 4:6] = True
        lat = np.arange(10.0)
        lon = np.arange(10.0)
        row_indices, col_indices = np.where(boundary)
        raw_points = np.column_stack((lat[row_indices], lon[col_indices]))

        lines = cold_front.fit_cold_front_lines(
            boundary,
            lat,
            lon,
            minimum_component_points=1,
            minimum_length_km=0,
            line_point_count=12,
            num_control_points=4,
        )

        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0].shape, (12, 2))
        self.assertGreaterEqual(lines[0][0, 1], lines[0][-1, 1])

    def test_orient_cold_front_line_reverses_west_to_east_line(self):
        west_to_east = np.asarray([[30.0, 100.0], [31.0, 105.0]])

        oriented = cold_front.orient_cold_front_line(west_to_east)

        np.testing.assert_allclose(oriented, west_to_east[::-1])

    def test_orient_cold_front_line_keeps_east_to_west_line(self):
        east_to_west = np.asarray([[30.0, 105.0], [31.0, 100.0]])

        oriented = cold_front.orient_cold_front_line(east_to_west)

        np.testing.assert_allclose(oriented, east_to_west)

    def test_orient_cold_front_line_uses_north_to_south_for_meridional_line(self):
        south_to_north = np.asarray([[20.0, 105.0], [30.0, 105.0]])

        oriented = cold_front.orient_cold_front_line(south_to_north)

        np.testing.assert_allclose(oriented, south_to_north[::-1])

    def test_workflow_skips_existing_json_without_reading_data(self):
        with tempfile.TemporaryDirectory() as tmpdir, patch("cold_front.read_cold_front_fields") as reader:
            output_path = cold_front.cold_front_json_path(tmpdir, "2026071100", "000")
            output_path.parent.mkdir(parents=True)
            output_path.write_text("{}", encoding="utf-8")
            summary = cold_front.run_cold_front_identification(
                init_time="2026071100", fc_hours=["000"], levels=[850], output_root=tmpdir, show_progress=False
            )

        reader.assert_not_called()
        self.assertEqual(summary[0]["status"], "skipped")
        self.assertEqual(summary[0]["skipped_files"], [str(output_path)])

    def test_json_path_includes_requested_pressure_level(self):
        path = cold_front.cold_front_json_path("data", "2026071100", "006", 925)

        self.assertEqual(path.name, "cold_front_2026071100_006_925hPa.json")


if __name__ == "__main__":
    unittest.main()
