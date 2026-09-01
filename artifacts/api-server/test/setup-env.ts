/**
 * Runs in the same process as the test, before any user imports. globalSetup
 * has written the testcontainer's connection URL to a file in /tmp; we read
 * it here and set DATABASE_URL so the static
 * `import { pool } from "@workspace/db"` lines in app.ts / routes/*.ts
 * resolve to a working pool.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function readTestDbUrl(): string | undefined {
  const file = path.join(
    os.tmpdir(),
    `mednexus-test-db-${process.ppid}.url`,
  );
  // process.ppid is the parent process (vitest runner); globalSetup runs in
  // the parent context so its pid matches what we see as ppid here. As a
  // safety net, also try the current pid.
  for (const pid of [process.ppid, process.pid]) {
    const f = path.join(os.tmpdir(), `mednexus-test-db-${pid}.url`);
    try {
      return fs.readFileSync(f, "utf8").trim();
    } catch {
      /* try next */
    }
  }
  return undefined;
}

const url = readTestDbUrl();
if (url) {
  process.env.DATABASE_URL = url;
} else {
  // Fall back to a local Postgres if globalSetup didn't run.
  process.env.DATABASE_URL ??=
    process.env.TEST_DATABASE_URL ??
    "postgresql://test:test@localhost:5432/mednexus_test";
}

// Ensure NODE_ENV is set so the app's production guard doesn't trip.
process.env.NODE_ENV ??= "development";
process.env.SESSION_SECRET ??= "test-secret";
process.env.ALLOWED_ORIGINS ??= "http://localhost:3003,http://127.0.0.1:3003";

// Several api-server modules construct S3 client / ObjectStorageService at
// import time. The auth tests don't touch S3, but the modules still load.
// Provide dummy S3 env vars so module construction succeeds; storage tests
// (P0.3 slice 2/3) will mock or replace these with a real MinIO container.
process.env.S3_BUCKET ??= "test-bucket";
process.env.S3_REGION ??= "us-east-1";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY_ID ??= "minioadmin";
process.env.S3_SECRET_ACCESS_KEY ??= "minioadmin";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.PUBLIC_OBJECT_SEARCH_PATHS ??= "/test-bucket";
process.env.PRIVATE_OBJECT_DIR ??= "/test-bucket";

// Force the Node process to interpret date strings as UTC. The api-server
// uses naive `timestamp` columns (no timezone) for `lockedUntil` etc., so
// pg returns them as strings like "2026-09-01 21:35:54" without a TZ
// offset. `new Date(plainString)` then uses the host's local TZ, which
// differs from the Postgres container's TZ and produces wrong comparisons.
// Setting TZ=UTC makes Node parse the same way the pg driver writes.
// Long-term fix: convert these columns to `timestamptz` (tracked separately).
process.env.TZ = "UTC";