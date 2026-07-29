import sys
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

import schedule  # noqa: E402


class ScheduleTests(unittest.TestCase):
    def test_cycle_does_not_save_jet_or_trough_images_by_default(self):
        with patch("schedule.calLatestBaseTime", return_value="2026071100"), \
                patch("schedule.run_jet") as jet_mock, \
                patch("schedule.run_trough") as trough_mock, \
                patch("schedule.run_cold_front_identification"), \
                patch("schedule.run_vortex_workflow"):
            schedule.run_cycle(
                output_root="test-data",
                source="test-source",
                save_json=True,
                show_progress=False,
            )

        self.assertFalse(jet_mock.call_args.kwargs["save_image"])
        self.assertFalse(trough_mock.call_args.kwargs["save_image"])
        self.assertTrue(jet_mock.call_args.kwargs["save_json"])
        self.assertTrue(trough_mock.call_args.kwargs["save_json"])

    def test_cycle_can_save_jet_and_trough_images_when_requested(self):
        with patch("schedule.calLatestBaseTime", return_value="2026071100"), \
                patch("schedule.run_jet") as jet_mock, \
                patch("schedule.run_trough") as trough_mock, \
                patch("schedule.run_cold_front_identification"), \
                patch("schedule.run_vortex_workflow"):
            schedule.run_cycle(
                output_root="test-data",
                save_jet_trough_image=True,
                show_progress=False,
            )

        self.assertTrue(jet_mock.call_args.kwargs["save_image"])
        self.assertTrue(trough_mock.call_args.kwargs["save_image"])

    def test_cycle_runs_cold_front_with_other_weather_systems(self):
        with patch("schedule.calLatestBaseTime", return_value="2026071100"), \
                patch("schedule.run_jet"), \
                patch("schedule.run_trough"), \
                patch("schedule.run_cold_front_identification") as cold_front_mock, \
                patch("schedule.run_vortex_workflow"):
            results = schedule.run_cycle(
                output_root="test-data",
                source="test-source",
                save_image=False,
                save_json=True,
                show_progress=False,
            )

        self.assertEqual(
            results,
            {"jet": True, "trough": True, "cold_front": True, "vortex_workflow": True},
        )
        cold_front_mock.assert_called_once_with(
            init_time="2026071100",
            output_root="test-data",
            source="test-source",
            save_image=False,
            save_json=True,
            show_progress=False,
        )


if __name__ == "__main__":
    unittest.main()
