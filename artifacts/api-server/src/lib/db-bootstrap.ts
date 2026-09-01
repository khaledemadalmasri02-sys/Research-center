import { pool } from "@workspace/db";

/**
 * Idempotent schema bootstrap for the api-server.
 *
 * The api-server historically ran its DDL inline at startup in `index.ts`.
 * Extracting it here lets tests and one-off scripts bring up a clean database
 * without booting the full server. This module is a stepping stone to a proper
 * Drizzle migration workflow (P0.5): the same SQL is now reusable, and the
 * next step is to convert each CREATE TABLE / ALTER TABLE statement into a
 * versioned migration file produced by `drizzle-kit generate`.
 */

export async function ensureSessionTable(): Promise<void> {
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

export async function ensureAuthTables(): Promise<void> {
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

export async function ensureTourConfigTable(): Promise<void> {
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

export async function ensureInboundEmailTable(): Promise<void> {
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

/** Run every ensure* step in the order they were historically executed at startup. */
export async function ensureAllTables(): Promise<void> {
  await ensureSessionTable();
  await ensureAuthTables();
  await ensureTourConfigTable();
  await ensureInboundEmailTable();
}