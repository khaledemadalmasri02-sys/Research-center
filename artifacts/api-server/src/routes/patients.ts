import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import { db, patientsTable } from "@workspace/db";
import {
  ListPatientsQueryParams,
  ListPatientsResponse,
  CreatePatientBody,
  GetPatientParams,
  GetPatientResponse,
  UpdatePatientParams,
  UpdatePatientBody,
  UpdatePatientResponse,
  DeletePatientParams,
  GetPatientStatsResponse,
} from "@workspace/api-zod";
import { s3Client, ObjectStorageService } from "../lib/objectStorage";
// Reuse the storage router's guarded S3 helpers instead of re-implementing
// them: `isSafePatientIdForPrefix` blocks prefix injection,
// `listAllObjectsUnderPrefix` paginates with a ContinuationToken (no silent
// 1000-key truncation), and `radiologyPatientPrefix` keeps one canonical
// per-patient prefix.
import {
  discoverImagesByPatientId,
  isSafePatientIdForPrefix,
  listAllObjectsUnderPrefix,
  radiologyPatientPrefix,
} from "./storage";
import { radiologyImageService } from "../lib/radiologyImages";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { writeAudit, clientIp } from "../lib/audit";
import { logger } from "../lib/logger";
import { requireEdit } from "../middlewares/requireEdit";
import { requireAdmin } from "../middlewares/requireAdmin";
// Every route in this file is session-gated explicitly. `requireAuth` runs
// BEFORE `requireEdit`/`requireAdmin` so an unauthenticated caller still gets
// 401 (not the 403 those two would produce on their own).
import { requireAuth } from "./auth";

// ---- SSRF guard (shared, see lib/ssrf.ts) -----------------------------------
import { safeFetch } from "../lib/ssrf";
import { validate, validationErrorBody, z } from "../lib/validate";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// How many prefix-scoped S3 LISTs may be in flight at once during a batch
// discovery. `GET /api/patients` returns up to 100 patients; without a cap a
// single request used to fire 100 concurrent full-prefix LISTs.
const DISCOVERY_CONCURRENCY = 8;

/**
 * Keys written by the upload/import paths look like
 * `radiology/<timestamp>-patient_<id>_<uuid>.<ext>` — the patient id is an
 * infix there, so it cannot be reached with an S3 prefix filter. That legacy
 * layout is why one shared full-prefix listing still exists below; the
 * canonical `radiology/patient_<id>/...` form IS prefix-scoped.
 */
function patientIdFromKey(key: string): string | null {
  const m = /(?:^|[/_-])patient_(\d+)(?:[/_.-]|$)/i.exec(key);
  return m ? m[1]! : null;
}

/**
 * Discover image keys for many patients with ONE hoisted listing pass.
 *
 * The previous implementation listed the ENTIRE `radiology/` prefix once per
 * patient from inside the response serializer, with no ContinuationToken: a
 * `GET /api/patients` with limit=100 fired 100 concurrent full-prefix LISTs
 * and silently dropped every key past the first 1000.
 *
 * Now:
 *   - one shared, paginated `radiology/` listing indexes the legacy
 *     `<ts>-patient_<id>_...` keys, at most once per request,
 *   - one prefix-scoped listing per patient covers the canonical
 *     `radiology/patient_<id>/...` layout, with bounded concurrency.
 *
 * S3 errors are caught per patient (logged, treated as "no images") so a
 * storage outage degrades the list response instead of failing it entirely.
 */
async function discoverImagesForPatients(
  patientIds: Array<string | null | undefined>,
): Promise<Map<string, string[]>> {
  const ids = Array.from(
    new Set(
      patientIds
        .map((id) => (typeof id === "string" ? id.replace(/^PAT/i, "") : ""))
        .filter((id) => id.length > 0 && isSafePatientIdForPrefix(id)),
    ),
  );
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);

  if (ids.length === 0) return out;

  let bucket: string;
  try {
    bucket = objectStorageService.getBucket();
  } catch {
    return out;
  }

  // 1. Shared legacy-layout pass: one listing for the whole request.
  try {
    for (const key of await listAllObjectsUnderPrefix(bucket, "radiology/")) {
      const id = patientIdFromKey(key);
      if (!id) continue;
      const forId = out.get(id);
      if (!forId) continue;
      if (!key.startsWith(`${radiologyPatientPrefix(id)}_`)) forId.push(key);
    }
  } catch (err) {
    logger.warn({ err }, "patients: legacy image discovery listing failed");
  }

  // 2. Canonical per-patient prefix pass, bounded concurrency.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      const id = ids[index]!;
      try {
        const forId = out.get(id)!;
        for (const key of await discoverImagesByPatientId(id)) {
          if (!forId.includes(key)) forId.push(key);
        }
      } catch (err) {
        logger.warn({ err, patientId: id }, "patients: image discovery failed");
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, ids.length) }, () => worker()),
  );

  return out;
}

