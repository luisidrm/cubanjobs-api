import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./index";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Tune these once you have real traffic patterns; these are sane
  // starting points for a single small API instance.
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  // Short idle/lifetime limits: on Windows, Docker Desktop / WSL's port relay
  // silently drops long-lived idle TCP connections, leaving dead sockets in
  // the pool that then fail every request with "Connection terminated
  // unexpectedly". Recycling connections often avoids ever handing one out.
  idleTimeoutMillis: 10_000,
  maxLifetimeSeconds: 300,
  // TCP keepalive keeps the relay from treating a quiet connection as dead.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  // Managed Postgres (RDS, etc.) requires SSL — local Docker Postgres doesn't
  // support it, so this stays off unless explicitly opted into via env var.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  // Fires for idle clients that hit a backend error (e.g. connection reset).
  // Without this handler an unhandled 'error' event crashes the process.
  console.error("Unexpected error on idle Postgres client", err);
});

export const db = drizzle(pool, { schema });

/**
 * Call once at server startup to fail fast if the database is unreachable,
 * rather than discovering it on the first request.
 */
export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}

/**
 * Call during graceful shutdown (SIGTERM/SIGINT handlers) so in-flight
 * queries finish and connections close cleanly instead of being dropped.
 */
export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
}