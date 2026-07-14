import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

from draw import generate_svg_layers  # noqa: E402


class GenerateSvgLayersTests(unittest.TestCase):
    @patch("draw.generate_svg_layers.os.cpu_count", return_value=8)
    def test_default_worker_count_reserves_two_cpus(self, cpu_count_mock):
        self.assertEqual(generate_svg_layers.default_worker_count(), 6)
        cpu_count_mock.assert_called_once_with()

    @patch("draw.generate_svg_layers.os.cpu_count", return_value=2)
    def test_default_worker_count_never_falls_below_one(self, cpu_count_mock):
        self.assertEqual(generate_svg_layers.default_worker_count(), 1)
        cpu_count_mock.assert_called_once_with()

    def test_save_svg_closes_figure_after_saving(self):
        figure = Mock()

        with tempfile.TemporaryDirectory() as tmpdir, patch(
            "draw.generate_svg_layers.plt.close"
        ) as close_mock:
            generate_svg_layers.save_svg(figure, Path(tmpdir) / "layer.svg")

        close_mock.assert_called_once_with(figure)

    def test_save_svg_closes_figure_when_saving_fails(self):
        figure = Mock()
        figure.savefig.side_effect = OSError("disk unavailable")

        with tempfile.TemporaryDirectory() as tmpdir, patch(
            "draw.generate_svg_layers.plt.close"
        ) as close_mock:
            with self.assertRaisesRegex(OSError, "disk unavailable"):
                generate_svg_layers.save_svg(figure, Path(tmpdir) / "layer.svg")

        close_mock.assert_called_once_with(figure)


if __name__ == "__main__":
    unittest.main()
