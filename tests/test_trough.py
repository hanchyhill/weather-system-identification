import sys
import unittest
from pathlib import Path

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / 'src'
sys.path.insert(0, str(SRC_DIR))

import trough  # noqa: E402


class TroughLineSplitTests(unittest.TestCase):
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
        ])

        segments = trough.split_lines_by_turn_angle(
            [line], max_turn_angle=60.0, turn_angle_window=1
        )

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0][-1].tolist(), [0.0, 2.0])
        self.assertEqual(segments[1][0].tolist(), [0.0, 2.0])

    def test_straight_line_is_not_split(self):
        line = np.asarray([[0.0, 0.0], [0.0, 1.0], [0.0, 2.0]])

        segments = trough.split_lines_by_turn_angle(
            [line], max_turn_angle=30.0, turn_angle_window=1
        )

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].tolist(), line.tolist())


if __name__ == '__main__':
    unittest.main()
