import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Parse a positive-integer env var, falling back to `fallback` when it is
 * unset, empty, or garbage. Every pool setting below is env-overridable so
 * an operator can tune it per deployment without a code change.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const connectionString = process.env.DATABASE_URL;

/**
 * Connection-pool sizing (all env-overridable, safe defaults in brackets):
 *
 *   DATABASE_POOL_MAX                     [20]      max client connections for API queries
 *   DATABASE_POOL_IDLE_TIMEOUT_MS         [30000]   close idle clients after this long
 *   DATABASE_POOL_CONNECTION_TIMEOUT_MS   [10000]   fail fast instead of queueing forever
 *   DATABASE_STATEMENT_TIMEOUT_MS         [30000]   server-side statement timeout
 *   DATABASE_POOL_MAX_USES                [10000]   recycle a client after N queries
 *   DATABASE_APPLICATION_NAME             [api-server]  tag for pg_stat_activity
 *
 * pg's own defaults are `max: 10` and no timeouts. Ten connections shared
 * with `connect-pg-simple` (one read + one write per authenticated request)
 * means session lookups alone can exhaust the pool and starve every API
 * query. The express-session store therefore builds its own small pool in
 * artifacts/api-server/src/app.ts (pg is not a direct dependency of that
 * package, so it constructs it from this pool's own constructor) rather than
 * sharing this one.
 */
const poolConfig = {
  max: intEnv("DATABASE_POOL_MAX", 20),
  idleTimeoutMillis: intEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMillis: intEnv("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 10_000),
  statement_timeout: intEnv("DATABASE_STATEMENT_TIMEOUT_MS", 30_000),
  maxUses: intEnv("DATABASE_POOL_MAX_USES", 10_000),
  application_name: process.env.DATABASE_APPLICATION_NAME ?? "api-server",
};

export const pool = new Pool({ connectionString, ...poolConfig });

export const db = drizzle(pool, { schema });

export * from "./schema";