/**
 * Pure response shaper: no I/O, no writes. Image discovery is hoisted into
 * the route handlers and passed in as `discoveredImages`.
 */
async function serializePatientWithImages<T extends { createdAt: Date | string; updatedAt: Date | string; patientId?: string; radiologyImageFilePathOrLink?: string | null; radiologyImages?: string | null }>(p: T, discoveredImages?: string[]): Promise<any> {
  const base = {
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };

  if (discoveredImages && discoveredImages.length > 0 && base.patientId && (!base.radiologyImageFilePathOrLink || !base.radiologyImages)) {
    if (!base.radiologyImageFilePathOrLink) {
      (base as any).radiologyImageFilePathOrLink = discoveredImages[0];
    }
    if (!base.radiologyImages) {
      (base as any).radiologyImages = JSON.stringify(discoveredImages);
    }
  }

  return base;
}

const VALID_COLLECTION_TYPES = new Set(["Normal", "Abnormal", "Suspicious"]);
const VALID_SEX              = new Set(["Male", "Female", "Other"]);

/** Normalise the raw request body BEFORE Zod validation so that type
 *  mismatches (e.g. radiologyImages sent as a real array) don't cause a 400. */
function preprocess(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };

  // radiologyImages: accept a real JSON array and convert to a JSON-encoded string
  if (Array.isArray(out.radiologyImages)) {
    out.radiologyImages = JSON.stringify(out.radiologyImages);
  }

  // Sync radiologyImageFilePathOrLink from radiologyImages if absent
  if (!out.radiologyImageFilePathOrLink && out.radiologyImages && typeof out.radiologyImages === "string") {
    try {
      const paths = JSON.parse(out.radiologyImages);
      if (Array.isArray(paths) && paths[0]) {
        out.radiologyImageFilePathOrLink = String(paths[0]);
      }
    } catch {
      // radiologyImages is a plain path string — treat it as the link too
      if (!out.radiologyImageFilePathOrLink) {
        out.radiologyImageFilePathOrLink = out.radiologyImages;
      }
    }
  }

  return out;
}

/**
 * Prefix-scoped discovery for a caller-supplied id that may be free-form
 * (e.g. "B-1" from a spreadsheet import, or a "PAT42" spelling).
 *
 * `discoverImagesByPatientId` throws for anything that is not digit-only,
 * because a non-numeric id cannot be turned into a safe S3 prefix. Batch
 * imports must not fail wholesale because of that, so an unsafe id simply has
 * no discoverable images and S3 errors degrade to "no images" with a warning.
 */
async function discoverImagesForFreeFormId(rawId: string | undefined): Promise<string[]> {
  if (!rawId) return [];
  const id = rawId.replace(/^PAT/i, "");
  if (!isSafePatientIdForPrefix(id)) return [];
  try {
    return await discoverImagesByPatientId(id);
  } catch (err) {
    logger.warn({ err, patientId: rawId }, "patients: image discovery failed");
    return [];
  }
}

/**
 * Legacy helper: keys matching `patient_<imageId>_` anywhere under
 * `radiology/`. Kept for the batch-import path, which passes a free-form
 * `imageId`. Uses the shared paginated helper (no silent 1000-key
 * truncation) and filters locally, because the id is an infix in the legacy
 * key layout and therefore not prefix-addressable.
 */
async function discoverImagesByImageId(imageId: string): Promise<string[]> {
  if (!imageId || !isSafePatientIdForPrefix(imageId)) return [];
  const bucket = objectStorageService.getBucket();
  const marker = `patient_${imageId}_`;
  try {
    return (await listAllObjectsUnderPrefix(bucket, "radiology/")).filter((key) =>
      key.includes(marker),
    );
  } catch (err) {
    logger.warn({ err, imageId }, "patients: imageId discovery failed");
    return [];
  }
}


