import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import xarray as xr

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from draw import generate_svg_layers  # noqa: E402
from draw.svg_layer_data import (  # noqa: E402
    accumulated_precipitation,
    accumulation_start_hour,
)
from draw.svg_layer_geometry import Bounds  # noqa: E402
from draw.svg_layer_rendering import preprocess_surface_layer  # noqa: E402
from draw.svg_layer_workflow import generate_surface_layers  # noqa: E402


class GenerateSvgLayersTests(unittest.TestCase):
    @patch("draw.svg_layer_workflow.os.cpu_count", return_value=8)
    def test_default_worker_count_reserves_two_cpus(self, cpu_count_mock):
        self.assertEqual(generate_svg_layers.default_worker_count(), 6)
        cpu_count_mock.assert_called_once_with()

    @patch("draw.svg_layer_workflow.os.cpu_count", return_value=2)
    def test_default_worker_count_never_falls_below_one(self, cpu_count_mock):
        self.assertEqual(generate_svg_layers.default_worker_count(), 1)
        cpu_count_mock.assert_called_once_with()

    def test_save_svg_closes_figure_after_saving(self):
        figure = Mock()

        with tempfile.TemporaryDirectory() as tmpdir, patch(
            "draw.svg_layer_rendering.plt.close"
        ) as close_mock:
            generate_svg_layers.save_svg(figure, Path(tmpdir) / "layer.svg")

        close_mock.assert_called_once_with(figure)

    def test_save_svg_closes_figure_when_saving_fails(self):
        figure = Mock()
        figure.savefig.side_effect = OSError("disk unavailable")

        with tempfile.TemporaryDirectory() as tmpdir, patch(
            "draw.svg_layer_rendering.plt.close"
        ) as close_mock:
            with self.assertRaisesRegex(OSError, "disk unavailable"):
                generate_svg_layers.save_svg(figure, Path(tmpdir) / "layer.svg")

        close_mock.assert_called_once_with(figure)

    def test_accumulation_start_hour_requires_both_forecast_endpoints(self):
        self.assertEqual(accumulation_start_hour("024", 24), "000")
        self.assertEqual(accumulation_start_hour("078", 24), "054")
        self.assertEqual(accumulation_start_hour("078", 6), "072")
        self.assertIsNone(accumulation_start_hour("078", 3))
        self.assertIsNone(accumulation_start_hour("003", 6))

    def test_accumulated_precipitation_subtracts_endpoints_and_converts_metres(self):
        end = xr.DataArray(
            np.array([[0.012]]),
            dims=("lat", "lon"),
            attrs={"units": "m"},
        )
        start = xr.DataArray(
            np.array([[0.002]]),
            dims=("lat", "lon"),
            attrs={"units": "m"},
        )

        result = accumulated_precipitation(end, start)

        self.assertEqual(result.attrs["units"], "mm")
        self.assertAlmostEqual(float(result.item()), 10.0)

    def test_accumulated_precipitation_treats_missing_tppm_unit_as_metres(self):
        end = xr.DataArray(np.array([[0.006]]), dims=("lat", "lon"))
        start = xr.DataArray(np.array([[0.001]]), dims=("lat", "lon"))

        result = accumulated_precipitation(end, start)

        self.assertEqual(result.attrs["units"], "mm")
        self.assertAlmostEqual(float(result.item()), 5.0)

    def test_surface_precipitation_preprocessing_keeps_accumulation_field(self):
        precipitation = xr.DataArray(np.array([[12.0]]), dims=("lat", "lon"))

        result = preprocess_surface_layer(
            "rain_6h_fill",
            {},
            {"precipitation": precipitation},
        )

        self.assertIs(result["precipitation"], precipitation)

    @patch("draw.svg_layer_workflow._generate_layers", return_value=[])
    def test_surface_precipitation_layers_follow_available_forecast_intervals(self, generate_mock):
        args = Namespace(init_time="2026072700")
        bounds = Bounds(60, 150, 0, 60)

        generate_surface_layers(args, "078", bounds)
        layer_types = generate_mock.call_args.args[4]
        self.assertIn("rain_24h_fill", layer_types)
        self.assertIn("rain_6h_fill", layer_types)
        self.assertNotIn("rain_3h_fill", layer_types)

        generate_surface_layers(args, "003", bounds)
        layer_types = generate_mock.call_args.args[4]
        self.assertNotIn("rain_24h_fill", layer_types)
        self.assertNotIn("rain_6h_fill", layer_types)
        self.assertIn("rain_3h_fill", layer_types)


if __name__ == "__main__":
    unittest.main()
