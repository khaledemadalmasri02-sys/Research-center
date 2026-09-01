import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let container: StartedPostgreSqlContainer | null = null;

const URL_FILE = path.join(
  os.tmpdir(),
  `mednexus-test-db-${process.pid}.url`,
);

export async function setup(): Promise<void> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("mednexus_test")
    .withUsername("test")
    .withPassword("test")
    // Force UTC so the api-server's naive `timestamp` columns round-trip
    // consistently with the test host's `Date.now()`. (Production should
    // move these columns to `timestamptz` — tracked as P1 hardening.)
    .withEnvironment({ TZ: "UTC", PGTZ: "UTC" })
    .start();
  const url = container.getConnectionUri();
  // Persist the URL to a file so setupFiles (which run in the test process,
  // a different global scope from globalSetup) can read it synchronously
  // before any user imports execute.
  fs.writeFileSync(URL_FILE, url, "utf8");
  // Stash the handle for teardown.
  (
    globalThis as { __TEST_DB__?: StartedPostgreSqlContainer }
  ).__TEST_DB__ = container;
}

export async function teardown(): Promise<void> {
  const c = (globalThis as { __TEST_DB__?: StartedPostgreSqlContainer })
    .__TEST_DB__;
  if (c) await c.stop().catch(() => undefined);
  try {
    fs.unlinkSync(URL_FILE);
  } catch {
    /* file may already be gone */
  }
}

/** Exposed for test helpers that want to inspect the live container. */
export const __TEST_DB_URL_FILE__ = URL_FILE;