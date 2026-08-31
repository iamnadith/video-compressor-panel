from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


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

    def test_github_actions_run_has_stable_unique_worker(self):
        environment = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_REPOSITORY_ID": "123456",
            "GITHUB_REPOSITORY": "owner/repository",
            "GITHUB_WORKFLOW_REF": "owner/repository/.github/workflows/video-processor.yml@refs/heads/main",
            "GITHUB_RUN_ID": "1001",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            with tempfile.TemporaryDirectory() as first_directory, tempfile.TemporaryDirectory() as second_directory:
                first = processor.DurableState(Path(first_directory)).instance_id()
                second = processor.DurableState(Path(second_directory)).instance_id()
                self.assertEqual(first, second)

            with mock.patch.dict(os.environ, {**environment, "GITHUB_RUN_ID": "1002"}, clear=True):
                with tempfile.TemporaryDirectory() as directory:
                    self.assertNotEqual(first, processor.DurableState(Path(directory)).instance_id())

    def test_explicit_processor_instance_id_takes_priority(self):
        with mock.patch.dict(os.environ, {
            "GITHUB_ACTIONS": "true",
            "PROCESSOR_INSTANCE_ID": "configured-worker",
        }, clear=True):
            with tempfile.TemporaryDirectory() as directory:
                self.assertEqual(
                    processor.DurableState(Path(directory)).instance_id(),
                    "configured-worker",
                )

    def test_local_input_and_output_paths_do_not_collide(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path, output_path = processor.local_job_paths(
                Path(directory) / "job-1",
                {"source_name": "same-name.mp4", "output_name": "same-name.mp4"},
            )
            self.assertNotEqual(input_path, output_path)
            self.assertEqual(input_path.name, "same-name.mp4")
            self.assertEqual(output_path.name, "encoded.mp4")
            self.assertNotEqual(input_path.parent, output_path.parent)

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


class RuntimeGuardTests(unittest.TestCase):
    def test_expired_runtime_requests_a_safe_shutdown(self):
        processor.STOP.clear()
        processor.MAX_RUNTIME_REACHED.clear()
        try:
            with self.assertRaises(processor.ProcessorStopping):
                processor.ensure_running(processor.time.monotonic() - 1)
            self.assertTrue(processor.STOP.is_set())
            self.assertTrue(processor.MAX_RUNTIME_REACHED.is_set())
        finally:
            processor.STOP.clear()
            processor.MAX_RUNTIME_REACHED.clear()


if __name__ == "__main__":
    unittest.main()