/** Coerce/sanitise patient data so type mismatches from Excel imports never
 *  reach the DB.  Any field that can't be coerced is dropped (set to null). */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  // age must be a non-negative integer
  if (out.age != null) {
    const n = Number(out.age);
    out.age = !isNaN(n) && n >= 0 ? Math.round(n) : null;
  }

  // collectionType must be one of the three enum values
  if (out.collectionType != null && !VALID_COLLECTION_TYPES.has(out.collectionType as string)) {
    out.collectionType = null;
  }

  // sex must be one of the three enum values
  if (out.sex != null && !VALID_SEX.has(out.sex as string)) {
    out.sex = null;
  }

  // date fields: store only valid ISO date strings; drop garbage
  for (const f of ["collectionDate", "dateOfVisit"] as const) {
    const v = out[f];
    if (v != null && v !== "") {
      try {
        const d = new Date(v as string);
        if (isNaN(d.getTime())) out[f] = null;
      } catch {
        out[f] = null;
      }
    }
  }

  return out;
}

const AddImagesBody = z
  .object({
    imageId: z.string().min(1).max(64).optional(),
    objectKey: z.string().min(1).max(512).optional(),
    objectKeys: z.array(z.string().min(1).max(512)).max(50).optional(),
    studyId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine(
    (v) => Boolean(v.imageId) || Boolean(v.objectKey) || (Array.isArray(v.objectKeys) && v.objectKeys.length > 0),
    { message: "imageId, objectKey, or objectKeys is required" },
  );

const DeleteImageParams = z.object({
  id: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
});

const DeleteImageQuery = z
  .object({
    deleteObject: z
      .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
      .optional(),
  });

const DeleteImageBody = z
  .object({
    deleteObject: z.boolean().optional(),
  })
  .optional();

const BatchImportImagesBody = z.object({
  patientId: z.string().min(1).max(64),
  imageUrls: z.array(z.string().url().max(2048)).min(1).max(50),
});

const BatchImportBody = z.object({
  patients: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
});

router.get("/patients", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListPatientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(validationErrorBody(parsed.error, "query"));
    return;
  }

  const { search, sex, collectionType, limit = 100, offset = 0 } = parsed.data;

  // Patients are private: each user only sees the ones they own.
  const conditions = [eq(patientsTable.userId, req.session?.userId ?? 0)];

  if (search) {
    conditions.push(
      or(
        ilike(patientsTable.patientId, `%${search}%`),
        ilike(patientsTable.patientName, `%${search}%`),
        ilike(patientsTable.chiefComplaint, `%${search}%`),
        ilike(patientsTable.provisionalDiagnosis, `%${search}%`),
        ilike(patientsTable.finalConfirmedDiagnosis, `%${search}%`)
      )!
    );
  }
  if (sex) conditions.push(eq(patientsTable.sex, sex));
  if (collectionType) conditions.push(eq(patientsTable.collectionType, collectionType));

  const patients = await db
    .select()
    .from(patientsTable)
    .where(and(...conditions))
    .orderBy(desc(patientsTable.createdAt))
    .limit(limit ?? 100)
    .offset(offset ?? 0);

  // The count must use the SAME conditions as the page query, otherwise
  // `total` counts the caller's whole patient book while `patients` holds a
  // filtered page — which breaks pagination for every filtered request
  // (and made `GET /api/patients?search=X` report the unfiltered total).
  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientsTable)
    .where(and(...conditions))
    .then((r) => r[0]?.count ?? 0);

  // Hoisted image discovery: ONE batched pass for the whole page instead of
  // a full-prefix S3 LIST per patient inside the serializer.
  const discovered = await discoverImagesForPatients(patients.map((p) => p.patientId));
  const serialized = await Promise.all(
    patients.map((p) =>
      serializePatientWithImages(
        p,
        p.patientId ? discovered.get(p.patientId.replace(/^PAT/i, "")) : undefined,
      ),
    ),
  );

  res.json(ListPatientsResponse.parse({ patients: serialized, total }));
});

router.post("/patients", requireAuth, requireEdit, async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid request body");
    res.status(400).json(validationErrorBody(parsed.error, "body"));
    return;
  }

  const [patient] = await db
    .insert(patientsTable)
    .values({ ...(sanitize(parsed.data as Record<string, unknown>) as Record<string, unknown>), userId: req.session?.userId ?? 0 } as any)
    .returning();

  await writeAudit({
    userId: req.session?.userId ?? null,
    action: "patient.create",
    entityId: patient!.id,
    detail: { patientId: patient!.patientId },
    ip: clientIp(req),
  });

  res.status(201).json(GetPatientResponse.parse(await serializePatientWithImages(patient!)));
});

