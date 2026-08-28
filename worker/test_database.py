"""Test worker SQL decisions without connecting to PostgreSQL."""

import unittest
from unittest.mock import MagicMock, patch

import database
from config import RESULT_RETENTION_HOURS


class WorkerDatabaseTest(unittest.TestCase):
    """Verify parameters sent when a worker updates an owned job."""

    def create_database_context(self):
        """Build nested context-manager fakes for connection and cursor."""
        # psycopg.connect() is used by `with`, so its returned object must provide
        # __enter__ and return the fake connection from that method.
        connect_context = MagicMock()
        connection = MagicMock()
        connect_context.__enter__.return_value = connection

        # connection.cursor() creates a second context manager around the cursor.
        cursor_context = MagicMock()
        cursor = MagicMock()
        connection.cursor.return_value = cursor_context
        cursor_context.__enter__.return_value = cursor

        # update_job_status interprets rowcount == 1 as retained lease ownership.
        cursor.rowcount = 1
        return connect_context, cursor

    def test_completed_job_passes_retention_to_atomic_update(self):
        """COMPLETED should include result keys and the retention duration."""
        connect_context, cursor = self.create_database_context()

        with patch("database.psycopg.connect", return_value=connect_context):
            database.update_job_status(
                "11111111-1111-4111-8111-111111111111",
                "worker-test",
                "COMPLETED",
                100,
                {"vocals": "results/job/vocals.wav"},
            )

        # The first execute call is the job UPDATE. A second call inserts the
        # transactional outbox event, so selecting index zero is intentional.
        update_sql, update_parameters = cursor.execute.call_args_list[0].args

        self.assertIn("storage_expires_at = CASE", update_sql)
        self.assertIn("INTERVAL '1 hour'", update_sql)
        self.assertEqual(update_parameters[4], "COMPLETED")
        self.assertEqual(update_parameters[5], RESULT_RETENTION_HOURS)
        self.assertEqual(update_parameters[-2], "11111111-1111-4111-8111-111111111111")
        self.assertEqual(update_parameters[-1], "worker-test")

    def test_processing_update_uses_the_same_guarded_sql(self):
        """PROCESSING uses CASE but its status makes PostgreSQL keep null expiry."""
        connect_context, cursor = self.create_database_context()

        with patch("database.psycopg.connect", return_value=connect_context):
            database.update_job_status(
                "22222222-2222-4222-8222-222222222222",
                "worker-test",
                "PROCESSING",
                40,
            )

        update_sql, update_parameters = cursor.execute.call_args_list[0].args

        # This proves the active status reaches the SQL CASE expression. The CASE
        # matches only COMPLETED/FAILED, so PROCESSING preserves its current value.
        self.assertIn("WHEN %s IN ('COMPLETED', 'FAILED')", update_sql)
        self.assertEqual(update_parameters[4], "PROCESSING")


if __name__ == "__main__":
    # verbosity=2 prints each test name, which is useful while learning the suite.
    unittest.main(verbosity=2)

