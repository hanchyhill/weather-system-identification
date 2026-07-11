import sys
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

import schedule  # noqa: E402


class ScheduleTests(unittest.TestCase):
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
