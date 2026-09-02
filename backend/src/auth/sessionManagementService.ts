/* List, revoke, touch, and eventually remove server-side login sessions. */
import { pool } from "../db.js";

type StoredSession = {
  id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
};

export type AccountSession = {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

export async function listActiveUserSessions(
  userId: string,
  currentTokenHash: string,
): Promise<AccountSession[]> {
  // Revoked and expired rows are intentionally hidden because they can no longer
  // authenticate a browser. The user sees only sessions that are currently valid.
  const result = await pool.query<StoredSession>(
    `SELECT id, token_hash, created_at, last_seen_at, expires_at
     FROM user_sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId],
  );

  // Compare token fingerprints only on the server. The browser receives a safe
  // Boolean and never receives either its own or another session's token hash.
  return result.rows.map((session) => ({
    id: session.id,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at,
    isCurrent: session.token_hash === currentTokenHash,
  }));
}

export async function revokeOtherUserSessions(
  userId: string,
  currentTokenHash: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND token_hash <> $2
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [userId, currentTokenHash],
  );

  // node-postgres may type rowCount as null for statements where it is unknown.
  return result.rowCount ?? 0;
}

export async function deleteInactiveUserSessions(): Promise<number> {
  /*
   * Expired sessions are useless immediately. Revoked rows are retained for seven
   * days as short-lived operational evidence, then removed so the table cannot
   * grow forever. This function never removes an active, unexpired session.
   */
  const result = await pool.query(
    `DELETE FROM user_sessions
     WHERE expires_at <= NOW()
        OR revoked_at <= NOW() - INTERVAL '7 days'`,
  );

  return result.rowCount ?? 0;
}