router.get("/patients/stats", requireAuth, async (req, res): Promise<void> => {
  // Patients are private: stats reflect only the current user's patients.
  const allPatients: any[] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.userId, req.session?.userId ?? 0));

  const total = allPatients.length;
  const maleCount = allPatients.filter((p) => p.sex === "Male").length;
  const femaleCount = allPatients.filter((p) => p.sex === "Female").length;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCount = allPatients.filter(
    (p) => new Date(p.createdAt) > thirtyDaysAgo
  ).length;

  const diagnosisMap = new Map<string, number>();
  for (const p of allPatients) {
    const diag = p.finalConfirmedDiagnosis || p.provisionalDiagnosis;
    if (diag) {
      diagnosisMap.set(diag, (diagnosisMap.get(diag) ?? 0) + 1);
    }
  }

  const diagnosisCounts = Array.from(diagnosisMap.entries())
    .map(([diagnosis, count]) => ({ diagnosis, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const ageBrackets: { bracket: string; count: number }[] = [
    { bracket: "0-17", count: 0 },
    { bracket: "18-29", count: 0 },
    { bracket: "30-44", count: 0 },
    { bracket: "45-59", count: 0 },
    { bracket: "60-74", count: 0 },
    { bracket: "75+", count: 0 },
  ];

  for (const p of allPatients) {
    if (p.age != null) {
      if (p.age <= 17) ageBrackets[0]!.count++;
      else if (p.age <= 29) ageBrackets[1]!.count++;
      else if (p.age <= 44) ageBrackets[2]!.count++;
      else if (p.age <= 59) ageBrackets[3]!.count++;
      else if (p.age <= 74) ageBrackets[4]!.count++;
      else ageBrackets[5]!.count++;
    }
  }

  const collectionTypeMap = new Map<string, number>();
  for (const p of allPatients) {
    const t = p.collectionType ?? "Unspecified";
    collectionTypeMap.set(t, (collectionTypeMap.get(t) ?? 0) + 1);
  }
  const collectionTypeCounts = Array.from(collectionTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  res.json(
    GetPatientStatsResponse.parse({
      total,
      maleCount,
      femaleCount,
      recentCount,
      diagnosisCounts,
      ageBrackets,
      collectionTypeCounts,
    })
  );
});

router.get("/patients/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(validationErrorBody(params.error, "params"));
    return;
  }

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, params.data.id), eq(patientsTable.userId, req.session?.userId ?? 0)));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  // A11: this GET used to run an `UPDATE patients SET radiologyImage...`
  // whenever the image columns were empty, i.e. a read request wrote to the
  // PHI table (twice over: the UPDATE plus a second SELECT). It is now a
  // pure read. Legacy rows whose image columns were never populated are
  // persisted by the explicit admin-only migration endpoint below
  // (`POST /api/admin/patients/backfill-images`).
  const discoveredImages =
    patient.patientId && (!patient.radiologyImageFilePathOrLink || !patient.radiologyImages)
      ? (await discoverImagesForPatients([patient.patientId])).get(
          patient.patientId.replace(/^PAT/i, ""),
        )
      : undefined;

  res.json(
    GetPatientResponse.parse(
      await serializePatientWithImages(patient, discoveredImages),
    ),
  );
});

/**
 * A11: the backfill that used to happen inside `GET /api/patients/:id`,
 * promoted to an explicit, admin-only, auditable migration endpoint.
 *
 * Discovers S3 image keys for patients whose `radiology_images` /
 * `radiology_image_file_path_or_link` columns are empty and persists them.
 * Requires admin (an operator action that rewrites rows for every user), is
 * rate-limited implicitly by requireAdmin, and writes an audit entry per run.
 */
