/* Verify session presentation and cleanup rules without a live database. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db.js";
import {
  deleteInactiveUserSessions,
  listActiveUserSessions,
} from "../src/auth/sessionManagementService.js";

type QueryResult = {
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
};

type QueryReplacement = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult>;

const queryOwner = pool as unknown as { query: QueryReplacement };
const originalQuery = queryOwner.query;

after(async () => {
  queryOwner.query = originalQuery;
  await pool.end();
});

test("session listing identifies the current browser without returning token hashes", async () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  queryOwner.query = async () => ({
    rows: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        token_hash: "current-fingerprint",
        created_at: now,
        last_seen_at: now,
        expires_at: now,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        token_hash: "other-fingerprint",
        created_at: now,
        last_seen_at: now,
        expires_at: now,
      },
    ],
  });

  const sessions = await listActiveUserSessions(
    "33333333-3333-4333-8333-333333333333",
    "current-fingerprint",
  );

  assert.equal(sessions[0]?.isCurrent, true);
  assert.equal(sessions[1]?.isCurrent, false);
  assert.equal("token_hash" in (sessions[0] || {}), false);
});

test("session cleanup deletes only expired or old revoked rows", async () => {
  let capturedSql = "";

  queryOwner.query = async (sql) => {
    capturedSql = sql;
    return { rows: [], rowCount: 4 };
  };

  assert.equal(await deleteInactiveUserSessions(), 4);
  assert.match(capturedSql, /expires_at <= NOW\(\)/);
  assert.match(capturedSql, /revoked_at <= NOW\(\) - INTERVAL '7 days'/);
});
