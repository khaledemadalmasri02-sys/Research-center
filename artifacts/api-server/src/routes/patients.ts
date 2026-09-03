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
import { radiologyImageService } from "../lib/radiologyImages";
import { PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { writeAudit, clientIp } from "../lib/audit";

// ---- SSRF guard (shared, see lib/ssrf.ts) -----------------------------------
import { safeFetch } from "../lib/ssrf";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

async function discoverImagesByPatientId(patientId: string | undefined): Promise<string[]> {
  if (!patientId) return [];
  const bucket = objectStorageService.getBucket();
  
  const allKeys: string[] = [];
  const normalizedId = patientId.replace(/^PAT/, '');
  
  try {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `radiology/`,
    }));
    
    for (const obj of response.Contents ?? []) {
      if (!obj.Key) continue;
      
      const hasPatPrefix = obj.Key.includes(`patient_${patientId}_`) || obj.Key.includes(`patient_PAT${normalizedId}_`);
      const hasNumericOnly = obj.Key.includes(`patient_${normalizedId}_`);
      
      if (hasPatPrefix || hasNumericOnly || obj.Key.includes(`patient_${normalizedId}.`)) {
        if (!allKeys.includes(obj.Key)) {
          allKeys.push(obj.Key);
        }
      }
      
      const timestampMatch = obj.Key.match(new RegExp(`-patient_([^_]+)`, 'i'));
      if (timestampMatch?.[1]) {
        const filePatientId = timestampMatch[1];
        if (filePatientId === patientId || filePatientId === normalizedId) {
          if (!allKeys.includes(obj.Key)) {
            allKeys.push(obj.Key);
          }
        }
      }
    }
    
    return allKeys;
  } catch {
    return [];
  }
}

async function serializePatientWithImages<T extends { createdAt: Date | string; updatedAt: Date | string; patientId?: string; radiologyImageFilePathOrLink?: string | null; radiologyImages?: string | null }>(p: T): Promise<any> {
  const base = {
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };

  if ((!base.radiologyImageFilePathOrLink || !base.radiologyImages) && base.patientId) {
    const discoveredImages = await discoverImagesByPatientId(base.patientId);
    if (discoveredImages.length > 0) {
      if (!base.radiologyImageFilePathOrLink) {
        (base as any).radiologyImageFilePathOrLink = discoveredImages[0];
      }
      if (!base.radiologyImages) {
        (base as any).radiologyImages = JSON.stringify(discoveredImages);
      }
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

async function discoverImagesByImageId(imageId: string): Promise<string[]> {
  if (!imageId) return [];
  const bucket = objectStorageService.getBucket();
  
  const allKeys: string[] = [];
  
  try {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `radiology/`,
    }));
    
    for (const obj of response.Contents ?? []) {
      if (obj.Key && obj.Key.includes(`patient_${imageId}_`)) {
        allKeys.push(obj.Key);
      }
    }
    
    return allKeys;
  } catch {
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

router.get("/patients", async (req, res): Promise<void> => {
  const parsed = ListPatientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientsTable)
    .where(eq(patientsTable.userId, req.session?.userId ?? 0))
    .then((r) => r[0]?.count ?? 0);

  res.json(ListPatientsResponse.parse({ patients: await Promise.all(patients.map(serializePatientWithImages)), total }));
});

router.post("/patients", async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid request body");
    res.status(400).json({ error: parsed.error.message });
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

router.get("/patients/stats", async (req, res): Promise<void> => {
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

router.get("/patients/:id", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  if ((!patient.radiologyImageFilePathOrLink || !patient.radiologyImages) && patient.patientId) {
    const discoveredImages = await discoverImagesByPatientId(patient.patientId);
    if (discoveredImages.length > 0) {
      const updateData: Record<string, any> = {};
      if (!patient.radiologyImageFilePathOrLink) {
        updateData.radiologyImageFilePathOrLink = discoveredImages[0];
      }
      if (!patient.radiologyImages) {
        updateData.radiologyImages = JSON.stringify(discoveredImages);
      }
      if (Object.keys(updateData).length > 0) {
        await db
          .update(patientsTable)
          .set(updateData)
          .where(eq(patientsTable.id, params.data.id));
      }
    }
  }

  const [updatedPatient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, params.data.id));

  res.json(GetPatientResponse.parse(await serializePatientWithImages(updatedPatient!)));
});

router.get("/patients/:id/images", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

router.post("/patients/:id/images", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  const { imageId, objectKeys, objectKey, studyId } = req.body as {
    imageId?: string;
    objectKeys?: string[];
    objectKey?: string;
    studyId?: string;
  };

  let keys: string[] = [];
  if (Array.isArray(objectKeys) && objectKeys.length > 0) {
    keys = objectKeys.map((k) => String(k));
  } else if (typeof objectKey === "string" && objectKey) {
    keys = [objectKey];
  } else if (typeof imageId === "string" && imageId) {
    keys = await discoverImagesByPatientId(imageId);
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
    .where(eq(patientsTable.id, params.data.id));

  res.json({
    ...GetPatientResponse.parse(await serializePatientWithImages(updatedPatient!)),
    images,
  });
});

router.delete("/patients/:id/images/:imageId", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId)) {
    res.status(400).json({ error: "Invalid image id" });
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

  const deleteObject =
    req.query.deleteObject === "true" || (req.body as { deleteObject?: boolean })?.deleteObject === true;

  await radiologyImageService.removeImage(imageId, { deleteObject });

  const images = await radiologyImageService.listImages(patient.id);

  const [updatedPatient] = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.id, params.data.id));

  res.json({
    ...GetPatientResponse.parse(await serializePatientWithImages(updatedPatient!)),
    images,
  });
});

router.patch("/patients/:id", async (req, res): Promise<void> => {
  const params = UpdatePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePatientBody.safeParse(preprocess(req.body));
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid update body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, any> = Object.fromEntries(
    Object.entries(sanitize(parsed.data as Record<string, unknown>)).filter(([, v]) => v !== null)
  );
  // Never allow the owner (userId) to be changed via an update payload.
  delete updateData.userId;

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

router.post("/patients/batch-import-images", async (req: Request, res: Response): Promise<void> => {
  const { patientId, imageUrls } = req.body as { patientId?: string; imageUrls?: string[] };
  
  if (!patientId || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    res.status(400).json({ error: "patientId and imageUrls are required" });
    return;
  }

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

router.delete("/patients/:id", async (req, res: Response): Promise<void> => {
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

interface BatchPatientImportData {
  patients: Record<string, unknown>[];
}

router.post("/patients/batch", async (req: Request, res: Response): Promise<void> => {
  const { patients } = req.body as BatchPatientImportData;
  
  if (!Array.isArray(patients) || patients.length === 0) {
    res.status(400).json({ error: "patients array is required" });
    return;
  }

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
          const existing = await discoverImagesByPatientId(processed.patientId as string);
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
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
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
