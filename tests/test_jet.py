import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import xarray as xr


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

import jet  # noqa: E402


def _wind_field(u_value=10.0, v_value=0.0):
    latitude = np.asarray([0.0])
    longitude = np.asarray([0.0, 1.0, 2.0, 3.0, 4.0, 5.0])
    coords = {"lat": latitude, "lon": longitude}
    dims = ("lat", "lon")
    uwnd = xr.DataArray(
        np.full((len(latitude), len(longitude)), u_value),
        coords=coords,
        dims=dims,
    )
    vwnd = xr.DataArray(
        np.full((len(latitude), len(longitude)), v_value),
        coords=coords,
        dims=dims,
    )
    return uwnd, vwnd


class JetAxisTests(unittest.TestCase):
    def test_extract_jet_axis_points_returns_lon_lat_points(self):
        latitude = xr.DataArray([10.0, 11.0], dims=("lat",), name="lat")
        longitude = xr.DataArray([100.0, 101.0], dims=("lon",), name="lon")
        coords = {"lat": latitude, "lon": longitude}
        dims = ("lat", "lon")
        adv_s = xr.DataArray([[1.0, 0.0], [-1.0, 0.0]], coords=coords, dims=dims)
        speed = xr.DataArray([[5.0, 0.0], [5.0, 0.0]], coords=coords, dims=dims)
        u_r = xr.DataArray(np.zeros((2, 2)), coords=coords, dims=dims)
        v_r = xr.DataArray(np.ones((2, 2)), coords=coords, dims=dims)

        points = jet.extract_jet_axis_points(
            adv_s, speed, u_r, v_r, longitude, latitude, speed_threshold=4.0
        )

        self.assertEqual(points.tolist(), [[100.0, 10.0]])

    def test_adjust_line_direction_reverses_line_against_wind(self):
        uwnd, vwnd = _wind_field(u_value=10.0, v_value=0.0)
        lines = [[np.asarray([2.0, 0.0]), np.asarray([1.0, 0.0]), np.asarray([0.0, 0.0])]]

        adjusted = jet.adjust_line_direction(lines, uwnd, vwnd)

        self.assertEqual(np.asarray(adjusted[0]).tolist(), [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]])

    def test_build_jet_json_contains_lines_points_and_attributes(self):
        uwnd, vwnd = _wind_field(u_value=3.0, v_value=4.0)
        lines = [np.asarray([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]])]
        smoothed_lines = [np.asarray([[0.0, 0.0], [0.5, 0.0], [1.0, 0.0]])]

        line_records = jet.build_jet_line_records(lines, smoothed_lines, uwnd, vwnd)
        payload = jet.build_jet_json(
            init_time="2026062900",
            fc_hour="006",
            target_lev=850,
            source="ecmwfthin",
            config=jet.JET_CONFIG,
            jet_axis_lines=line_records,
        )

        self.assertIn("jet_axis_lines", payload)
        self.assertEqual(payload["jet_axis_lines"][0]["points"][0], {"lat": 0.0, "lon": 0.0})
        self.assertIn("smoothed_points", payload["jet_axis_lines"][0])
        self.assertIn("region_box", payload["jet_axis_lines"][0]["attributes"])
        self.assertEqual(payload["jet_axis_lines"][0]["attributes"]["avg_wind_speed"], 5.0)
        self.assertEqual(payload["jet_axis_lines"][0]["attributes"]["max_wind_speed"], 5.0)

    def test_jet_batch_continues_after_one_failed_hour(self):
        jet_data = {
            "init_time": "2026062900",
            "fc_hour": "006",
            "target_lev": 850,
            "source": "ecmwfthin",
            "units": {},
            "config": {},
            "jet_axis_lines": [],
        }

        def fake_plot(init_time, fc_hour, target_lev, source, config, create_plot):
            if fc_hour == "000":
                raise jet.WeatherDataError("not ready")
            return None, jet_data

        with tempfile.TemporaryDirectory() as tmpdir, patch("jet.plot_jet_analysis", side_effect=fake_plot):
            summary = jet.get_multi_fc_jet_by_init_time(
                init_time="2026062900",
                fc_hours=["000", "006"],
                target_levs=[850],
                output_root=tmpdir,
                save_image=False,
                save_json=True,
                show_progress=False,
            )

        self.assertEqual([item["status"] for item in summary], ["aborted", "completed"])
        self.assertEqual(summary[1]["fc_hour"], "006")


if __name__ == "__main__":
    unittest.main()
