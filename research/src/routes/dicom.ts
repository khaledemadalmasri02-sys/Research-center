import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, isAdmin, writeAudit } from "../lib/security";

// DICOM tags that carry direct PHI and must be stripped when de-identifying an
// image's metadata. Keyed by common DICOM keyword (the data dictionary tag is
// also accepted, e.g. "0010,0010").
export const PHI_TAGS = new Set<string>([
  "PatientName",
  "PatientID",
  "PatientBirthDate",
  "PatientAddress",
  "OtherPatientIDs",
  "OtherPatientNames",
  "EthnicGroup",
  "PatientTelephoneNumbers",
  "PatientMotherBirthName",
  "InstitutionName",
  "InstitutionAddress",
  "ReferringPhysicianName",
  "PerformingPhysicianName",
  "OperatorsName",
  "AccessionNumber",
  "StudyDate",
  "SeriesDate",
  "ContentDate",
  "StudyTime",
  "SeriesTime",
  "ContentTime",
  "PatientSex",
  "PatientAge",
  "AdditionalPatientHistory",
  "MedicalRecordLocator",
  "0010,0010", // PatientName
  "0010,0020", // PatientID
  "0008,0020", // StudyDate
  "0008,0080", // InstitutionName
  "0008,0090", // ReferringPhysicianName
]);

// Pure: return a copy of the DICOM metadata map with PHI tags removed (replaced
// with a safe placeholder string), leaving the clinical/technical tags intact.
export function stripPhiTags(
  metadata: Record<string, any>,
  placeholder = ""
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [tag, value] of Object.entries(metadata || {})) {
    const key = tag.includes(",") ? tag.toUpperCase() : tag;
    if (PHI_TAGS.has(key)) {
      out[tag] = placeholder;
    } else {
      out[tag] = value;
    }
  }
  return out;
}

const VALID_MODALITIES = new Set([
  "CT", "MR", "CR", "DX", "US", "PT", "NM", "XA", "RF", "MG", "OT",
]);

function jsonOrNull(v: any) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export const dicomApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/dicom/images?patientId=&studyInstanceUid= — list images (auth)
dicomApp.get("/images", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const patientId = c.req.query("patientId");
  const studyUid = c.req.query("studyInstanceUid");
  const clauses = ["1=1"];
  const binds: any[] = [];
  if (patientId) {
    clauses.push("patient_id = ?");
    binds.push(parseInt(patientId, 10));
  }
  if (studyUid) {
    clauses.push("study_instance_uid = ?");
    binds.push(studyUid);
  }
  const rows = await c.env.DB
    .prepare(`SELECT * FROM dicom_images WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
    .bind(...binds)
    .all<any>();
  return c.json({ images: (rows.results || []).map(normalizeImage) });
});

// POST /api/dicom/metadata — store parsed DICOM metadata (editor+)
dicomApp.post("/metadata", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const patientId = parseInt(body?.patientId, 10);
  const objectKey = typeof body?.objectKey === "string" ? body.objectKey : "";
  if (!Number.isInteger(patientId) || !objectKey) {
    return c.json({ error: "patientId and objectKey are required." }, 400);
  }
  const modality = VALID_MODALITIES.has(body?.modality) ? body.modality : null;
  const isDeid = body?.isDeidentified ? 1 : 0;
  const result = (await c.env.DB
    .prepare(
      `INSERT INTO dicom_images
        (patient_id, object_key, modality, body_part, series_instance_uid,
         study_instance_uid, sop_instance_uid, acquisition_date, dicom_metadata, is_deidentified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      patientId,
      objectKey,
      modality,
      body?.bodyPart ?? null,
      body?.seriesInstanceUid ?? null,
      body?.studyInstanceUid ?? null,
      body?.sopInstanceUid ?? null,
      body?.acquisitionDate ?? null,
      jsonOrNull(body?.metadata),
      isDeid
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "dicom.metadata.create", entity: "dicom_image", entityId: id });
  return c.json({ ok: true, id }, 201);
});

// POST /api/dicom/deidentify — scrub PHI from an existing image's metadata (editor+)
dicomApp.post("/deidentify", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const id = parseInt(body?.id ?? body?.imageId, 10);
  if (!Number.isInteger(id)) return c.json({ error: "id is required." }, 400);
  const existing = await c.env.DB
    .prepare("SELECT * FROM dicom_images WHERE id = ?")
    .bind(id)
    .first<any>();
  if (!existing) return c.json({ error: "Not found" }, 404);
  const meta = safeJson(existing.dicom_metadata);
  const cleaned = stripPhiTags(meta);
  await c.env.DB
    .prepare("UPDATE dicom_images SET dicom_metadata = ?, is_deidentified = 1 WHERE id = ?")
    .bind(JSON.stringify(cleaned), id)
    .run();
  await writeAudit(c, { userId: auth.user.id, action: "dicom.deidentify", entity: "dicom_image", entityId: id });
  return c.json({ ok: true, metadata: cleaned });
});

// GET /api/dicom/studies/:patientId — group images into studies (auth)
dicomApp.get("/studies/:patientId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const patientId = parseInt(c.req.param("patientId") ?? "", 10);
  if (!Number.isInteger(patientId)) return c.json({ error: "Invalid patientId" }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT study_instance_uid, modality, body_part, acquisition_date, COUNT(*) as image_count
       FROM dicom_images WHERE patient_id = ? AND study_instance_uid IS NOT NULL
       GROUP BY study_instance_uid ORDER BY acquisition_date DESC`
    )
    .bind(patientId)
    .all<any>();
  const studies = (rows.results || []).map((r: any) => ({
    studyInstanceUid: r.study_instance_uid,
    modality: r.modality,
    bodyPart: r.body_part,
    acquisitionDate: r.acquisition_date,
    imageCount: r.image_count,
  }));
  return c.json({ studies });
});

function normalizeImage(row: any) {
  return {
    id: row.id,
    patientId: row.patient_id,
    objectKey: row.object_key,
    modality: row.modality,
    bodyPart: row.body_part,
    seriesInstanceUid: row.series_instance_uid,
    studyInstanceUid: row.study_instance_uid,
    sopInstanceUid: row.sop_instance_uid,
    acquisitionDate: row.acquisition_date,
    metadata: safeJson(row.dicom_metadata),
    isDeidentified: !!row.is_deidentified,
    createdAt: row.created_at,
  };
}

function safeJson(v: any) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
