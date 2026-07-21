import sys
import unittest
from pathlib import Path

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / 'src'
sys.path.insert(0, str(SRC_DIR))

import trough  # noqa: E402


class TroughLineSplitTests(unittest.TestCase):
    def test_visual_gap_trims_plot_copy_without_changing_source_lines(self):
        lines = [
            np.asarray([[0.0, 0.0], [0.0, 0.5], [0.0, 1.0]]),
            np.asarray([[0.0, 1.2], [0.0, 1.7], [0.0, 2.2]]),
        ]

        plot_lines = trough.trim_nearby_line_endpoints(
            lines, nearby_distance=0.3, trim_length=0.4
        )

        self.assertEqual(lines[0][-1].tolist(), [0.0, 1.0])
        self.assertEqual(lines[1][0].tolist(), [0.0, 1.2])
        self.assertLess(plot_lines[0][-1][1], 1.0)
        self.assertGreater(plot_lines[1][0][1], 1.2)

    def test_two_point_line_is_sampled_as_linear_bezier(self):
        line = np.asarray([[0.0, 0.0], [2.0, 4.0]])

        smoothed = trough.smooth_lines_bezier([line], num_points=5)

        self.assertEqual(len(smoothed[0]), 5)
        np.testing.assert_allclose(smoothed[0][0], line[0])
        np.testing.assert_allclose(smoothed[0][-1], line[-1])

    def test_long_line_splits_at_largest_original_gap(self):
        line = np.asarray([
            [0.0, 0.0],
            [0.0, 1.0],
            [0.0, 2.0],
            [0.0, 6.0],
            [0.0, 7.0],
        ])

        segments = trough.split_lines_by_max_length([line], max_line_length=5.0)

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0].tolist(), line[:3].tolist())
        self.assertEqual(segments[1].tolist(), line[3:].tolist())

    def test_curved_line_splits_at_excessive_local_turn(self):
        line = np.asarray([
            [0.0, 0.0],
            [0.0, 1.0],
            [0.0, 2.0],
            [1.0, 2.0],
            [2.0, 2.0],
            [3.0, 2.0],
        ])

        segments = trough.split_lines_by_turn_angle(
            [line], max_turn_angle=60.0, turn_angle_window=1
        )

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0][-1].tolist(), [0.0, 2.0])
        self.assertEqual(segments[1][0].tolist(), [1.0, 2.0])
        flattened = [point.tolist() for segment in segments for point in segment]
        self.assertEqual(flattened, line.tolist())

    def test_boundary_largest_gap_does_not_drop_original_points(self):
        line = np.asarray([
            [0.0, 0.0],
            [0.0, 5.0],
            [0.0, 6.0],
            [0.0, 7.0],
            [0.0, 8.0],
        ])

        segments = trough.split_lines_by_max_length([line], max_line_length=6.0)

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0][0].tolist(), line[0].tolist())
        self.assertEqual(segments[-1][-1].tolist(), line[-1].tolist())
        flattened = [point.tolist() for segment in segments for point in segment]
        self.assertEqual(flattened, line.tolist())

    def test_straight_line_is_not_split(self):
        line = np.asarray([[0.0, 0.0], [0.0, 1.0], [0.0, 2.0]])

        segments = trough.split_lines_by_turn_angle(
            [line], max_turn_angle=30.0, turn_angle_window=1
        )

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].tolist(), line.tolist())

    def test_consecutive_excessive_turns_split_only_once(self):
        line = np.asarray([
            [0.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [1.0, 0.0],
            [2.0, 0.0],
            [3.0, 0.0],
        ])

        segments = trough.split_lines_by_turn_angle(
            [line], max_turn_angle=45.0, turn_angle_window=1
        )

        self.assertEqual(len(segments), 2)


if __name__ == '__main__':
    unittest.main()
