"""Verify that worker events are emitted as consistent one-line JSON."""

import io
import json
import unittest
from contextlib import redirect_stdout

from observability import log_info


class WorkerObservabilityTest(unittest.TestCase):
    """Check the fields that make Docker logs searchable and understandable."""

    def test_info_event_is_valid_json_with_fixed_and_custom_fields(self):
        """One log call should produce one complete JSON object and one newline."""
        captured_output = io.StringIO()

        # redirect_stdout temporarily sends print output into memory instead of
        # the terminal. Production still writes the same record to Docker logs.
        with redirect_stdout(captured_output):
            log_info(
                "test_worker_event",
                jobId="job-test-123",
                progress=40,
            )

        output = captured_output.getvalue()
        record = json.loads(output)

        self.assertTrue(output.endswith("\n"))
        self.assertEqual(record["level"], "info")
        self.assertEqual(record["service"], "worker")
        self.assertEqual(record["event"], "test_worker_event")
        self.assertEqual(record["jobId"], "job-test-123")
        self.assertEqual(record["progress"], 40)
        self.assertIn("timestamp", record)
        self.assertIn("workerId", record)


if __name__ == "__main__":
    unittest.main(verbosity=2)
