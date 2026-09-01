import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { s3Client } from "./lib/objectStorage";
import { radiologyImageService } from "./lib/radiologyImages";
import { ensureUserPatientsDefinition } from "./lib/patientsCollection";

async function ensureSessionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);
}

async function ensureAuthTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" serial PRIMARY KEY,
      "username" text NOT NULL UNIQUE,
      "password_hash" text NOT NULL,
      "full_name" text,
      "email" text,
      "role" text NOT NULL DEFAULT 'editor',
      "can_admin_access" boolean NOT NULL DEFAULT false,
      "status" text NOT NULL DEFAULT 'active',
      "failed_attempts" integer NOT NULL DEFAULT 0,
      "locked_until" timestamp,
      "created_by" integer,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
    -- Existing databases were created with the admin flag in a legacy "n"
    -- column. The app now reads "can_admin_access". Add the new column and
    -- backfill from "n" so admins aren't silently demoted after a code
    -- update (which would make /api/auth/me report canAdminAccess: false).
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_admin_access" boolean NOT NULL DEFAULT false;
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'n'
      ) THEN
        UPDATE "users" SET "can_admin_access" = "n"
        WHERE "n" IS TRUE AND "can_admin_access" IS DISTINCT FROM "n";
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS "signup_requests" (
      "id" serial PRIMARY KEY,
      "username" text NOT NULL UNIQUE,
      "password_hash" text NOT NULL,
      "full_name" text,
      "email" text,
      "reason" text,
      "status" text NOT NULL DEFAULT 'pending',
      "reviewed_by" integer,
      "reviewed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "audit_log" (
      "id" serial PRIMARY KEY,
      "user_id" integer,
      "action" text NOT NULL,
      "entity" text,
      "entity_id" integer,
      "detail" jsonb,
      "ip" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_audit_user" ON "audit_log" ("user_id");
    CREATE INDEX IF NOT EXISTS "IDX_audit_action" ON "audit_log" ("action");

    CREATE TABLE IF NOT EXISTS "record_definitions" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "name" text NOT NULL,
      "fields" jsonb NOT NULL DEFAULT '[]',
      "shared" boolean NOT NULL DEFAULT false,
      "isActive" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE "record_definitions" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT false;
    ALTER TABLE "record_definitions" ADD COLUMN IF NOT EXISTS "deactivated" boolean NOT NULL DEFAULT false;
    ALTER TABLE "record_definitions" ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS "records" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "definition_id" integer NOT NULL,
      "data" jsonb NOT NULL DEFAULT '{}',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "record_images" (
      "id" serial PRIMARY KEY,
      "record_id" integer NOT NULL,
      "field_key" text NOT NULL,
      "object_key" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_record_defs_user" ON "record_definitions" ("user_id");
    CREATE INDEX IF NOT EXISTS "IDX_records_user" ON "records" ("user_id");
    CREATE INDEX IF NOT EXISTS "IDX_records_def" ON "records" ("definition_id");
    CREATE INDEX IF NOT EXISTS "IDX_record_images_record" ON "record_images" ("record_id");

    CREATE TABLE IF NOT EXISTS "feedback" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "type" text NOT NULL DEFAULT 'general',
      "message" text NOT NULL,
      "rating" integer,
      "status" text NOT NULL DEFAULT 'new',
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_feedback_user" ON "feedback" ("user_id");
    CREATE INDEX IF NOT EXISTS "IDX_feedback_status" ON "feedback" ("status");

    CREATE INDEX IF NOT EXISTS "IDX_audit_created" ON "audit_log" ("created_at");

    -- Full-text search vector over record JSON data (Postgres tsvector + GIN).
    ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
      GENERATED ALWAYS AS (to_tsvector('english', "data"::text)) STORED;
    CREATE INDEX IF NOT EXISTS "IDX_records_search" ON "records" USING GIN ("search_tsv");

    CREATE TABLE IF NOT EXISTS "api_tokens" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "name" text NOT NULL,
      "token_hash" text NOT NULL,
      "scopes" jsonb NOT NULL DEFAULT '[]',
      "last_used_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "revoked_at" timestamp
    );
    CREATE INDEX IF NOT EXISTS "IDX_api_tokens_user" ON "api_tokens" ("user_id");

    CREATE TABLE IF NOT EXISTS "saved_views" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "definition_id" integer NOT NULL,
      "name" text NOT NULL,
      "filters" jsonb NOT NULL DEFAULT '{}',
      "sort" jsonb NOT NULL DEFAULT '{}',
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_saved_views_user" ON "saved_views" ("user_id");

    CREATE TABLE IF NOT EXISTS "notifications" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL,
      "type" text NOT NULL,
      "title" text NOT NULL,
      "body" text NOT NULL DEFAULT '',
      "link" text,
      "read" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_notifications_user" ON "notifications" ("user_id");
    CREATE INDEX IF NOT EXISTS "IDX_notifications_unread" ON "notifications" ("user_id", "read");

    -- Enforce username uniqueness even on databases created before the UNIQUE
    -- constraint existed. CREATE TABLE IF NOT EXISTS never adds a missing
    -- constraint to an existing table, so duplicates can persist. De-duplicate
    -- (keep the earliest account per username) then add the constraint, ignoring
    -- the error when it is already present.
    DO $$
    BEGIN
      UPDATE "users" SET "username" = "username" || '__dedup' || "id"::text
      WHERE "id" NOT IN (SELECT MIN("id") FROM "users" GROUP BY "username");
      BEGIN
        EXECUTE 'ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE ("username")';
      EXCEPTION WHEN duplicate_table THEN NULL;
      END;

      UPDATE "signup_requests" SET "username" = "username" || '__dedup' || "id"::text
      WHERE "id" NOT IN (SELECT MIN("id") FROM "signup_requests" GROUP BY "username");
      BEGIN
        EXECUTE 'ALTER TABLE "signup_requests" ADD CONSTRAINT "signup_requests_username_unique" UNIQUE ("username")';
      EXCEPTION WHEN duplicate_table THEN NULL;
      END;

      -- OTP email-verification columns for the sign-up flow. Added as nullable
      -- (or with defaults) so the migration is safe on existing rows.
      BEGIN
        EXECUTE 'ALTER TABLE "signup_requests" ADD COLUMN "otp_code_hash" text';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        EXECUTE 'ALTER TABLE "signup_requests" ADD COLUMN "otp_expires_at" timestamptz';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        EXECUTE 'ALTER TABLE "signup_requests" ADD COLUMN "otp_attempts" integer NOT NULL DEFAULT 0';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        EXECUTE 'ALTER TABLE "signup_requests" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;

      -- OTP columns on the users table (login 2FA).
      BEGIN
        EXECUTE 'ALTER TABLE "users" ADD COLUMN "otp_code_hash" text';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        EXECUTE 'ALTER TABLE "users" ADD COLUMN "otp_expires_at" timestamptz';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        EXECUTE 'ALTER TABLE "users" ADD COLUMN "otp_attempts" integer NOT NULL DEFAULT 0';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
    END $$;

    -- Short-lived login challenges for 2FA: maps a login token to a user until
    -- the emailed code is verified.
    CREATE TABLE IF NOT EXISTS "login_challenges" (
      "id" serial PRIMARY KEY,
      "token_hash" text NOT NULL,
      "user_id" integer NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "consumed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "IDX_login_challenges_token" ON "login_challenges" ("token_hash");
  `);
}

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

async function ensureTourConfig() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "tour_config" (
      "id" integer PRIMARY KEY,
      "config" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO "tour_config" ("id", "config")
      VALUES (1, '{"defaultSource":"animated","steps":{}}'::jsonb)
      ON CONFLICT ("id") DO NOTHING;
  `);
}

async function ensureInboundEmailTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "inbound_emails" (
      "id" serial PRIMARY KEY,
      "sender" text NOT NULL,
      "recipient" text NOT NULL,
      "subject" text NOT NULL DEFAULT '(no subject)',
      "body_text" text NOT NULL DEFAULT '',
      "body_html" text,
      "message_id" text,
      "in_reply_to" text,
      "received_at" timestamp NOT NULL DEFAULT now(),
      "replied_at" timestamp
    );
    CREATE INDEX IF NOT EXISTS "IDX_inbound_received" ON "inbound_emails" ("received_at");
  `);
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

ensureSessionTable()
  .then(() => ensureAuthTables())
    .then(() => seedInitialAdmin().catch((err) => logger.warn({ err }, "initial admin seed failed")))
  .then(() => ensureInitialAdminPatientsCollection().catch((err) => logger.warn({ err }, "patients collection seed failed")))
  .then(() => backfillPatientsOwner().catch((err) => logger.warn({ err }, "patients owner backfill failed")))
  .then(() => radiologyImageService.ensureTable().catch((err) => logger.warn({ err }, "radiology_images table ensure failed")))
  .then(() => ensureTourConfig().catch((err) => logger.warn({ err }, "tour_config table ensure failed")))
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