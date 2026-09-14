import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import uuid


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "fleet_allocate_runner", ROOT / "scripts/fleet_allocate_runner.py"
)
ALLOCATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALLOCATOR)


class AllocationTests(unittest.TestCase):
    def setUp(self):
        state = Path.home() / "ii/website-copy-maker/test-state"
        state.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="fleet-allocation-", dir=state))
        self.owner = uuid.uuid4().hex
        (self.root / ".owner").write_text(self.owner)
        self.output = self.root / "outputs"
        self.calls = []
        self.elapsed = 0
        self.environment = {
            "IIF_CONTROL_PLANE_URL": "https://fleet.example.invalid",
            "IIF_SHARED_SECRET": "synthetic-test-auth",
            "IIF_RUNNER_IMAGE": "coder@sha256:" + "a" * 64,
            "IIF_JOB_SUFFIX": "release-test",
            "IIF_PROFILE": "release-test",
            "IIF_WORKFLOW_PATH": ".github/workflows/test.yml",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_REPOSITORY": "example/source",
            "GITHUB_OUTPUT": str(self.output),
        }

    def tearDown(self):
        self.assertFalse(self.root.is_symlink())
        self.assertEqual((self.root / ".owner").read_text(), self.owner)
        shutil.rmtree(self.root)

    def execute(self, respond):
        def request(method, path, body=None, expected=(200,)):
            self.calls.append((method, path, body, expected))
            return respond(method, path, body)

        def sleep(seconds):
            self.elapsed += seconds

        with patch.dict(ALLOCATOR.os.environ, self.environment, clear=True), \
                patch.object(ALLOCATOR, "request", side_effect=request), \
                patch.object(ALLOCATOR.time, "monotonic", side_effect=lambda: self.elapsed), \
                patch.object(ALLOCATOR.time, "sleep", side_effect=sleep), \
                patch.object(ALLOCATOR.signal, "signal"):
            ALLOCATOR.main()

    def response(self, method, path, body):
        if path == "/capabilities/check":
            self.assertNotIn("timeout_s", body["resources"])
            return {"schedulable": True}
        if path == "/jobs":
            self.assertEqual(body["runner"]["registration"]["repository"], "example/source")
            return {"lease_id": "example-lease"}
        if path.endswith("/cancel_pending"):
            return {"cancelled_count": 1}
        if path.startswith("/events?"):
            return {"events": [], "has_more": False, "next_cursor": ""}
        raise AssertionError(f"unexpected request: {method} {path}")

    def test_success_waits_for_exact_runner_online_event(self):
        def respond(method, path, body):
            if path.startswith("/events?"):
                return {"events": [
                    {"job_id": "other", "kind": "runner_online"},
                    {"job_id": "github:123:1:release-test",
                     "lease_id": "example-lease", "kind": "runner_online"},
                ], "has_more": False, "next_cursor": ""}
            return self.response(method, path, body)

        self.execute(respond)
        values = dict(line.split("=", 1) for line in self.output.read_text().splitlines())
        self.assertEqual(values["lease_id"], "example-lease")
        self.assertTrue(values["runner_label"].startswith("iif-website-copy-release-test-"))
        self.assertFalse(any(call[1].endswith("/cancel_pending") for call in self.calls))

    def test_unschedulable_capacity_fails_before_submission(self):
        def respond(method, path, body):
            if path == "/capabilities/check":
                return {"schedulable": False, "state": "no_healthy_hosts"}
            return self.response(method, path, body)

        with self.assertRaisesRegex(RuntimeError, "cannot place"):
            self.execute(respond)
        self.assertEqual([call[1] for call in self.calls], ["/capabilities/check"])
        self.assertFalse(self.output.exists())

    def test_timeout_retires_only_the_submitted_job(self):
        with self.assertRaisesRegex(RuntimeError, "runner timeout"):
            self.execute(self.response)
        cancellations = [call for call in self.calls if call[1].endswith("/cancel_pending")]
        self.assertEqual(len(cancellations), 1)
        self.assertIn("github%3A123%3A1%3Arelease-test", cancellations[0][1])
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
