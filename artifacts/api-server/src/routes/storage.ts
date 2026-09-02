import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, BucketNotFoundError } from "../lib/objectStorage";
import { s3Client } from "../lib/objectStorage";
import { PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { db, patientsTable, pool } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { radiologyImageService } from "../lib/radiologyImages";
import { ensureUserPatientsDefinition } from "../lib/patientsCollection";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { safeFetch } from "../lib/ssrf";
import { rateLimit, clientIp } from "../lib/security";

// Per-IP rate limits on the upload paths. Storage already sits behind
// `requireAuth` so a leaked token is a precondition, but a token-holder
// on many devices / many IPs can still hammer the upload endpoints.
// These budgets stop a single IP from doing 1000+ presign requests / min.
const UPLOAD_REQ_LIMIT = 60; // per IP per 15 min
const UPLOAD_REQ_WINDOW_MS = 15 * 60 * 1000;
const UPLOAD_FILE_LIMIT = 30; // per IP per 15 min
const UPLOAD_FILE_WINDOW_MS = 15 * 60 * 1000;
const SSRF_IMPORT_LIMIT = 30; // per IP per 15 min — costs a network round-trip
const SSRF_IMPORT_WINDOW_MS = 15 * 60 * 1000;

/** Standard 429 response shape used by every rate-limited route. */
function tooManyRequests(res: Response, retryAfterSec: number): void {
  res.set("Retry-After", String(retryAfterSec));
  res.status(429).json({ error: `Too many requests. Try again in ${retryAfterSec}s.` });
}

// Only these image MIME types are accepted; SVG/XML/HTML are rejected to
// prevent stored XSS via uploaded "images".
const ALLOWED_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB cap
// Object reads are restricted to the application's own prefixes.
// The canonical S3 prefix is `radiology/` (see STORAGE.md); the env
// vars PUBLIC_OBJECT_SEARCH_PATHS / PRIVATE_OBJECT_DIR add additional
// read paths for backward compatibility with buckets that contain
// legacy data uploaded under the historical /mednexus/ or /objects/
// layout. New writes only ever use `radiology/`.
const ALLOWED_OBJECT_PREFIXES = ["radiology/"];

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Authenticate every storage route except the public object viewer and the
// anonymous health check. Previously the entire router was open, exposing
// private radiology images and allowing unauthenticated uploads / SSRF.
router.use("/storage/objects", requireAuth);
router.use("/storage/uploads", requireAuth);
router.use("/storage/images", requireAuth);
router.use("/storage/ensure-bucket", requireAuth);

// ---- S3 listing helpers (P1.14) -------------------------------------------
// ListObjectsV2 returns at most 1000 keys per call. We paginate via
// ContinuationToken so a patient with >1000 images doesn't silently
// lose the rest. Errors are surfaced to the caller (no more `catch {}`),
// so the HTTP layer can return 502 / 503 instead of an empty array that
// looks like "no images".
const S3_LIST_PAGE_SIZE = 1000;
const S3_LIST_MAX_PAGES = 100; // hard cap to avoid pathological loops

/**
 * Validate a user-supplied patient identifier before it goes into an
 * S3 Prefix. The S3 Prefix is a string filter, not a glob, so a
 * malicious value like "X_" or "*" can match objects from another
 * patient (prefix-injection). We only allow digits since patient
 * IDs in the DB are integer serial columns.
 */
function isSafePatientIdForPrefix(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/**
 * Iterate every object under `prefix` in `bucket`, paginated. Returns
 * a flat array of object keys. Throws on S3 errors so the caller can
 * distinguish "no objects" (empty array) from "S3 unavailable"
 * (thrown). Capped at S3_LIST_MAX_PAGES * S3_LIST_PAGE_SIZE = 100 000
 * keys per call to defend against runaway buckets.
 */
async function listAllObjectsUnderPrefix(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined = undefined;
  for (let page = 0; page < S3_LIST_MAX_PAGES; page++) {
    const pageRes: {
      Contents?: { Key?: string }[];
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: S3_LIST_PAGE_SIZE,
        ContinuationToken: token,
      }),
    );
    for (const obj of pageRes.Contents ?? []) {
      if (obj.Key) out.push(obj.Key);
    }
    if (!pageRes.IsTruncated || !pageRes.NextContinuationToken) break;
    token = pageRes.NextContinuationToken;
  }
  return out;
}

