import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from vortex_common import (  # noqa: E402
    center_json_path,
    forecast_time,
    format_fc_hour,
    haversine_distance,
    read_json,
    warm_json_path,
    write_json,
)
from vortex_workflow import run_vortex_workflow  # noqa: E402
from vortex_tracker import (  # noqa: E402
    VortexPreflightError,
    VortexTracker,
    predict_position,
    preflight_tracking_inputs,
    run_tracking_workflow,
)
import trough  # noqa: E402


class VortexCommonTests(unittest.TestCase):
    def test_format_fc_hour_and_forecast_time(self):
        self.assertEqual(format_fc_hour("6"), "006")
        self.assertEqual(format_fc_hour(24), "024")
        self.assertEqual(forecast_time("2026062900", "006").strftime("%Y-%m-%d %H:%M:%S"), "2026-06-29 06:00:00")

    def test_haversine_distance(self):
        self.assertAlmostEqual(haversine_distance(0, 0, 0, 1), 111.19, places=1)


class VortexTrackerTests(unittest.TestCase):
    def test_predict_position_moves_east(self):
        lon, lat = predict_position(lon=120.0, lat=10.0, speed=111.0, bearing=90.0, time_interval_hours=1.0)
        self.assertGreater(lon, 120.0)
        self.assertAlmostEqual(lat, 10.0, delta=0.1)

    def test_jump_limit_blocks_large_forward_match(self):
        tracker = VortexTracker(max_jump_km=1000.0)
        track = [
            {"lon": 120.0, "lat": 10.0, "fore_time": "2026-06-29 00:00:00"},
            {"lon": 121.0, "lat": 10.0, "fore_time": "2026-06-29 06:00:00"},
        ]
        candidates = [{"lon": 150.0, "lat": 10.0, "fore_time": "2026-06-29 12:00:00"}]
        matched, success = tracker.forward_speed_match(track, candidates, set(), 6.0)
        self.assertIsNone(matched)
        self.assertFalse(success)

    def test_preflight_requires_warm_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            init_time = "2026062900"
            write_json(center_json_path(tmpdir, init_time, "000", 850), [])
            with self.assertRaises(VortexPreflightError):
                preflight_tracking_inputs(tmpdir, init_time, ["000"])

    def test_tracking_accepts_empty_ready_hour(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            init_time = "2026062900"
            for fc_hour in ["000", "006", "012"]:
                write_json(center_json_path(tmpdir, init_time, fc_hour, 850), [])
                write_json(warm_json_path(tmpdir, init_time, fc_hour), [])

            result = run_tracking_workflow(
                init_time=init_time,
                fc_hours=["000", "006", "012"],
                output_root=tmpdir,
                show_progress=False,
            )
            self.assertEqual(result["status"], "completed")
            data = read_json(result["json_path"])
            self.assertEqual(data["total_tracks"], 0)


class VortexWorkflowTests(unittest.TestCase):
    def test_wrapper_tracks_only_warm_ready_hours(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            init_time = "2026062900"

            def fake_center(**kwargs):
                fc_hour = kwargs["fc_hours"][0]
                if fc_hour == "000":
                    write_json(center_json_path(tmpdir, init_time, fc_hour, 850), [])
                    return [
                        {
                            "init_time": init_time,
                            "fc_hour": fc_hour,
                            "level": 850,
                            "status": "completed",
                        }
                    ]
                return [
                    {
                        "init_time": init_time,
                        "fc_hour": fc_hour,
                        "level": 850,
                        "status": "aborted",
                    }
                ]

            def fake_warm(**kwargs):
                fc_hour = kwargs["fc_hours"][0]
                write_json(warm_json_path(tmpdir, init_time, fc_hour), [])
                return [
                    {
                        "init_time": init_time,
                        "fc_hour": fc_hour,
                        "status": "completed",
                    }
                ]

            with patch("vortex_workflow.run_center_identification", side_effect=fake_center), \
                    patch("vortex_workflow.run_warm_core_identification", side_effect=fake_warm), \
                    patch("vortex_workflow.run_tracking_workflow") as tracking_mock:
                tracking_mock.return_value = {
                    "status": "completed",
                    "fc_hours": ["000"],
                    "total_tracks": 0,
                }
                summary = run_vortex_workflow(
                    init_time=init_time,
                    fc_hours=["000", "006"],
                    levels=[850],
                    output_root=tmpdir,
                    show_progress=False,
                )

            self.assertEqual(summary["center_ready_fc_hours"], ["000"])
            self.assertEqual(summary["warm_ready_fc_hours"], ["000"])
            tracking_mock.assert_called_once()
            self.assertEqual(tracking_mock.call_args.kwargs["fc_hours"], ["000"])


class TroughUpdateTests(unittest.TestCase):
    def test_trough_batch_continues_after_one_failed_hour(self):
        trough_data = {
            "init_time": "2026062900",
            "fc_hour": "006",
            "target_lev": 500,
            "source": "ecmwfthin",
            "units": {},
            "config": {},
            "trough_lines": [],
        }

        def fake_plot(init_time, fc_hour, target_lev, source, config, create_plot):
            if fc_hour == "000":
                raise trough.WeatherDataReadError("not ready")
            return None, trough_data

        with tempfile.TemporaryDirectory() as tmpdir, patch("trough.plot_trough_analysis", side_effect=fake_plot):
            summary = trough.get_multi_fc_trough_by_init_time(
                init_time="2026062900",
                fc_hours=["000", "006"],
                target_levs=[500],
                output_root=tmpdir,
                save_image=False,
                save_json=True,
                show_progress=False,
            )

        self.assertEqual([item["status"] for item in summary], ["aborted", "completed"])
        self.assertEqual(summary[1]["fc_hour"], "006")


if __name__ == "__main__":
    unittest.main()
