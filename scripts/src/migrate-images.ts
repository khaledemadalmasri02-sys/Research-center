/**
 * Image Migration Script
 *
 * Migrates existing Base64 images or database-stored image data to MinIO/S3.
 *
 * Usage:
 *   npx tsx scripts/migrate-images.ts
 *
 * Environment variables required:
 *   DATABASE_URL - PostgreSQL connection string
 *   S3_ENDPOINT - MinIO/S3 endpoint
 *   S3_ACCESS_KEY_ID - S3 access key
 *   S3_SECRET_ACCESS_KEY - S3 secret key
 *   S3_BUCKET - Target bucket name
 *   S3_REGION - S3 region
 */

import { Pool } from "pg";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const s3Client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

interface MigrationResult {
  patientId: number;
  oldPath: string;
  newKey: string;
  status: "success" | "skipped" | "failed";
  error?: string;
}

const BATCH_SIZE = 10;

function decodeBase64Image(base64: string): Buffer | null {
  if (!base64.startsWith("data:image/")) {
    if (!base64.match(/^[A-Za-z0-9+/=]+$/)) {
      return null;
    }
  }

  const headerMatch = base64.match(/^data:image\/([^;]+);base64,(.*)$/);
  const base64Data = headerMatch ? headerMatch[2] : base64;

  try {
    return Buffer.from(base64Data, "base64");
  } catch {
    return null;
  }
}

function extractMimeType(base64: string): string {
  const match = base64.match(/^data:image\/([^;]+)/);
  return match ? `image/${match[1]}` : "image/jpeg";
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadImage(base64Data: string, bucket: string): Promise<{ key: string; etag: string } | null> {
  const buffer = decodeBase64Image(base64Data);
  if (!buffer) return null;

  const ext = extractMimeType(base64Data).split("/")[1] || "jpg";
  const key = `radiology-migrated/${randomUUID()}.${ext}`;

  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: extractMimeType(base64Data),
    })
  );

  return { key, etag: response.ETag || "" };
}

async function migrateBatch(
  patients: Array<{ id: number; radiologyImageFilePathOrLink: string | null }>,
  bucket: string
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  for (const patient of patients) {
    const oldPath = patient.radiologyImageFilePathOrLink;

    if (!oldPath) {
      results.push({
        patientId: patient.id,
        oldPath: oldPath || "",
        newKey: "",
        status: "skipped",
        error: "No image path",
      });
      continue;
    }

    if (oldPath.startsWith("http://") || oldPath.startsWith("https://")) {
      results.push({
        patientId: patient.id,
        oldPath,
        newKey: "",
        status: "skipped",
        error: "External URL - SSRF security risk",
      });
      continue;
    }

    if (oldPath.startsWith("data:image")) {
      try {
        const result = await uploadImage(oldPath, bucket);
        if (!result) {
          results.push({
            patientId: patient.id,
            oldPath,
            newKey: "",
            status: "failed",
            error: "Failed to decode image data",
          });
          continue;
        }

        if (await objectExists(bucket, result.key)) {
          results.push({
            patientId: patient.id,
            oldPath,
            newKey: result.key,
            status: "success",
          });
        }
      } catch (error) {
        results.push({
          patientId: patient.id,
          oldPath,
          newKey: "",
          status: "failed",
          error: String(error),
        });
      }
      continue;
    }

    if (oldPath.startsWith("/objects/") || oldPath.startsWith("radiology")) {
      results.push({
        patientId: patient.id,
        oldPath,
        newKey: "",
        status: "skipped",
        error: "Already local/S3 path",
      });
      continue;
    }

    results.push({
      patientId: patient.id,
      oldPath,
      newKey: "",
      status: "skipped",
      error: "Unknown path format",
    });
  }

  return results;
}

async function runMigration(): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.error("S3_BUCKET environment variable not set");
    process.exit(1);
  }

  console.log("Starting image migration...");
  console.log(`Target bucket: ${bucket}`);

  const client = await s3Client.config.credentials?.();
  console.log(`Credentials: ${!!client?.accessKeyId}`);

  const { rows } = await pool.query<{
    id: number;
    radiologyImageFilePathOrLink: string | null;
  }>(`SELECT id, radiology_image_file_path_or_link FROM patients WHERE radiology_image_file_path_or_link IS NOT NULL AND radiology_image_file_path_or_link != ''`);

  console.log(`Found ${rows.length} patients with image paths`);

  const allResults: MigrationResult[] = [];
  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await migrateBatch(batch, bucket);
    allResults.push(...results);

    for (const r of results) {
      if (r.status === "success") totalSuccess++;
      else if (r.status === "skipped") totalSkipped++;
      else totalFailed++;
    }

    console.log(`Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log("\n=== Migration Summary ===");
  console.log(`Success: ${totalSuccess}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Failed: ${totalFailed}`);

  const errorResults = allResults.filter(r => r.status === "failed");
  if (errorResults.length > 0) {
    console.log("\nFailed migrations:");
    for (const r of errorResults) {
      console.log(`  Patient ${r.patientId}: ${r.error}`);
    }
  }

  console.log("\nMigration complete. Review results above before updating records.");
  console.log("Note: Old image data has NOT been deleted. Manual cleanup may be required.");

  await pool.end();
}

runMigration().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});