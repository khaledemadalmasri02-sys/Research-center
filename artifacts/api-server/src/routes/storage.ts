import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, BucketNotFoundError } from "../lib/objectStorage";
import { s3Client } from "../lib/objectStorage";
import { PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { randomUUID } from "node:crypto";
import { db, patientsTable, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { radiologyImageService } from "../lib/radiologyImages";
import { ensureUserPatientsDefinition } from "../lib/patientsCollection";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { canAccessObject, ObjectPermission } from "../lib/objectAcl";
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
//
// These four prefixes cover every route below except two, which carry their own
// `requireAuth`: /storage/health and /storage/upload-file (the latter is not
// under /storage/uploads).
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
export function isSafePatientIdForPrefix(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/**
 * The canonical radiology prefix for one patient's images:
 * `radiology/patient_<id>`. The underscore form
 * (`radiology/patient_<id>_1700000000_ab12.png`) is what the upload and
 * import routes have always written, so the prefix stops *before* the
 * separator and every returned key is matched exactly against
 * `patient_<id>` followed by `_` or `/`. That keeps `patient_42` from
 * matching `patient_420` (a prefix-collision read of another patient's
 * images) while also covering the newer `patient_42/<uuid>.png` layout.
 */
export function radiologyPatientPrefix(patientId: string): string {
  return `radiology/patient_${patientId}`;
}

function matchesPatientPrefix(key: string, patientId: string): boolean {
  const marker = `radiology/patient_${patientId}`;
  return key.startsWith(`${marker}_`) || key.startsWith(`${marker}/`);
}

/**
 * Iterate every object under `prefix` in `bucket`, paginated. Returns
 * a flat array of object keys. Throws on S3 errors so the caller can
 * distinguish "no objects" (empty array) from "S3 unavailable"
 * (thrown). Capped at S3_LIST_MAX_PAGES * S3_LIST_PAGE_SIZE = 100 000
 * keys per call to defend against runaway buckets.
 */
export async function listAllObjectsUnderPrefix(
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
 * Find every radiology object that belongs to `patientId`.
 *
 * The patientId is validated as a digit-only string before being
 * interpolated into the prefix (prefix-injection guard), the listing is
 * paginated, and the results are filtered to the exact patient so a
 * `patient_4` request can never return `patient_42`'s images.
 *
 * Returns an empty array when the patient has no images. Throws on S3
 * errors so the route can return a real 5xx instead of a misleading
 * 200-with-empty-array.
 */
export async function discoverImagesByPatientId(patientId: string): Promise<string[]> {
  if (!patientId) return [];
  if (!isSafePatientIdForPrefix(patientId)) {
    throw new Error("Invalid patient id");
  }
  const bucket = objectStorageService.getBucket();
  const found = await listAllObjectsUnderPrefix(bucket, radiologyPatientPrefix(patientId));
  return found.filter((key) => matchesPatientPrefix(key, patientId));
}

// ---- Object ownership / ACL authorisation (A3) ------------------------------
//
// Before this existed the only check on the object read path was the
// `radiology/` prefix allowlist: any authenticated user could read any other
// user's radiology image by guessing/stealing the object key. Two gates now
// apply, in order:
//
//   1. the object ACL layer (lib/objectAcl.ts) — an explicit owner match or
//      explicit `visibility: "public"` grants access;
//   2. otherwise the patient id encoded in the key must belong to the caller
//      (the same `patients.user_id` scoping routes/patients.ts uses).
//
// A key that names no patient and carries no ACL policy is "unattributable"
// (the presigned-upload flow writes those keys — see
// POST /storage/uploads/request-url) and keeps the historical prefix-only
// behaviour. That is a deliberate, documented residual gap: an object
// uploaded without a patientId has no owner to check against.
const PATIENT_ID_IN_KEY = /(?:^|[/_-])patient_(\d+)(?:[/_.-]|$)/i;

/** Extract the patient id a radiology key was written for, if any. */
export function patientIdFromObjectKey(objectKey: string): string | null {
  const match = PATIENT_ID_IN_KEY.exec(objectKey);
  return match ? match[1]! : null;
}

/**
 * Does the requesting session own a patient row with this (numeric) id?
 * Patient ids are stored either bare ("42") or with a "PAT" prefix ("PAT42"),
 * so both spellings are checked, mirroring the upload path.
 */
async function callerOwnsPatientId(req: Request, rawPatientId: string): Promise<boolean> {
  const userId = req.session?.userId ?? 0;
  const normalized = rawPatientId.replace(/^PAT/i, "");
  const candidates = Array.from(new Set([normalized, rawPatientId]));
  const rows = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(
      and(
        eq(patientsTable.userId, userId),
        // `patientId` is a text column; match either spelling.
        eq(patientsTable.patientId, candidates[0]!),
      ),
    )
    .limit(1);
  if (rows.length > 0) return true;
  if (candidates.length < 2) return false;
  const alt = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.userId, userId), eq(patientsTable.patientId, candidates[1]!)))
    .limit(1);
  return alt.length > 0;
}

/** Admin reads are platform-scoped (same exception records.ts makes). */
function isAdminSession(req: Request): boolean {
  return req.session?.canAdminAccess === true;
}

/**
 * Authorise a read of `objectKey` from the configured bucket. Returns `null`
 * when access is allowed, or the response to send when it is not.
 */
async function denyObjectRead(
  req: Request,
  bucket: string,
  objectKey: string,
): Promise<{ status: number; error: string } | null> {
  const userId = req.session?.userId ?? 0;

  // Gate 1 — explicit ACL policy on the object.
  try {
    const allowed = await canAccessObject({
      userId: String(userId),
      objectFile: { bucketName: bucket, key: objectKey },
      requestedPermission: ObjectPermission.READ,
    });
    if (allowed) return null;
  } catch (err) {
    // A broken ACL lookup must fail closed, never open.
    logger.warn({ err, objectKey }, "Object ACL check failed — denying");
    return { status: 403, error: "Access to this object is forbidden" };
  }

  // Gate 2 — the patient the key belongs to must be the caller's.
  const patientId = patientIdFromObjectKey(objectKey);
  if (!patientId) return null; // unattributable key: prefix-allowlist only
  if (isAdminSession(req)) return null;
  if (await callerOwnsPatientId(req, patientId)) return null;

  return { status: 403, error: "Access to this object is forbidden" };
}

/**
 * Ownership predicate for the per-patient image routes. Returns `null` when
 * the caller owns the patient, or the 404 to send otherwise (mirrors how
 * routes/patients.ts hides other users' patients).
 */
async function denyPatientImages(
  req: Request,
  rawPatientId: string,
): Promise<{ status: number; error: string } | null> {
  if (isAdminSession(req)) return null;
  if (await callerOwnsPatientId(req, rawPatientId)) return null;
  return { status: 404, error: "Patient not found" };
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

// Session-gated: this is a bucket readiness probe, not a public liveness
// endpoint. (POLICY NOTE: the comment above calls it an "anonymous health
// check", but it has always answered 401 without a session because it sat
// behind the mount-level gate. Left as-is deliberately — see the report.)
router.get("/storage/health", requireAuth, async (_req: Request, res: Response) => {
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

    // Optional patient scoping. The OpenAPI body schema (RequestUploadUrlBody)
    // only carries name/size/contentType, so `patientId` is an additive,
    // optional field: when present the caller must own that patient, and the
    // patient id is baked into the key so the object is attributable on the
    // read path (see denyObjectRead). Without it the key is unattributable.
    const requestedPatientId = (req.body as { patientId?: unknown } | undefined)?.patientId;
    let patientPrefix = "";
    if (typeof requestedPatientId === "string" && requestedPatientId.length > 0) {
      const normalized = requestedPatientId.replace(/^PAT/i, "");
      if (!isSafePatientIdForPrefix(normalized)) {
        res.status(400).json({ error: "Invalid patientId" });
        return;
      }
      const denied = await denyPatientImages(req, normalized);
      if (denied) {
        res.status(denied.status).json({ error: denied.error });
        return;
      }
      patientPrefix = `patient_${normalized}_`;
    }

    const bucket = objectStorageService.getBucket();
    const safeName = sanitizeFilename(name);
    // Object ids must not come from Math.random(): V8's xorshift128+ state is
    // recoverable from consecutive outputs, which makes every previously
    // generated key predictable.
    const objectId = `${Date.now()}-${patientPrefix}${safeName}`;
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

/**
 * RETIRED (2026-10): `GET /api/storage/public-objects/*filePath`.
 *
 * This route had NO authentication of its own. It resolved
 * `searchPublicObject(filePath)` against the whole configured search path
 * (`PUBLIC_OBJECT_SEARCH_PATHS`, historically `/mednexus`) and streamed
 * whatever it found — including `backups/*.sql`, which are unencrypted full
 * `pg_dump` database dumps written by POST /api/admin/backup into the same
 * bucket. Nothing legitimately uses it unauthenticated:
 *
 *   - the current SPA resolves images through
 *     `/api/storage/objects/<key>` (see artifacts/research-data/src/lib/
 *     radiology-images.ts), which is authenticated;
 *   - the only reference left in the repo is the generated OpenAPI client
 *     (lib/api-client-react/src/generated/api.ts), which nothing imports;
 *   - research/src/routes/storage.ts (the legacy Worker) has its own,
 *     separate storage implementation.
 *
 * So the route is guarded (auth + admin) and then answered 410 Gone rather
 * than silently 404-ing, which gives any straggling client a clear,
 * actionable answer and makes the retirement visible in logs. The
 * `searchPublicObject` traversal hardening in lib/objectStorage.ts stays as
 * defence in depth.
 */
router.get(
  "/storage/public-objects/*filePath",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    req.log.warn(
      { filePath: req.params.filePath },
      "Deprecated /storage/public-objects route was called",
    );
    res.status(410).json({
      error:
        "This endpoint was retired. Authenticated radiology images are served from /api/storage/objects/<key>.",
    });
  },
);

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

    // ACL + patient-ownership check. Runs BEFORE any bytes are read from S3,
    // so a denied request never streams the body.
    const denied = await denyObjectRead(req, bucket, objectKey);
    if (denied) {
      req.log.warn(
        { objectKey, userId: req.session?.userId },
        "Denied object read (ACL/ownership)",
      );
      res.status(denied.status).json({ error: denied.error });
      return;
    }

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
    const objectId = `${Date.now()}-${baseName}_${randomUUID()}.${cleanExt}`;
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

  // Writing an image onto a patient record is a PHI write against that
  // patient's data, so the caller must own the patient.
  if (patientId) {
    const denied = await denyPatientImages(req, patientId.replace(/^PAT/i, ""));
    if (denied) {
      res.status(denied.status).json({ error: denied.error });
      return;
    }
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
    const objectId = `${Date.now()}-${baseName}_${randomUUID()}.${ext}`;
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

  // This route used to enumerate the image keys for ANY patient id: any
  // authenticated user could read the object keys (and therefore fetch the
  // images through /storage/objects/*) of every patient in the deployment.
  // Scope it to the caller's own patients, mirroring routes/patients.ts.
  const denied = await denyPatientImages(req, String(patientId));
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
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

  // When the caller names a patient, that patient must be theirs — otherwise
  // this route is an oracle for another user's object keys.
  if (patientId) {
    const denied = await denyPatientImages(req, String(patientId));
    if (denied) {
      res.status(denied.status).json({ error: denied.error });
      return;
    }
  }
  // NOTE: the `identifier`-only path cannot be ownership-checked (it is a
  // free-form key fragment, not a patient id). It is prefix-scoped to
  // `radiology/` and still gated by requireAuth; the object read path
  // (`/storage/objects/*`) re-checks ownership before streaming bytes.

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

router.post("/storage/upload-file", requireAuth, async (req: Request, res: Response) => {
  const limit = rateLimit(`upload-file:${clientIp(req)}`, UPLOAD_FILE_LIMIT, UPLOAD_FILE_WINDOW_MS);
  if (!limit.success) {
    tooManyRequests(res, limit.retryAfterSec);
    return;
  }
  const patientId = req.body?.patientId as string | undefined;

  // Attaching an upload to a patient record is a PHI write against that
  // patient's data: the caller must own it.
  if (typeof patientId === "string" && patientId.length > 0) {
    const denied = await denyPatientImages(req, patientId.replace(/^PAT/i, ""));
    if (denied) {
      res.status(denied.status).json({ error: denied.error });
      return;
    }
  }

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
    const objectId = `${Date.now()}-${baseName}_${randomUUID()}.${ext}`;
    const objectKey = `radiology/${objectId}`;
    
    const buffer = Buffer.from(fileData, 'base64');
    
    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType || 'image/jpeg',
    }));
    
    // `objectUrl` must be the AUTHENTICATED read path. It used to point at
    // `/api/storage/public-objects/<key>`, a route that had no auth middleware
    // at all and is now retired (410 Gone), so every caller that trusted this
    // field received a dead link. Clients must fetch objects through
    // `/api/storage/objects/<key>` with their session cookie, or via a
    // presigned GET from `/api/storage/presigned-url`.
    const result: Record<string, any> = {
        objectPath: objectKey,
        objectUrl: `/api/storage/objects/${objectKey}`,
    };
    
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