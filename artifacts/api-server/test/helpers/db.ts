import { afterAll, afterEach, beforeAll } from "vitest";

/**
 * Use this in every test file that hits the database:
 *
 *   import { test } from "vitest";
 *   import { withDb } from "./helpers/db";
 *   const t = withDb();
 *   t.test("...", async () => { ... });
 *
 * It wires up beforeAll (imports the api-server modules + creates schema),
 * afterEach (truncates all tables), and afterAll (closes the pool).
 *
 * The pool is shared across all withDb() instances in a single test file so
 * that running multiple `describe` blocks (each with its own withDb) doesn't
 * close the pool under subsequent fixtures. The global-setup teardown owns
 * the final close.
 */
export function withDb() {
  // Module-scoped singletons: re-import only once per test file.
  let app: typeof import("../../src/app").default | null = null;
  let pool: typeof import("@workspace/db").pool | null = null;
  let dbBootstrap: typeof import("../../src/lib/db-bootstrap") | null = null;
  let security: typeof import("../../src/lib/security") | null = null;
  let bootstrapped = false;
  let poolClosed = false;

  beforeAll(async () => {
    if (bootstrapped) return;
    // Lazy import: these modules read DATABASE_URL at import time, and we
    // need global-setup.ts to have set it first.
    const appMod = await import("../../src/app");
    const dbMod = await import("@workspace/db");
    const bootstrap = await import("../../src/lib/db-bootstrap");
    const sec = await import("../../src/lib/security");
    app = appMod.default;
    pool = dbMod.pool;
    dbBootstrap = bootstrap;
    security = sec;

    // Add a test-only error logger that prints the inner error so we can
    // see 500 root causes during `pnpm test`. In production, Express's
    // default error handler hides them.
    app.use(
      (err: Error, _req: unknown, res: { statusCode?: number; status?: (n: number) => unknown; headersSent?: boolean }, _next: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[test-error]", err?.stack ?? err);
        if (!res.headersSent) {
          (res as { status: (n: number) => unknown }).status(500);
        }
      },
    );

    // Ensure schema once per test file. The globalSetup already started the
    // container; we just create the tables on first use.
    await dbBootstrap.ensureAllTables();
    bootstrapped = true;
  });

  afterEach(async () => {
    if (!pool) return;
    // Reset in-memory rate-limit buckets so each test starts fresh.
    security?.__resetRateLimits();
    // Truncate only tables that exist. The api-server's bootstrap creates
    // most of them; some (like `patients`) are managed by Drizzle migrations
    // and may not exist on a freshly-bootstrapped DB.
    const tables = [
      "session",
      "users",
      "signup_requests",
      "audit_log",
      "record_definitions",
      "records",
      "record_images",
      "feedback",
      "api_tokens",
      "saved_views",
      "notifications",
      "login_challenges",
      "tour_config",
      "inbound_emails",
    ];
    for (const t of tables) {
      await pool
        .query(`DELETE FROM "${t}"`)
        .catch((e: { code?: string }) => {
          // 42P01 = undefined_table
          if (e?.code !== "42P01") throw e;
        });
    }
    // Reset serial sequences so id=1 is reused each test.
    await pool.query(`
      SELECT setval(pg_get_serial_sequence('"users"', 'id'), 1, false);
      SELECT setval(pg_get_serial_sequence('"signup_requests"', 'id'), 1, false);
    `).catch(() => undefined);
  });

  afterAll(async () => {
    if (!pool || poolClosed) return;
    poolClosed = true;
    // We do NOT close the pool here — global-setup owns the lifecycle and
    // closing here would break later describe blocks in the same file that
    // also call withDb().
  });

  return {
    get app() {
      if (!app) throw new Error("withDb: app not initialised");
      return app;
    },
    get pool() {
      if (!pool) throw new Error("withDb: pool not initialised");
      return pool;
    },
    get security() {
      if (!security) throw new Error("withDb: security not initialised");
      return security;
    },
    async createUser(input: {
      username: string;
      password: string;
      role?: "admin" | "editor" | "viewer";
      status?: "active" | "pending" | "suspended";
      canAdminAccess?: boolean;
      email?: string | null;
    }): Promise<number> {
      if (!pool || !security) throw new Error("withDb: not initialised");
      const passwordHash = await security.hashPassword(input.password);
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO "users" ("username", "password_hash", "role", "can_admin_access", "status", "email")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING "id"`,
        [
          input.username,
          passwordHash,
          input.role ?? "editor",
          input.canAdminAccess ?? false,
          input.status ?? "active",
          input.email ?? null,
        ],
      );
      return rows[0].id;
    },
  };
}

export type DbFixture = ReturnType<typeof withDb>;