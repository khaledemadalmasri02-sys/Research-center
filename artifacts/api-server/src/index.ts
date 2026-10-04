import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { s3Client } from "./lib/objectStorage";
import { radiologyImageService } from "./lib/radiologyImages";
import { ensureUserPatientsDefinition } from "./lib/patientsCollection";
import {
  ensureSessionTable,
  ensureUsersLegacyBackfills,
  ensureTourConfigTable,
  ensureInboundEmailTable,
  runAllMigrations,
} from "./lib/db-bootstrap";

// The "Patients" collection is now a per-user record definition (see
// ./lib/patientsCollection). Each user gets their own private collection that
// mirrors the patients they own, instead of one shared collection for everyone.

// Ensure the initial admin (created from APP_USERNAME) has their own private
// "Patients" collection seeded from the patients they own.
async function ensureInitialAdminPatientsCollection() {
  const username = process.env.APP_USERNAME;
  if (!username) return;
  const { rows } = await pool.query(`SELECT "id" FROM "users" WHERE "username" = $1 LIMIT 1`, [username]);
  if (rows.length === 0) return;
  await ensureUserPatientsDefinition(Number(rows[0].id));
}

// Legacy patients had no owner; assign any unowned rows to the initial admin so
// they are not orphaned/invisible after the per-user change.
async function backfillPatientsOwner() {
  const username = process.env.APP_USERNAME;
  if (!username) return;
  const { rows } = await pool.query(`SELECT "id" FROM "users" WHERE "username" = $1 LIMIT 1`, [username]);
  if (rows.length === 0) return;
  await pool.query(`UPDATE "patients" SET "user_id" = $1 WHERE "user_id" IS NULL`, [Number(rows[0].id)]);
}

/**
 * A19: strictly first-run.
 *
 * This used to `ON CONFLICT (username) DO UPDATE SET password_hash =
 * EXCLUDED.password_hash, status='active', can_admin_access=true`, so every
 * restart of every replica silently reverted the bootstrap admin's password
 * to the deploy-time value AND un-suspended an admin that had been suspended
 * on purpose. The existence check below already returns early when the row
 * exists; the ON CONFLICT DO UPDATE clause made that guard pointless because
 * it was part of the same statement. The insert now only runs on a genuinely
 * missing row (`DO NOTHING`), so changing APP_PASSWORD_HASH after first run
 * has no effect — change the password through the app instead.
 */
async function seedInitialAdmin() {
  const username = process.env.APP_USERNAME;
  const passwordHash = process.env.APP_PASSWORD_HASH;
  if (!username || !passwordHash) return;

  const { rows } = await pool.query(`SELECT 1 FROM "users" WHERE "username" = $1 LIMIT 1`, [username]);
  if (rows.length > 0) return;

  await pool.query(
    `INSERT INTO "users" ("username", "password_hash", "role", "can_admin_access", "status")
     VALUES ($1, $2, 'admin', true, 'active')
     ON CONFLICT ("username") DO NOTHING`,
    [username, passwordHash],
  );
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureBucket() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    logger.warn("S3_BUCKET not set, skipping bucket check");
    return;
  }

  const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.info({ bucket }, "S3 bucket verified");
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      logger.error({ bucket }, "S3 bucket does not exist. Please create it manually or via docker-compose.");
    } else {
      logger.error({ err, bucket }, "S3 bucket check failed");
    }
  }
}

// A14: a session-scoped advisory lock around the whole bootstrap chain.
//
// `runAllMigrations` + 6 inline-DDL `ensure*` steps + an unbounded
// `UPDATE "patients" SET "user_id" = ... WHERE "user_id" IS NULL` used to run
// on EVERY process start with no mutual exclusion, so replicas racing a
// rolling deploy executed the same DDL and the same full-table backfill
// concurrently (duplicate DDL races, lock contention, and a backfill long
// enough to delay readiness). pg_advisory_lock is session-scoped, so the
// unlock must run on the same connection — hence the dedicated client.
const BOOTSTRAP_LOCK_KEY = 7314159265;

interface PoolClientLike {
  query: (sql: string) => Promise<unknown>;
  release: () => void;
}

async function withBootstrapLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as unknown as PoolClientLike;
  try {
    await client.query(`SELECT pg_advisory_lock(${BOOTSTRAP_LOCK_KEY})`);
    return await fn();
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_KEY})`);
    } catch (err) {
      logger.warn({ err }, "failed to release the bootstrap advisory lock");
    }
    client.release();
  }
}

withBootstrapLock(() =>
  runAllMigrations()
    .then(() => ensureSessionTable())
    .then(() => ensureUsersLegacyBackfills())
    .then(() => seedInitialAdmin().catch((err) => logger.warn({ err }, "initial admin seed failed")))
    .then(() => ensureInitialAdminPatientsCollection().catch((err) => logger.warn({ err }, "patients collection seed failed")))
    .then(() => backfillPatientsOwner().catch((err) => logger.warn({ err }, "patients owner backfill failed")))
    .then(() => radiologyImageService.ensureTable().catch((err) => logger.warn({ err }, "radiology_images table ensure failed")))
    .then(() => ensureTourConfigTable().catch((err) => logger.warn({ err }, "tour_config table ensure failed")))
    .then(() => ensureBucket())
    .then(() => ensureInboundEmailTable().catch((err) => logger.warn({ err }, "inbound_emails table ensure failed")))
    .then(() => {
      app.listen(port, (err?: Error) => {
        if (err) {
          logger.error({ err }, "Error listening on port");
          process.exit(1);
        }
        logger.info({ port }, "Server listening");
      });
    }),
)
  .catch((err) => {
    logger.error({ err }, "Failed during startup initialization");
    process.exit(1);
  });
