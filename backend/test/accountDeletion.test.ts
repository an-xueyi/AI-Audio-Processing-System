/* Verify account deletion coordinates jobs, cleanup, sessions, and users. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db.js";
import { deleteUserAccount } from "../src/auth/accountLifecycleService.js";

type FakeClient = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: never[]; rowCount: number }>;
  release: () => void;
};

const connectOwner = pool as unknown as {
  connect: () => Promise<FakeClient>;
};
const originalConnect = connectOwner.connect;

after(async () => {
  connectOwner.connect = originalConnect;
  await pool.end();
});

test("deleting an account cancels work before removing the user", async () => {
  const statements: string[] = [];
  let connectionReleased = false;

  connectOwner.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      return { rows: [], rowCount: 1 };
    },
    release() {
      connectionReleased = true;
    },
  });

  await deleteUserAccount("11111111-1111-4111-8111-111111111111");
  const combinedSql = statements.join("\n");

  assert.match(combinedSql, /SET status = 'CANCELLED'/);
  assert.match(combinedSql, /INSERT INTO outbox_events/);
  assert.match(combinedSql, /owner_deleted_at = NOW\(\)/);
  assert.match(combinedSql, /DELETE FROM users/);
  assert.ok(statements.indexOf("BEGIN") < statements.indexOf("COMMIT"));
  assert.equal(connectionReleased, true);
});