/**
 * Find every radiology object whose key starts with
 * `radiology/patient_<patientId>_`. The patientId is validated as a
 * digit-only string before being interpolated into the prefix.
 *
 * Returns an empty array when the patient has no images. Throws on S3
 * errors so the route can return a real 5xx instead of a misleading
 * 200-with-empty-array.
 */
async function discoverImagesByPatientId(patientId: string): Promise<string[]> {
  if (!patientId) return [];
  if (!isSafePatientIdForPrefix(patientId)) {
    throw new Error("Invalid patient id");
  }
  const bucket = objectStorageService.getBucket();
  return listAllObjectsUnderPrefix(bucket, `radiology/patient_${patientId}_`);
}

function isImageUrl(path: string): boolean {
  if (!path) return false;
  const trimmed = path.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function validateImportImageBody(body: unknown): { url: string; filename?: string; patientId?: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.url !== "string" || !obj.url) return null;
  return {
    url: obj.url,
    filename: typeof obj.filename === "string" ? obj.filename : undefined,
    patientId: typeof obj.patientId === "string" ? obj.patientId : undefined,
  };
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

function guessExtension(url: string, contentType: string | null): string {
  if (contentType) {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  }
  const m = url.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i);
  if (m) return m[1]!.toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

/**
 * Stream an S3/MinIO object's bytes straight to the Express response.
 *
 * We deliberately do NOT redirect to a presigned URL: in production the
 * presigned URL points at an internal MinIO host (e.g. localhost:9000) that
 * the browser cannot reach, which surfaced as 403s. Streaming through the API
 * server keeps the browser talking only to the app origin (research-center.fit).
 */
async function streamObject(res: Response, bucket: string, key: string): Promise<void> {
  const out = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = out.Body;
  if (!body) throw new Error("Empty object body");
  res.setHeader("Content-Type", out.ContentType || "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (out.ContentLength) res.setHeader("Content-Length", String(out.ContentLength));
  if (out.ContentDisposition) res.setHeader("Content-Disposition", out.ContentDisposition);
  const nodeStream = body as Readable;
  nodeStream.on("error", (streamErr) => {
    logger.error({ err: streamErr }, "Error streaming object body");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream object" });
    } else {
      res.end();
    }
  });
  nodeStream.pipe(res);
}

/**
 * Best-effort: also attach an uploaded image to the active "Patients"
 * collection (record) so it shows up under the collection feature, not only on
 * the legacy patients.radiology_images column. Idempotent on (recordId, objectKey).
 */
async function attachToActiveCollection(patientIdText: string, objectKey: string, userId: number): Promise<void> {
  if (!patientIdText) return;
  try {
    // Attach to the current user's own "Patients" collection (private per user).
    const defId = await ensureUserPatientsDefinition(userId);
    const normalized = patientIdText.replace(/^PAT/i, "");
    const rec = await pool.query(
      `SELECT "id" FROM "records"
       WHERE "definition_id" = $1
         AND ("data"->>'patientId' = $2 OR "data"->>'patientId' = $3)
       LIMIT 1`,
      [defId, patientIdText, normalized],
    );
    const recordId = rec.rows[0]?.id;
    if (!recordId) return;

    await pool.query(
      `INSERT INTO "record_images" ("record_id", "field_key", "object_key")
       SELECT $1, 'radiologyImages', $2
       WHERE NOT EXISTS (
         SELECT 1 FROM "record_images" WHERE "record_id" = $1 AND "object_key" = $2
       )`,
      [recordId, objectKey],
    );
  } catch (err) {
    logger.warn({ err, patientIdText, objectKey }, "Failed to attach image to collection record");
  }
}

router.get("/storage/health", async (_req: Request, res: Response) => {
  try {
    await objectStorageService.ensureBucketExists();
    res.json({ status: "ok", storage: "healthy" });
  } catch (error) {
    const err = error as Error & { name?: string };
    res.status(503).json({ 
      status: "unhealthy", 
      storage: "unavailable", 
      error: err.message,
      errorCode: err.name
    });
  }
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const limit = rateLimit(`upload-req:${clientIp(req)}`, UPLOAD_REQ_LIMIT, UPLOAD_REQ_WINDOW_MS);
  if (!limit.success) {
    tooManyRequests(res, limit.retryAfterSec);
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const bucket = objectStorageService.getBucket();
    const safeName = sanitizeFilename(name);
    const objectId = `${Date.now()}-${safeName}`;
    const objectKey = `radiology/${objectId}`;

    const uploadURL = await objectStorageService.getPresignedUploadUrl(
      bucket,
      objectKey,
      contentType,
      900
    );

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath: objectKey,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : (raw as string);
    
    if (!objectStorageService.getPublicObjectSearchPaths().length) {
      res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
          'utf-8'
        )
      );
      return;
    }
    
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
          'utf-8'
        )
      );
      return;
    }

    await streamObject(res, file.bucketName, file.key);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err: err.message, filePath: req.params.filePath }, "Error serving public object");
    res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
        'utf-8'
      )
    );
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectKey = Array.isArray(raw) ? raw.join("/") : raw;

    // Prevent reading objects outside the application's own prefixes.
    if (!ALLOWED_OBJECT_PREFIXES.some((p) => objectKey.startsWith(p))) {
      res.status(403).json({ error: "Access to this object is forbidden" });
      return;
    }

    const bucket = objectStorageService.getBucket();
    await streamObject(res, bucket, objectKey);
  } catch (error) {
    const err = error as { name?: string; message?: string };
    if (err.name === "NoSuchKey" || err.name === "NotFound") {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

router.post("/storage/ensure-bucket", async (_req: Request, res: Response) => {
  try {
    await objectStorageService.ensureBucketExists();
    res.json({ message: "Bucket is ready" });
  } catch (error) {
    const err = error as Error;
    if (err instanceof BucketNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

interface ImportImageFromUrlResponse {
  objectPath: string;
  contentType: string;
}

router.post("/storage/images/import", async (req: Request, res: Response) => {
  const limit = rateLimit(`ssrf-import:${clientIp(req)}`, SSRF_IMPORT_LIMIT, SSRF_IMPORT_WINDOW_MS);
  if (!limit.success) {
    tooManyRequests(res, limit.retryAfterSec);
    return;
  }
  const body = validateImportImageBody(req.body);
  if (!body) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { url, filename } = body;
  if (!isImageUrl(url)) {
    res.status(400).json({ error: "A valid image URL is required" });
    return;
  }

  try {
    let response: Awaited<ReturnType<typeof safeFetch>>;
    try {
      response = await safeFetch(url, {
        timeoutMs: 15_000,
        maxBytes: MAX_IMPORT_BYTES,
        allowedContentTypes: ["image/"],
      });
    } catch {
      res.status(400).json({ error: "Failed to fetch image from URL (blocked or unsupported)" });
      return;
    }

    const rawContentType = response.headers.get("content-type") || "application/octet-stream";
    // Reject scriptable types (SVG/XML) to prevent stored XSS.
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(rawContentType.toLowerCase())) {
      res.status(400).json({ error: `URL does not point to a supported image (content-type: ${rawContentType})` });
      return;
    }
    const contentType = rawContentType.toLowerCase();

    const arrayBuffer = await response.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);

    const ext = guessExtension(url, contentType);
    const baseName = filename ? sanitizeFilename(filename.replace(/\.[^/.]+$/, "")) : `imported_${Date.now()}`;
    const cleanExt = ext.replace(/^\./, "");
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${cleanExt}`;
    const objectKey = `radiology/${objectId}`;

    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    res.json({
      objectPath: objectKey,
      contentType: contentType,
    } as ImportImageFromUrlResponse);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err }, "Failed to import image from URL");
    res.status(500).json({ error: err.message || "Failed to import image from URL" });
  }
});

interface ImportImageByPatientResponse {
  objectPath: string;
  patientImages: string[];
}

router.post("/storage/images/by-patient", async (req: Request, res: Response) => {
  const body = validateImportImageBody(req.body);
  if (!body) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { url, filename, patientId } = body;
  if (!isImageUrl(url)) {
    res.status(400).json({ error: "A valid image URL is required" });
    return;
  }

  try {
    let response: Awaited<ReturnType<typeof safeFetch>>;
    try {
      response = await safeFetch(url, {
        timeoutMs: 15_000,
        maxBytes: MAX_IMPORT_BYTES,
        allowedContentTypes: ["image/"],
      });
    } catch {
      res.status(400).json({ error: "Failed to fetch image from URL (blocked or unsupported)" });
      return;
    }

    const rawContentType = response.headers.get("content-type") || "application/octet-stream";
    // Reject scriptable types (SVG/XML) to prevent stored XSS.
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(rawContentType.toLowerCase())) {
      res.status(400).json({ error: `URL does not point to a supported image (content-type: ${rawContentType})` });
      return;
    }
    const contentType = rawContentType.toLowerCase();

    const arrayBuffer = await response.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);

    const ext = guessExtension(url, contentType);
    const baseName = patientId ? `patient_${patientId}` : (filename ? sanitizeFilename(filename.replace(/\.[^/.]+$/, "")) : `imported_${Date.now()}`);
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const objectKey = `radiology/${objectId}`;

    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    const discoveredImages = patientId ? await discoverImagesByPatientId(patientId) : [];

    res.json({
      objectPath: objectKey,
      patientImages: discoveredImages,
    } as ImportImageByPatientResponse);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err }, "Failed to import image for patient");
    res.status(500).json({ error: err.message || "Failed to import image for patient" });
  }
});

router.get("/storage/images/by-patient/:patientId", async (req: Request, res: Response) => {
  const { patientId } = req.params;
  if (!isSafePatientIdForPrefix(String(patientId))) {
    res.status(400).json({ error: "Invalid patientId" });
    return;
  }
  try {
    const images = await discoverImagesByPatientId(String(patientId));
    res.json({ patientId, images });
  } catch (error) {
    req.log.error({ err: error }, "Failed to discover images for patient");
    res.status(500).json({ error: "Failed to discover images" });
  }
});

router.post("/storage/images/search", async (req: Request, res: Response) => {
  const { identifier, patientId, filename } = req.body as { identifier?: string; patientId?: string; filename?: string };

  if (!identifier && !filename) {
    res.status(400).json({ error: "Either 'identifier' or 'filename' is required" });
    return;
  }

  // The `patientId` is the only thing we interpolate into an S3 Prefix
  // (when provided), so we validate it. `identifier` is a full match
  // against candidate prefixes (no substring); we don't need to
  // validate it the same way. `filename` is matched as a suffix
  // (`.includes`), so it never becomes an S3 Prefix.
  if (patientId !== undefined && patientId !== "" && !isSafePatientIdForPrefix(String(patientId))) {
    res.status(400).json({ error: "Invalid patientId" });
    return;
  }

  try {
    const bucket = objectStorageService.getBucket();
    const keys: string[] = [];

    if (identifier) {
      // Identifier-based lookup. Try a few known layouts; the existing
      // legacy layout (patient_<id>_) and the newer direct-id layout.
      // We only list under prefixes that are scoped to `radiology/`,
      // never the whole bucket.
      const patterns = [
        `radiology/${identifier}_`,
        `radiology/patient_${identifier}_`,
        `radiology/${identifier}.`,
        `radiology/image_${identifier}.`,
      ];
      for (const prefix of patterns) {
        const found = await listAllObjectsUnderPrefix(bucket, prefix);
        for (const k of found) if (!keys.includes(k)) keys.push(k);
      }
    }

    if (filename) {
      // Filename is matched as a substring in the **scoped** key set.
      // If a patientId is provided, restrict the listing to that
      // patient's prefix; otherwise we refuse the request to avoid
      // an O(bucket) substring scan. Caller must either provide
      // patientId (cheap, prefix-scoped) or an identifier (also
      // prefix-scoped).
      if (!patientId && !identifier) {
        res.status(400).json({
          error:
            "filename lookup requires patientId or identifier to avoid scanning the entire bucket",
        });
        return;
      }
      const prefix = patientId
        ? `radiology/patient_${patientId}_`
        : `radiology/${identifier}_`;
      const searchKey = filename.toLowerCase();
      const scoped = await listAllObjectsUnderPrefix(bucket, prefix);
      for (const k of scoped) {
        if (k.toLowerCase().includes(searchKey) && !keys.includes(k)) {
          keys.push(k);
        }
      }
    }

    const result: { objectPath: string; patientImages?: string[]; attachmentPatientId?: string } = {
      objectPath: keys[0] ?? "",
    };

    if (!result.objectPath) {
      res.status(404).json({ error: "No images found matching the criteria" });
      return;
    }

    if (patientId) {
      result.attachmentPatientId = patientId;
      if (!keys[0]?.startsWith("radiology/")) {
        result.objectPath = `radiology/${keys[0]}`;
      }
      result.patientImages = keys;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to search images", details: String(error) });
  }
});

router.post("/storage/upload-file", async (req: Request, res: Response) => {
  const limit = rateLimit(`upload-file:${clientIp(req)}`, UPLOAD_FILE_LIMIT, UPLOAD_FILE_WINDOW_MS);
  if (!limit.success) {
    tooManyRequests(res, limit.retryAfterSec);
    return;
  }
  const patientId = req.body?.patientId as string | undefined;

  // Ensure bucket exists first
  try {
    await objectStorageService.ensureBucketExists();
  } catch {
    res.status(503).json({ error: "Storage bucket not available" });
    return;
  }
  
  try {
    const fileData = req.body?.fileData as string | undefined;
    const filename = req.body?.filename as string | undefined;
    const declaredContentType = req.body?.contentType as string | undefined;
    // Never trust the caller's content type for stored objects; reject
    // scriptable types (SVG/XML) to prevent stored XSS.
    const contentType =
      declaredContentType && ALLOWED_IMAGE_CONTENT_TYPES.includes(declaredContentType.toLowerCase())
        ? declaredContentType.toLowerCase()
        : "image/jpeg";
    
    if (!fileData) {
      res.status(400).json({ error: "No file data provided (fileData as base64)" });
      return;
    }
    
    if (!filename) {
      res.status(400).json({ error: "No filename provided" });
      return;
    }
    
    const sanitizedFilename = sanitizeFilename(filename);
    const ext = sanitizedFilename.split('.').pop() || 'jpg';
    const baseName = patientId ? `patient_${patientId}` : `upload_${Date.now()}`;
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const objectKey = `radiology/${objectId}`;
    
    const buffer = Buffer.from(fileData, 'base64');
    
    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType || 'image/jpeg',
    }));
    
    const result: Record<string, any> = { objectPath: objectKey, objectUrl: `/api/storage/public-objects/${objectKey}` };
    
    if (patientId) {
      req.log.info({ patientId }, "Looking up patient for image upload");
      
      const normalizedId = patientId.replace(/^PAT/, '');
      
      const [patient] = await db
        .select()
        .from(patientsTable)
        .where(eq(patientsTable.patientId, normalizedId))
        .limit(1);
      
      if (!patient) {
        const [patientWithPat] = await db
          .select()
          .from(patientsTable)
          .where(eq(patientsTable.patientId, patientId))
          .limit(1);
        
        if (!patientWithPat) {
          req.log.warn({ patientId }, "Patient not found during image upload");
          res.status(200).json(result);
          return;
        }
        
        await updatePatientImages(req, patientWithPat, objectKey, result);
        return;
      }
      
      await updatePatientImages(req, patient, objectKey, result);
    }
    
    res.json(result);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err: err.message, patientId }, "Upload failed");
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

async function updatePatientImages(req: Request, patient: any, objectKey: string, result: Record<string, any>) {
  try {
    const fileData = req.body?.fileData as string | undefined;
    const fileSize = fileData ? Buffer.from(fileData, "base64").length : null;

    await radiologyImageService.addImage(patient.id, {
      objectKey,
      originalFilename: (req.body?.filename as string) ?? null,
      mimeType: (req.body?.contentType as string) ?? null,
      fileSize,
    });

    const images = await radiologyImageService.listImages(patient.id);

    req.log.info({ patientId: patient?.patientId, imageCount: images.length }, "Patient images updated successfully");

    // Also attach to the active "Patients" collection so the image is visible
    // under the collection feature, not only on the legacy patients column.
    await attachToActiveCollection(patient.patientId, objectKey, req.session?.userId ?? 0);

    result.patientId = patient.patientId;
    result.previewsCount = images.length;
    result.patientImages = images.map((i: { objectKey: string }) => i.objectKey);
  } catch (updateErr: any) {
    req.log.error({ updateErr, patientId: patient?.patientId }, "Failed to update patient images");
  }
}

export default router;