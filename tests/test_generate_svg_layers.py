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
from draw.svg_layer_manifest import write_json_atomic  # noqa: E402
from draw.svg_layer_rendering import (  # noqa: E402
    BOUND_VORT,
    CLRMAP_VORT,
    COLOR_ARR_VORT,
    COLOR_ARR_VORT_HIGH,
    COLOR_ARR_VORT_LOW,
    VORT_HIGH_BAND_COUNT,
    VORT_LOW_BAND_COUNT,
    preprocess_surface_layer,
)
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
        self.assertEqual(accumulation_start_hour("006", 6), "000")
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

    @patch("draw.svg_layer_workflow._generate_layers")
    @patch("draw.svg_layer_workflow.open_data_array")
    def test_first_valid_precipitation_window_uses_end_point_only(self, open_data_mock, generate_mock):
        endpoint = xr.DataArray(
            np.array([[0.006]]),
            dims=("lat", "lon"),
            attrs={"units": "m"},
        )
        open_data_mock.return_value = endpoint
        loaded_fields = {}

        def load_first_precipitation(*call_args):
            layer_type = next(layer for layer in call_args[4] if layer.startswith("rain_"))
            fields, _ = call_args[5](layer_type, None)
            loaded_fields["layer_type"] = layer_type
            loaded_fields["precipitation"] = fields["precipitation"]
            return [fields]

        generate_mock.side_effect = load_first_precipitation
        args = Namespace(
            init_time="2026072700",
            source="ecmwfthin",
            base_url_template="http://example/{source}/",
            tppm_path="tppm.nc",
            tppm_var="tppm{fc_hour}",
        )

        for fc_hour, layer_type in (("024", "rain_24h_fill"), ("006", "rain_6h_fill")):
            with self.subTest(fc_hour=fc_hour):
                open_data_mock.reset_mock()
                generate_surface_layers(args, fc_hour, Bounds(60, 150, 0, 60))

                self.assertEqual(open_data_mock.call_count, 1)
                self.assertEqual(loaded_fields["layer_type"], layer_type)
                self.assertAlmostEqual(float(loaded_fields["precipitation"].item()), 6.0)
                self.assertNotIn("tppm000", open_data_mock.call_args.args[1])

    @patch("draw.svg_layer_workflow._generate_layers", return_value=[])
    def test_three_hour_precipitation_is_scheduled_only_for_available_windows(self, generate_mock):
        args = Namespace(init_time="2026072700")
        bounds = Bounds(60, 150, 0, 60)

        generate_surface_layers(args, "003", bounds)
        self.assertIn("rain_3h_fill", generate_mock.call_args.args[4])

        generate_surface_layers(args, "078", bounds)
        self.assertNotIn("rain_3h_fill", generate_mock.call_args.args[4])

    def test_surface_precipitation_preprocessing_keeps_accumulation_field(self):
        precipitation = xr.DataArray(np.array([[12.0]]), dims=("lat", "lon"))

        result = preprocess_surface_layer(
            "rain_6h_fill",
            {},
            {"precipitation": precipitation},
        )

        self.assertIs(result["precipitation"], precipitation)

    def test_vorticity_fill_uses_two_low_blue_bands_then_six_high_bands(self):
        """低值段 2 档蓝 + 高值段 6 档黄橙红，共 8 档。

        涡度场噪声大，色阶越密 contourf 的多边形碎片越多。实测同数据 A/B：
        高值段 85 档时 67.64 MB，收到 6 档后 9.63 MB，低值段再从 4 档收到 2 档
        后 7.40 MB。0.05–0.15 仅跨 0.1 却落在噪声主导区，是碎片化最重的区间。
        """
        self.assertEqual(len(BOUND_VORT) - 1, len(COLOR_ARR_VORT))
        np.testing.assert_allclose(
            BOUND_VORT, [0.05, 0.10, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 1.00]
        )
        self.assertEqual(len(COLOR_ARR_VORT_LOW), VORT_LOW_BAND_COUNT)
        self.assertEqual(len(COLOR_ARR_VORT_HIGH), VORT_HIGH_BAND_COUNT)
        self.assertEqual((VORT_LOW_BAND_COUNT, VORT_HIGH_BAND_COUNT), (2, 6))
        self.assertAlmostEqual(float(BOUND_VORT[-1]), 1.0)
        self.assertEqual(COLOR_ARR_VORT[:VORT_LOW_BAND_COUNT], COLOR_ARR_VORT_LOW)
        self.assertEqual(tuple(CLRMAP_VORT.get_under()), (1.0, 1.0, 1.0, 0.0))

    @patch("draw.svg_layer_manifest.time.sleep")
    @patch("draw.svg_layer_manifest.os.replace")
    def test_atomic_json_write_retries_temporary_windows_file_lock(self, replace_mock, sleep_mock):
        replace_mock.side_effect = [PermissionError(13, "Permission denied"), None]

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifest.json"
            self.assertEqual(write_json_atomic(path, {"status": "ok"}), path)

            temporary_path, target_path = replace_mock.call_args.args
            self.assertEqual(target_path, path)
            self.assertFalse(temporary_path.exists())

        self.assertEqual(replace_mock.call_count, 2)
        sleep_mock.assert_called_once_with(0.05)

    @patch("draw.svg_layer_manifest.time.sleep")
    @patch("draw.svg_layer_manifest.os.replace", side_effect=PermissionError(13, "Permission denied"))
    def test_atomic_json_write_falls_back_to_in_place_write_for_persistent_windows_lock(self, replace_mock, sleep_mock):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifest.json"
            path.write_text('{"status": "old"}', encoding="utf-8")

            # os.name 的补丁只包住被测调用：os 是单例模块，patch 它会全局生效，
            # 而 pathlib 依赖 os.name 选择 PosixPath/WindowsPath，
            # 在 Linux 上提前打补丁会让后续 Path(...) 抛 UnsupportedOperation。
            with patch("draw.svg_layer_manifest.os.name", "nt"):
                self.assertEqual(write_json_atomic(path, {"status": "new"}), path)

            self.assertEqual(path.read_text(encoding="utf-8"), '{\n  "status": "new"\n}')
            self.assertFalse(list(path.parent.glob("manifest.json.tmp.*")))

        self.assertEqual(replace_mock.call_count, 7)
        self.assertEqual(sleep_mock.call_count, 6)

if __name__ == "__main__":
    unittest.main()
