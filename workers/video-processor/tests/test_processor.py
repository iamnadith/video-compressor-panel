from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "processor.py"
SPEC = importlib.util.spec_from_file_location("video_processor", MODULE_PATH)
assert SPEC and SPEC.loader
processor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = processor
SPEC.loader.exec_module(processor)


class DurableStateTests(unittest.TestCase):
    def test_generated_instance_id_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = processor.DurableState(root).instance_id()
            second = processor.DurableState(root).instance_id()
            self.assertEqual(first, second)

    def test_active_checkpoint_is_atomic_and_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            state = processor.DurableState(Path(directory))
            expected = {"job": {"id": "job-1"}, "progress": 27.5}
            state.save_active(expected)
            self.assertEqual(state.active(), expected)
            self.assertFalse(state.active_file.with_suffix(".json.tmp").exists())


class CompressionMathTests(unittest.TestCase):
    def test_matches_supplied_two_pass_formula(self):
        self.assertEqual(
            processor.calculate_video_bitrate_kbps(300, 3600, 128, 200),
            554,
        )

    def test_enforces_minimum_video_bitrate(self):
        self.assertEqual(
            processor.calculate_video_bitrate_kbps(50, 20_000, 128, 200),
            200,
        )


if __name__ == "__main__":
    unittest.main()
