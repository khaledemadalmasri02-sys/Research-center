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