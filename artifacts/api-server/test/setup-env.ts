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

function readTestFile(prefix: string): string | undefined {
  for (const pid of [process.ppid, process.pid]) {
    const f = path.join(os.tmpdir(), `${prefix}-${pid}.url`);
    try {
      return fs.readFileSync(f, "utf8").trim();
    } catch {
      /* try next */
    }
  }
  return undefined;
}

const url = readTestFile("mednexus-test-db");
if (url) {
  process.env.DATABASE_URL = url;
} else {
  // Fall back to a local Postgres if globalSetup didn't run.
  process.env.DATABASE_URL ??=
    process.env.TEST_DATABASE_URL ??
    "postgresql://test:test@localhost:5432/mednexus_test";
}

// Point S3 env vars at the MinIO testcontainer (or a local MinIO if global
// setup didn't run).
const minioUrl = readTestFile("mednexus-test-minio");
process.env.S3_BUCKET ??= "test-bucket";
process.env.S3_REGION ??= "us-east-1";
if (minioUrl) {
  process.env.S3_ENDPOINT = minioUrl;
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/test-bucket";
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket";
} else {
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_FORCE_PATH_STYLE ??= "true";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS ??= "/test-bucket";
  process.env.PRIVATE_OBJECT_DIR ??= "/test-bucket";
}
process.env.S3_ACCESS_KEY_ID ??= "minioadmin";
process.env.S3_SECRET_ACCESS_KEY ??= "minioadmin";

// Ensure NODE_ENV is set so the app's production guard doesn't trip.
process.env.NODE_ENV ??= "development";
process.env.SESSION_SECRET ??= "test-secret";
process.env.ALLOWED_ORIGINS ??= "http://localhost:3003,http://127.0.0.1:3003";

// Force the Node process to interpret date strings as UTC. The api-server
// uses naive `timestamp` columns (no timezone) for `lockedUntil` etc., so
// pg returns them as strings like "2026-09-01 21:35:54" without a TZ
// offset. `new Date(plainString)` then uses the host's local TZ, which
// differs from the Postgres container's TZ and produces wrong comparisons.
// Setting TZ=UTC makes Node parse the same way the pg driver writes.
// Long-term fix: convert these columns to `timestamptz` (tracked separately).
process.env.TZ = "UTC";