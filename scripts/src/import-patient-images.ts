/**
 * Local Folder Import — Radiology Images (multi-image, per patient)
 *
 * Scans a directory for image files, groups them by patient using the numeric
 * patient id parsed from each filename (handles "89373(1).png" + "89373(2).png"
 * -> patient "89373"), uploads each to S3/MinIO under radiology/<patientId>/,
 * records one row per image in the radiology_images table, and keeps the
 * patients.radiologyImages cache in sync.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run import-patient-images <FOLDER> \
 *     [--create-missing] [--dry-run]
 *
 * Environment:
 *   DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_BUCKET, S3_REGION, S3_FORCE_PATH_STYLE
 */

import { Pool } from "pg";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { readdir, stat } from "fs/promises";
import path from "path";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".dcm", ".dicom",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".dcm": "application/dicom",
  ".dicom": "application/dicom",
};

interface Args {
  folder: string;
  createMissing: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let createMissing = false;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--create-missing") createMissing = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) {
      console.warn(`Unknown flag: ${arg}`);
    } else positional.push(arg);
  }

  const folder = positional[0];
  if (!folder) {
    console.error("Usage: import-patient-images <FOLDER> [--create-missing] [--dry-run]");
    process.exit(1);
  }
  return { folder, createMissing, dryRun };
}

/**
 * Extract the patient id from a filename.
 *  - "89373(1).png"     -> "89373"
 *  - "patient_89373.png"-> "89373"
 *  - "PAT89373 x.png"   -> "89373"
 * Falls back to a leading numeric run in the parent directory name.
 */
function parsePatientId(filename: string, parentDir: string): string | null {
  const base = path.basename(filename, path.extname(filename));
  let s = base.replace(/\([^)]*\)\s*$/, "").trim();
  s = s.replace(/^patient[-_]?/i, "").replace(/^pat/i, "").trim();
  const m = s.match(/^(\d+)/);
  if (m) return m[1];
  const dm = parentDir.match(/(\d+)/);
  if (dm) return dm[1];
  return null;
}

function sanitizeKeySegment(seg: string): string {
  return seg.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._()-]/g, "_");
}

async function collectFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, out);
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!process.env.S3_BUCKET) {
    console.error("S3_BUCKET is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure the radiology_images table exists (idempotent).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radiology_images (
      id serial PRIMARY KEY,
      patient_id integer NOT NULL,
      study_id text,
      object_key text NOT NULL,
      original_filename text,
      mime_type text,
      file_size integer,
      etag text,
      upload_timestamp timestamptz DEFAULT now(),
      metadata json
    );
    CREATE INDEX IF NOT EXISTS idx_radiology_images_patient_id ON radiology_images (patient_id);
  `);

  const s3 = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
  const bucket = process.env.S3_BUCKET;

  console.log(`Scanning ${args.folder}${args.dryRun ? " (DRY RUN)" : ""} ...`);
  const files: string[] = [];
  await collectFiles(args.folder, files);
  console.log(`Found ${files.length} image file(s).`);

  // Patient text id -> numeric patients.id
  const patientIdCache = new Map<string, number | null>();
  const touchedPatients = new Set<number>();

  async function resolvePatient(textId: string): Promise<number | null> {
    if (patientIdCache.has(textId)) return patientIdCache.get(textId)!;
    const normalized = textId.replace(/^PAT/i, "");
    const candidates = [textId, normalized].filter((v, i, a) => a.indexOf(v) === i);
    for (const cand of candidates) {
      const { rows } = await pool.query<{ id: number }>(
        "SELECT id FROM patients WHERE patient_id = $1 LIMIT 1",
        [cand]
      );
      if (rows[0]) {
        patientIdCache.set(textId, rows[0].id);
        return rows[0].id;
      }
    }
    if (args.createMissing) {
      const { rows } = await pool.query<{ id: number }>(
        "INSERT INTO patients (patient_id, patient_name) VALUES ($1, $1) RETURNING id",
        [textId]
      );
      const id = rows[0]!.id;
      patientIdCache.set(textId, id);
      console.log(`  • created patient ${textId} (id=${id})`);
      return id;
    }
    patientIdCache.set(textId, null);
    return null;
  }

  async function objectExists(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const parentDir = path.basename(path.dirname(file));
    const textId = parsePatientId(path.basename(file), parentDir);
    if (!textId) {
      console.warn(`  ! could not parse patient id from "${file}" — skipping`);
      skipped++;
      continue;
    }

    const patientNumericId = await resolvePatient(textId);
    if (patientNumericId == null) {
      console.warn(`  ! patient "${textId}" not found and --create-missing not set — skipping ${path.basename(file)}`);
      skipped++;
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    const safeName = sanitizeKeySegment(path.basename(file));
    const objectKey = `radiology/${textId}/${safeName}`;

    if (await objectExists(objectKey)) {
      console.log(`  • exists  ${textId}/${safeName}`);
      // still make sure a row + cache exist
    } else {
      if (args.dryRun) {
        console.log(`  • would upload ${file} -> ${objectKey}`);
        uploaded++;
        touchedPatients.add(patientNumericId);
        continue;
      }
      try {
        const { readFile } = await import("fs/promises");
        const body = await readFile(file);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: body,
            ContentType: mime,
          })
        );
        console.log(`  • uploaded ${textId}/${safeName}`);
        uploaded++;
      } catch (err) {
        console.error(`  ! failed ${file}: ${String(err)}`);
        failed++;
        continue;
      }
    }

    if (!args.dryRun) {
      try {
        const { rows } = await pool.query<{ id: number }>(
          "SELECT id FROM radiology_images WHERE patient_id = $1 AND object_key = $2 LIMIT 1",
          [patientNumericId, objectKey]
        );
        if (!rows[0]) {
          await pool.query(
            `INSERT INTO radiology_images
               (patient_id, object_key, original_filename, mime_type, file_size)
             VALUES ($1, $2, $3, $4, $5)`,
            [patientNumericId, objectKey, path.basename(file), mime, (await stat(file)).size]
          );
        }
      } catch (err) {
        console.error(`  ! db insert failed for ${objectKey}: ${String(err)}`);
        failed++;
        continue;
      }
    }
    touchedPatients.add(patientNumericId);
  }

  if (!args.dryRun && touchedPatients.size > 0) {
    console.log(`\nSyncing image cache for ${touchedPatients.size} patient(s) ...`);
    for (const pid of touchedPatients) {
      await pool.query(
        `UPDATE patients SET
           radiology_images = COALESCE(
             (SELECT json_agg(object_key ORDER BY upload_timestamp DESC)
              FROM radiology_images WHERE patient_id = patients.id)::text, NULL),
           radiology_image_file_path_or_link = (
             SELECT object_key FROM radiology_images
             WHERE patient_id = patients.id ORDER BY upload_timestamp DESC LIMIT 1),
           updated_at = now()
         WHERE id = $1`,
        [pid]
      );
    }
  }

  console.log(`\n=== Import Summary ===`);
  console.log(`Uploaded : ${uploaded}`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Failed   : ${failed}`);
  if (args.createMissing) console.log("(missing patients were created)");

  await pool.end();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
