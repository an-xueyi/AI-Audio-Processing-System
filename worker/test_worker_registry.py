"""Test worker-registry SQL behavior without opening a real database connection."""

import unittest
from unittest.mock import MagicMock, patch

import worker_registry


class WorkerRegistryTest(unittest.TestCase):
    """Verify registry commands, parameters, and returned health decisions."""

    def create_database_context(self):
        """Build connection and cursor context managers used by psycopg."""
        connect_context = MagicMock()
        connection = MagicMock()
        connect_context.__enter__.return_value = connection

        cursor_context = MagicMock()
        cursor = MagicMock()
        connection.cursor.return_value = cursor_context
        cursor_context.__enter__.return_value = cursor
        return connect_context, cursor

    def test_register_prunes_old_rows_and_upserts_current_worker(self):
        """Startup should clean history before creating an IDLE presence row."""
        connect_context, cursor = self.create_database_context()

        with patch(
            "worker_registry.psycopg.connect",
            return_value=connect_context,
        ):
            worker_registry.register_worker("worker-test", 60)

        self.assertEqual(cursor.execute.call_count, 2)
        delete_sql = cursor.execute.call_args_list[0].args[0]
        insert_sql, insert_parameters = cursor.execute.call_args_list[1].args

        self.assertIn("DELETE FROM worker_instances", delete_sql)
        self.assertIn("ON CONFLICT (worker_id) DO UPDATE", insert_sql)
        self.assertEqual(insert_parameters, ("worker-test", 60))

    def test_busy_activity_sends_status_job_and_worker_in_order(self):
        """BUSY must associate the worker with only the current job UUID."""
        connect_context, cursor = self.create_database_context()
        cursor.rowcount = 1

        with patch(
            "worker_registry.psycopg.connect",
            return_value=connect_context,
        ):
            updated = worker_registry.set_worker_activity(
                "worker-test",
                "BUSY",
                "11111111-1111-4111-8111-111111111111",
            )

        _sql, parameters = cursor.execute.call_args.args
        self.assertTrue(updated)
        self.assertEqual(
            parameters,
            (
                "BUSY",
                "11111111-1111-4111-8111-111111111111",
                "worker-test",
            ),
        )

    def test_unknown_activity_is_rejected_before_database_access(self):
        """A spelling mistake must not become an invalid persistent state."""
        with patch("worker_registry.psycopg.connect") as connect:
            with self.assertRaisesRegex(ValueError, "Unsupported worker status"):
                worker_registry.set_worker_activity(
                    "worker-test",
                    "SLEEPING",
                    None,
                )

        connect.assert_not_called()

    def test_health_requires_a_present_true_database_result(self):
        """A current row is healthy; a missing row is not healthy."""
        connect_context, cursor = self.create_database_context()
        cursor.fetchone.side_effect = [(True,), None]

        with patch(
            "worker_registry.psycopg.connect",
            return_value=connect_context,
        ):
            self.assertTrue(
                worker_registry.worker_heartbeat_is_current("worker-test")
            )
            self.assertFalse(
                worker_registry.worker_heartbeat_is_current("missing-worker")
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