router.post(
  "/admin/patients/backfill-images",
  requireAuth,
  requireAdmin,
  requireEdit,
  async (req: Request, res: Response): Promise<void> => {
    const patients = await db
      .select({
        id: patientsTable.id,
        patientId: patientsTable.patientId,
        radiologyImages: patientsTable.radiologyImages,
        radiologyImageFilePathOrLink: patientsTable.radiologyImageFilePathOrLink,
      })
      .from(patientsTable)
      .where(
        sql`("radiology_images" IS NULL OR "radiology_images" = '') OR ("radiology_image_file_path_or_link" IS NULL OR "radiology_image_file_path_or_link" = '')`,
      )
      .limit(500);

    const discovered = await discoverImagesForPatients(
      patients.map((p) => p.patientId),
    );

    let updated = 0;
    for (const p of patients) {
      const keys = discovered.get(p.patientId.replace(/^PAT/i, "")) ?? [];
      if (keys.length === 0) continue;
      const updateData: Record<string, unknown> = {};
      if (!p.radiologyImageFilePathOrLink) updateData.radiologyImageFilePathOrLink = keys[0];
      if (!p.radiologyImages) updateData.radiologyImages = JSON.stringify(keys);
      if (Object.keys(updateData).length === 0) continue;
      await db
        .update(patientsTable)
        .set(updateData)
        .where(eq(patientsTable.id, p.id));
      updated++;
    }

    await writeAudit({
      userId: req.session?.userId ?? null,
      action: "patient.backfill_images",
      detail: { scanned: patients.length, updated },
      ip: clientIp(req),
    });

    res.json({ scanned: patients.length, updated });
  },
);

router.get("/patients/:id/images", requireAuth, async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(validationErrorBody(params.error, "params"));
    return;
  }

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, params.data.id), eq(patientsTable.userId, req.session?.userId ?? 0)));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const images = await radiologyImageService.listImages(patient.id);
  res.json({ patientId: patient.patientId, images });
});

router.post("/patients/:id/images", requireAuth, requireEdit, validate({ params: GetPatientParams, body: AddImagesBody }), async (req, res): Promise<void> => {
  const params = GetPatientParams.parse(req.params);
  const body = req.validated?.body as z.infer<typeof AddImagesBody>;

  const [patient] = await db
    .select()
    .from(patientsTable)
    .where(and(eq(patientsTable.id, params.id), eq(patientsTable.userId, req.session?.userId ?? 0)));

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const { imageId, objectKeys, objectKey, studyId } = body;

  let keys: string[] = [];
  if (Array.isArray(objectKeys) && objectKeys.length > 0) {
    keys = objectKeys.map((k) => String(k));
  } else if (typeof objectKey === "string" && objectKey) {
    keys = [objectKey];
  } else if (typeof imageId === "string" && imageId) {
    keys = await discoverImagesForFreeFormId(imageId);
  }

  if (keys.length === 0) {
    res.status(400).json({ error: "imageId or objectKey(s) is required" });
    return;
  }

  for (const key of keys) {
    await radiologyImageService.addImage(patient.id, { objectKey: key, studyId: studyId ?? null });
  }

  const images = await radiologyImageService.listImages(patient.id);

  const [updatedPatient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, params.id));

  // Hoisted, one batched pass for this single patient (no S3 LIST inside the
  // serializer).
  const discovered = await discoverImagesForPatients([updatedPatient!.patientId]);
  res.json({
    ...GetPatientResponse.parse(
      await serializePatientWithImages(
        updatedPatient!,
        discovered.get(updatedPatient!.patientId.replace(/^PAT/i, "")),
      ),
    ),
    images,
  });
});

router.delete(
  "/patients/:id/images/:imageId",
  requireAuth,
  requireEdit,
  validate({ params: DeleteImageParams, query: DeleteImageQuery, body: DeleteImageBody }),
  async (req, res): Promise<void> => {
    const params = DeleteImageParams.parse(req.params);
    const deleteObject =
      req.query.deleteObject === "true" ||
      req.query.deleteObject === "1" ||
      (req.validated?.body as { deleteObject?: boolean } | undefined)?.deleteObject === true;

    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(and(eq(patientsTable.id, params.id), eq(patientsTable.userId, req.session?.userId ?? 0)));

    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await radiologyImageService.removeImage(params.imageId, { deleteObject });

    const images = await radiologyImageService.listImages(patient.id);

    const [updatedPatient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, params.id));

    const discovered = await discoverImagesForPatients([updatedPatient!.patientId]);
    res.json({
      ...GetPatientResponse.parse(
        await serializePatientWithImages(
          updatedPatient!,
          discovered.get(updatedPatient!.patientId.replace(/^PAT/i, "")),
        ),
      ),
      images,
    });
  },
);

