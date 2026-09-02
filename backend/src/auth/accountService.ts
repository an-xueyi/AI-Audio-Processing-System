/* Keep account and authenticated-session PostgreSQL operations in one module. */
import type { PoolClient } from "pg";
import { pool } from "../db.js";

export type AuthenticatedUser = {
  id: string;
  username: string;
};

type StoredUser = AuthenticatedUser & {
  password_hash: string;
};

type CreateSessionInput = {
  // The anonymous browser ID owns work created before login or registration.
  anonymousOwnerId: string;
  expiresAt: Date;
  tokenHash: string;
  // When a logged-in browser switches accounts, invalidate its old cookie token.
  replacedTokenHash?: string;
};

async function adoptAnonymousJobs(
  client: PoolClient,
  anonymousOwnerId: string,
  userId: string,
) {
  /*
   * Existing jobs use owner_id = anonymous browser UUID. After authentication,
   * changing that owner to the permanent user UUID makes those jobs available
   * from future browsers where the same account logs in. The audio object keys
   * do not need to move because jobs store their complete private object keys.
   */
  await client.query(
    `UPDATE jobs
     SET owner_id = $1
     WHERE owner_id = $2
       AND $1 <> $2`,
    [userId, anonymousOwnerId],
  );
}

async function insertUserSession(
  client: PoolClient,
  userId: string,
  input: CreateSessionInput,
) {
  if (input.replacedTokenHash) {
    // Mark the previous authenticated cookie unusable before issuing another.
    await client.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE token_hash = $1`,
      [input.replacedTokenHash],
    );
  }

  // The database receives only the token fingerprint, never the browser token.
  await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, input.tokenHash, input.expiresAt],
  );
}

export async function registerUser(
  username: string,
  passwordHash: string,
  input: CreateSessionInput,
): Promise<AuthenticatedUser> {
  // One reserved connection keeps account creation, job adoption, and session
  // creation inside a single all-or-nothing transaction.
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<AuthenticatedUser>(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [username, passwordHash],
    );
    const user = result.rows[0];

    if (!user) {
      throw new Error("PostgreSQL did not return the registered user");
    }

    await adoptAnonymousJobs(client, input.anonymousOwnerId, user.id);
    await insertUserSession(client, user.id, input);
    await client.query("COMMIT");
    return user;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserForLogin(
  username: string,
): Promise<StoredUser | null> {
  // Username is normalized and validated before this lookup. Parameter binding
  // keeps its text separate from SQL syntax and prevents SQL injection.
  const result = await pool.query<StoredUser>(
    `SELECT id, username, password_hash
     FROM users
     WHERE username = $1`,
    [username],
  );

  return result.rows[0] ?? null;
}

export async function createUserSession(
  userId: string,
  input: CreateSessionInput,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await adoptAnonymousJobs(client, input.anonymousOwnerId, userId);
    await insertUserSession(client, userId, input);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserByActiveSession(
  tokenHash: string,
): Promise<AuthenticatedUser | null> {
  /*
   * Joining user_sessions to users converts a valid cookie fingerprint into the
   * permanent owner identity. Expiration and revocation are checked by SQL so an
   * invalid session never reaches job or upload route code.
   */
  const result = await pool.query<AuthenticatedUser>(
    `WITH active_session AS (
       SELECT user_id
       FROM user_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
     ), touched_session AS (
       UPDATE user_sessions
       SET last_seen_at = NOW()
       WHERE token_hash = $1
         AND last_seen_at < NOW() - INTERVAL '15 minutes'
         AND EXISTS (SELECT 1 FROM active_session)
       RETURNING id
     )
     SELECT users.id, users.username
     FROM active_session
     JOIN users ON users.id = active_session.user_id`,
    [tokenHash],
  );

  return result.rows[0] ?? null;
}

export async function revokeUserSession(tokenHash: string): Promise<void> {
  // Revocation retains an audit-safe session row but makes it fail future lookup.
  await pool.query(
    `UPDATE user_sessions
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE token_hash = $1`,
    [tokenHash],
  );
}

export function isUsernameConflict(error: unknown): boolean {
  // PostgreSQL uses SQLSTATE 23505 for every unique-constraint violation. Limit
  // this conversion to the username index so unrelated database errors still
  // reach the normal internal-error handler.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "idx_users_username_unique"
  );
}
