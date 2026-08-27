/*
 * Create one shared PostgreSQL connection pool for the backend process.
 * A pool reuses a small collection of connections instead of opening a new TCP
 * connection for every API request, which is faster and protects the database.
 */
import dotenv from "dotenv";
import pg from "pg";

// Load backend/.env during manual development. Docker supplies the same values
// through docker-compose.yml, so no .env file is baked into the image.
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  // DATABASE_URL contains the protocol, username, password, host, port, and
  // database name in one PostgreSQL connection string.
  connectionString: process.env.DATABASE_URL,
});
