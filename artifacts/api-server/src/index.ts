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

async function seedInitialAdmin() {
  const username = process.env.APP_USERNAME;
  const passwordHash = process.env.APP_PASSWORD_HASH;
  if (!username || !passwordHash) return;

  const { rows } = await pool.query(`SELECT 1 FROM "users" WHERE "username" = $1 LIMIT 1`, [username]);
  if (rows.length > 0) return;

  await pool.query(
    `INSERT INTO "users" ("username", "password_hash", "role", "can_admin_access", "status")
     VALUES ($1, $2, 'admin', true, 'active')
     ON CONFLICT ("username") DO UPDATE
       SET "password_hash" = EXCLUDED."password_hash",
           "status" = 'active',
           "can_admin_access" = true`,
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
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed during startup initialization");
    process.exit(1);
  });