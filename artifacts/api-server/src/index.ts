import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { s3Client } from "./lib/objectStorage";
import { radiologyImageService } from "./lib/radiologyImages";

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
  `);
}

// Shared "Patients" definition so the patient workflow runs through the
// dynamic records engine while remaining usable by every user.
const PATIENTS_DEFINITION_FIELDS = [
  { key: "collectionName", label: "Collection Name", type: "text" },
  { key: "collectionDate", label: "Collection Date", type: "date" },
  { key: "collectionType", label: "Collection Type", type: "select", options: ["Normal", "Abnormal", "Suspicious"] },
  { key: "patientId", label: "Patient ID", type: "text", required: true },
  { key: "patientName", label: "Patient Name", type: "text", required: true },
  { key: "age", label: "Age", type: "number" },
  { key: "sex", label: "Sex", type: "select", options: ["Male", "Female", "Other"] },
  { key: "dateOfVisit", label: "Date of Visit", type: "date" },
  { key: "chiefComplaint", label: "Chief Complaint", type: "textarea" },
  { key: "vitalSigns", label: "Vital Signs", type: "textarea" },
  { key: "historyTrauma", label: "History of Trauma", type: "textarea" },
  { key: "mechanismOfInjuryAndLocalisation", label: "Mechanism of Injury", type: "textarea" },
  { key: "signsAndSymptomsTrauma", label: "Signs & Symptoms (Trauma)", type: "textarea" },
  { key: "historyMedical", label: "Medical History", type: "textarea" },
  { key: "signsAndSymptomsMedical", label: "Signs & Symptoms (Medical)", type: "textarea" },
  { key: "riskFactors", label: "Risk Factors", type: "textarea" },
  { key: "provisionalDiagnosis", label: "Provisional Diagnosis", type: "textarea" },
  { key: "radiologyImages", label: "Radiology Images", type: "image" },
  { key: "emergencyReport", label: "Emergency Report", type: "textarea" },
  { key: "aiPredictionOutput", label: "AI Prediction Output", type: "textarea" },
  { key: "finalConfirmedDiagnosisAr", label: "Final Diagnosis (AR)", type: "textarea" },
  { key: "finalConfirmedDiagnosis", label: "Final Diagnosis", type: "textarea" },
  { key: "notes", label: "Notes", type: "textarea" },
];

async function ensurePatientsDefinition(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT "id" FROM "record_definitions" WHERE "name" = $1 AND "shared" = true LIMIT 1`,
    ["Patients"],
  );
  let defId: number;
  if (rows.length === 0) {
    const ins = await pool.query(
      `INSERT INTO "record_definitions" ("user_id", "name", "fields", "shared", "isActive", "isDefault", "created_at", "updated_at")
       VALUES ($1, $2, $3, true, true, true, now(), now()) RETURNING "id"`,
      [0, "Patients", JSON.stringify(PATIENTS_DEFINITION_FIELDS)],
    );
    defId = Number(ins.rows[0].id);
  } else {
    defId = Number(rows[0].id);
    // Ensure exactly one active shared definition exists.
    const active = await pool.query(
      `SELECT 1 FROM "record_definitions" WHERE "shared" = true AND "isActive" = true LIMIT 1`,
    );
    if (active.rows.length === 0) {
      await pool.query(`UPDATE "record_definitions" SET "isActive" = true WHERE "id" = $1`, [defId]);
    }
    // Ensure a default collection exists (used when adding new records).
    const def = await pool.query(
      `SELECT 1 FROM "record_definitions" WHERE "isDefault" = true AND "deactivated" = false LIMIT 1`,
    );
    if (def.rows.length === 0) {
      await pool.query(`UPDATE "record_definitions" SET "isDefault" = true WHERE "id" = $1`, [defId]);
    }
  }
  return defId;
}

// Map physical patients columns -> Collection A (Patients) field keys.
const PATIENT_COLUMN_MAP: Array<[string, string]> = [
  ["collection_name", "collectionName"],
  ["collection_date", "collectionDate"],
  ["collection_type", "collectionType"],
  ["patient_id", "patientId"],
  ["patient_name", "patientName"],
  ["age", "age"],
  ["sex", "sex"],
  ["date_of_visit", "dateOfVisit"],
  ["chief_complaint", "chiefComplaint"],
  ["vital_signs", "vitalSigns"],
  ["history_trauma", "historyTrauma"],
  ["mechanism_of_injury_and_localisation", "mechanismOfInjuryAndLocalisation"],
  ["signs_and_symptoms_trauma", "signsAndSymptomsTrauma"],
  ["history_medical", "historyMedical"],
  ["signs_and_symptoms_medical", "signsAndSymptomsMedical"],
  ["risk_factors", "riskFactors"],
  ["provisional_diagnosis", "provisionalDiagnosis"],
  ["radiology_image_file_path_or_link", "radiologyImageFilePathOrLink"],
  ["radiology_images", "radiologyImages"],
  ["emergency_report", "emergencyReport"],
  ["ai_prediction_output", "aiPredictionOutput"],
  ["final_confirmed_diagnosis_ar", "finalConfirmedDiagnosisAr"],
  ["final_confirmed_diagnosis", "finalConfirmedDiagnosis"],
  ["notes", "notes"],
];

// Copy existing patients rows into Collection A so it "has all the data the
// recent table has". Idempotent: only runs when the definition has no records.
async function seedCollectionAFromPatients(patientsDefId: number) {
  const count = await pool.query(`SELECT 1 FROM "records" WHERE "definition_id" = $1 LIMIT 1`, [patientsDefId]);
  if (count.rows.length > 0) return;

  const { rows: patients } = await pool.query(
    `SELECT * FROM "patients" ORDER BY "id"`,
  );

  for (const p of patients) {
    const data: Record<string, unknown> = {};
    for (const [col, key] of PATIENT_COLUMN_MAP) {
      if (p[col] === undefined || p[col] === null) continue;
      data[key] = p[col];
    }

    const rec = await pool.query(
      `INSERT INTO "records" ("user_id", "definition_id", "data", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5) RETURNING "id"`,
      [0, patientsDefId, JSON.stringify(data), p.created_at ?? new Date(), p.updated_at ?? new Date()],
    );
    const recordId = Number(rec.rows[0].id);

    let images: unknown = data["radiologyImages"];
    if (typeof images === "string") {
      try {
        images = JSON.parse(images);
      } catch {
        images = images ? [images] : [];
      }
    }
    if (Array.isArray(images)) {
      for (const obj of images as unknown[]) {
        if (typeof obj === "string" && obj) {
          await pool.query(
            `INSERT INTO "record_images" ("record_id", "field_key", "object_key") VALUES ($1, 'radiologyImages', $2)`,
            [recordId, obj],
          );
        }
      }
    }
  }
  logger.info({ count: patients.length, definitionId: patientsDefId }, "Seeded Collection A from patients table");
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

ensureSessionTable()
  .then(() => ensureAuthTables())
  .then(async () => {
    let defId: number | null = null;
    try {
      defId = await ensurePatientsDefinition();
    } catch (err) {
      logger.warn({ err }, "patients definition seed failed");
    }
    if (defId != null) {
      try {
        await seedCollectionAFromPatients(defId);
      } catch (err) {
        logger.warn({ err }, "collection A seed failed");
      }
    }
  })
  .then(() => seedInitialAdmin().catch((err) => logger.warn({ err }, "initial admin seed failed")))
  .then(() => radiologyImageService.ensureTable().catch((err) => logger.warn({ err }, "radiology_images table ensure failed")))
  .then(() => ensureBucket())
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