router.patch("/patients/:id", requireAuth, requireEdit, async (req, res): Promise<void> => {
  const params = UpdatePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(validationErrorBody(params.error, "params"));
    return;
  }

  const parsed = UpdatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.issues }, "Invalid update body");
    res.status(400).json(
      validationErrorBody(
        parsed.error,
        "body",
        parsed.error.issues[0]?.message ?? "No updatable fields in request body.",
      ),
    );
    return;
  }

  const updateData: Record<string, any> = Object.fromEntries(
    Object.entries(sanitize(parsed.data as Record<string, unknown>)).filter(([, v]) => v !== null)
  );
  // Never allow the owner (userId) to be changed via an update payload.
  delete updateData.userId;

  // A payload whose every field was dropped by sanitisation (e.g. `{}`, or
  // only nulls) leaves nothing to write. drizzle throws "No values to set" in
  // that case, which surfaced as a 500 on client input.
  if (Object.keys(updateData).length === 0) {
    res.status(400).json(
      validationErrorBody(
        { issues: [{ path: [], message: "No updatable fields in request body." }] },
        "body",
        "No updatable fields in request body.",
      ),
    );
    return;
  }

  const [patient] = await db
    .update(patientsTable)
    .set(updateData)
    .where(and(eq(patientsTable.id, params.data.id), eq(patientsTable.userId, req.session?.userId ?? 0)))
    .returning();

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  await writeAudit({
    userId: req.session?.userId ?? null,
    action: "patient.update",
    entityId: patient.id,
    detail: { patientId: patient.patientId },
    ip: clientIp(req),
  });

  res.json(UpdatePatientResponse.parse(await serializePatientWithImages(patient)));
});

router.post(
  "/patients/batch-import-images",
  requireAuth,
  requireEdit,
  validate({ body: BatchImportImagesBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { patientId, imageUrls } = req.validated!.body as z.infer<typeof BatchImportImagesBody>;

    try {
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(and(eq(patientsTable.patientId, patientId), eq(patientsTable.userId, req.session?.userId ?? 0)));

    if (!patient) {
      res.status(404).json({ error: `Patient with ID ${patientId} not found` });
      return;
    }

    const uploadedPaths: string[] = [];
    const failed: string[] = [];

    for (const url of imageUrls) {
      if (!isImageUrl(url)) {
        failed.push(`${url}: not a valid image URL`);
        continue;
      }

      const newPath = await fetchAndUploadImage(url, patientId, patient.patientName || "Unknown");
      if (newPath) {
        uploadedPaths.push(newPath);
      } else {
        failed.push(url);
      }
    }

    if (uploadedPaths.length > 0) {
      const updateData: Record<string, any> = {
        radiologyImages: JSON.stringify([...(patient.radiologyImages ? JSON.parse(patient.radiologyImages) : []), ...uploadedPaths]),
        updatedAt: new Date(),
      };
      
      if (!patient.radiologyImageFilePathOrLink && uploadedPaths.length > 0) {
        updateData.radiologyImageFilePathOrLink = uploadedPaths[0];
      }
      
      const [updatedPatient] = await db
        .update(patientsTable)
        .set(updateData)
        .where(eq(patientsTable.id, patient.id))
        .returning();

      res.json({
        uploaded: uploadedPaths.length,
        failed: failed.length,
        failedUrls: failed,
        patient: GetPatientResponse.parse(await serializePatientWithImages(updatedPatient!)),
      });
    } else {
      res.json({ uploaded: 0, failed: failed.length, failedUrls: failed });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/patients/:id", requireAuth, requireEdit, async (req, res: Response): Promise<void> => {
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(validationErrorBody(params.error, "params"));
    return;
  }

  const [patient] = await db
    .delete(patientsTable)
    .where(and(eq(patientsTable.id, params.data.id), eq(patientsTable.userId, req.session?.userId ?? 0)))
    .returning();

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  await writeAudit({
    userId: req.session?.userId ?? null,
    action: "patient.delete",
    entityId: patient.id,
    detail: { patientId: patient.patientId },
    ip: clientIp(req),
  });

  res.sendStatus(204);
});

function isImageUrl(path: string): boolean {
  if (!path) return false;
  const trimmed = path.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
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

router.post(
  "/patients/batch",
  requireAuth,
  requireEdit,
  validate({ body: BatchImportBody }),
  async (req: Request, res: Response): Promise<void> => {
    const { patients } = req.validated!.body as z.infer<typeof BatchImportBody>;

    const results: { id?: number; errors?: string[]; updatedImagePaths?: string[] }[] = [];
    const batchSize = 5;
  
  for (let i = 0; i < patients.length; i += batchSize) {
    const batch = patients.slice(i, i + batchSize);
    
    for (const rawPatient of batch) {
      const result: { id?: number; errors?: string[]; updatedImagePaths?: string[] } = {};
      
      try {
        const processed = preprocess(rawPatient);
        const updatedPaths: string[] = [];
        
        if (isImageUrl(processed.radiologyImageFilePathOrLink as string)) {
          const newPath = await fetchAndUploadImage(processed.radiologyImageFilePathOrLink as string, processed.patientId as string, processed.patientName as string);
          if (newPath) {
            processed.radiologyImageFilePathOrLink = newPath;
            updatedPaths.push(newPath);
          }
        } else if (processed.patientId && !processed.radiologyImageFilePathOrLink) {
          const existing = await discoverImagesForFreeFormId(processed.patientId as string);
          if (existing.length > 0) {
            processed.radiologyImageFilePathOrLink = existing[0];
            updatedPaths.push(...existing);
          }
        }
        
        if (!processed.radiologyImageFilePathOrLink && processed.imageId) {
          const existing = await discoverImagesByImageId(processed.imageId as string);
          if (existing.length > 0) {
            processed.radiologyImageFilePathOrLink = existing[0];
            updatedPaths.push(...existing);
          }
        }
        
        if (processed.radiologyImages) {
          try {
            const paths = JSON.parse(processed.radiologyImages as string);
            if (Array.isArray(paths)) {
              const newPaths: string[] = [];
              for (const path of paths) {
                if (isImageUrl(path)) {
                  const newPath = await fetchAndUploadImage(path, processed.patientId as string, processed.patientName as string);
                  if (newPath) {
                    newPaths.push(newPath);
                    updatedPaths.push(newPath);
                  } else {
                    newPaths.push(path);
                  }
                } else {
                  newPaths.push(path);
                }
              }
              processed.radiologyImages = JSON.stringify(newPaths);
            }
          } catch {
          }
        }
        
        const parsed = CreatePatientBody.safeParse(processed);
        if (!parsed.success) {
          result.errors = [parsed.error.message];
        } else {
          // Drizzle's InsertType requires non-null `patientId`, but
          // the inferred type from zod is a Partial in some code
          // paths. z.infer gives us the narrowed type.
          type CreatePatientInput = {
            patientId: string;
            patientName: string;
            [k: string]: unknown;
          };
          const data = parsed.data as unknown as CreatePatientInput;
          const [patient] = await db
            .insert(patientsTable)
            .values({
              ...data,
              userId: req.session?.userId ?? null,
            })
            .returning();
          result.id = patient!.id;
          if (updatedPaths.length > 0) {
            result.updatedImagePaths = updatedPaths;
          }
        }
      } catch (err) {
        result.errors = [(err as Error).message];
      }
      
      results.push(result);
    }
  }

  res.json({
    results,
    processed: results.filter(r => r.id).length,
    failed: results.filter(r => r.errors).length,
  });
});

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB cap
const FETCH_TIMEOUT_MS = 15_000;
// Only these image MIME types are accepted; SVG/XML are rejected to prevent XSS.
const ALLOWED_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

async function fetchAndUploadImage(url: string, patientId: string | undefined, patientName: string | undefined): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // SSRF guard: never fetch from private/loopback addresses, and disable
  // redirects (a redirect could pivot to an internal address).
  try {
    const response = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_IMAGE_BYTES,
      allowedContentTypes: ["image/"],
      blockedHostnames: [parsed.hostname],
    });

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    // Reject scriptable image types (SVG/XML) to prevent stored XSS.
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(contentType.toLowerCase())) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;
    const body = new Uint8Array(arrayBuffer);

    const ext = guessExtension(url, contentType);
    const baseName = patientId ? `patient_${patientId}` : "imported";
    const objectId = `${Date.now()}-${baseName}_${randomUUID()}.${ext}`;
    const objectKey = `radiology/${objectId}`;

    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    return objectKey;
  } catch {
    return null;
  }
}

export default router;
