import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import {
  getAuthUser,
  canEdit,
  writeAudit,
  requirePatientScope,
} from "../lib/security";

// ---------------------------------------------------------------------------
// `is_deidentified` is a TRI-STATE, not a boolean (W2).
// ---------------------------------------------------------------------------
//   0 = NOT de-identified (untouched, or only metadata was rewritten)
//   1 = METADATA ONLY — PHI tags cleared in the `dicom_metadata` column, but
//       the pixel data in object storage was NEVER read or rewritten
//   2 = FULLY de-identified — metadata cleared AND the DICOM object itself was
//       rewritten by a real PS3.15 Annex E scrubber
//
// The column is declared `INTEGER NOT NULL DEFAULT 0` in both schema.sql and
// lib/db-bootstrap.ts, so the tri-state needs no migration to be stored. Nothing
// ever writes 2 today; see the BLOCKER comment on POST /deidentify.
export const DEID_NONE = 0;
export const DEID_METADATA_ONLY = 1;
export const DEID_FULL = 2;

// Human-readable meaning of the tri-state, surfaced in API responses so no
// downstream consumer has to guess what `isDeidentified: true` means.
export const DEID_STATE_LABEL: Record<number, string> = {
  0: "not de-identified",
  1: "metadata de-identified only; PIXEL DATA NOT SCRUBBED",
  2: "fully de-identified (metadata + pixels)",
};

// ---------------------------------------------------------------------------
// !! THE CENTRAL FALSE-ASSURANCE GAP IN THIS CODEBASE !!
// ---------------------------------------------------------------------------
// `POST /api/dicom/deidentify` used to rewrite the `dicom_metadata` JSON
// column in D1 and then set `is_deidentified = 1`, while the actual DICOM
// object in S3/R2 — which holds burned-in pixel annotations (the classic
// "PID 3 overlay" on an old CT console, patient names rendered into the image
// corners, scout-view text, and private-tag vendor blocks) — was never read,
// never fetched and never rewritten.
//
// Everything downstream then treated the image as clean: the cohort export, ML
// training input selection, and the PDF report which stamps `[deid]` whenever
// `is_deidentified` is truthy (routes/reports.ts:38). That is the highest
// consequence defect in the repo: a downstream consumer has no way to tell the
// difference between "scrubbed" and "we cleared a JSON blob".
//
// This endpoint therefore REFUSES to claim de-identification. There is no DICOM
// library available to this Worker (no native modules, no installs permitted),
// and a regex over `dicom_metadata` cannot reach pixels.
//
// THE EXACT GAP, to be closed before any de-identified export is allowed:
//   1. Re-read the DICOM object from R2/S3 (streaming — real instances are
//      10-500 MB and must never be buffered into the 128 MB Worker heap).
//   2. Parse the Part 10 file and rewrite it with a PS3.15 Annex E Basic
//      Application Level Confidentiality Profile scrubber (GDCM's
//      `gdcm::Anonymizer`, or dcmjs with a DicomMetaDictionary.naturalSortTags
//      / explicit-removal profile). It must handle, at minimum:
//        - ZOTY/BASIC profile tag removals (the set above, plus private tags
//          and any tag not on the standard whitelist)
//        - tag *replacement* rather than blanking where a value is required
//        - nested sequence item removal, not just top-level elements
//        - pixel-data burnt-in annotation detection (`BurnedInAnnotation`,
//          per-vendor presets) and either redaction or rejection
//   3. Write the scrubbed object to a NEW key (never overwrite the source —
//      that is what you need if the scrub turns out to be wrong), verify it
//      re-parses, and update `object_key` to the scrubbed copy.
//   4. Only then set `is_deidentified = 2`, and only for the new key.
// Until (1)-(4) exist, the maximum honest value this endpoint may write is 1.
// ---------------------------------------------------------------------------

// DICOM tags that carry direct PHI and must be stripped when de-identifying an
// image's metadata. Keyed by common DICOM keyword (the data dictionary tag is
// also accepted, e.g. "0010,0010").
//
// Gaps closed here relative to the previous list: StudyID, PatientBirthTime,
// Occupation, BranchOfService, RequestedProcedureComments,
// InstitutionDepartmentName, PatientAddress (was listed but unreachable — see
// the case-normalisation note below), PatientTelephoneNumbers (ditto), and the
// two physician-name tags that PS3.15 Table E.1-1 lists explicitly.
const PHI_TAG_KEYWORDS = [
  "PatientName",
  "PatientID",
  "PatientBirthDate",
  "PatientBirthTime",
  "PatientAddress",
  "PatientTelephoneNumbers",
  "OtherPatientIDs",
  "OtherPatientNames",
  "EthnicGroup",
  "PatientMotherBirthName",
  "MedicalRecordLocator",
  "PatientSex",
  "PatientAge",
  "AdditionalPatientHistory",
  "Occupation",
  "BranchOfService",
  "AccessionNumber",
  "StudyID",
  "StudyDate",
  "SeriesDate",
  "ContentDate",
  "StudyTime",
  "SeriesTime",
  "ContentTime",
  "RequestedProcedureComments",
  "InstitutionName",
  "InstitutionDepartmentName",
  "InstitutionAddress",
  "ReferringPhysicianName",
  "PerformingPhysicianName",
  "OperatorsName",
  "0010,0010", // PatientName
  "0010,0020", // PatientID
  "0010,0030", // PatientBirthDate
  "0010,1000", // OtherPatientIDs
  "0010,1001", // OtherPatientNames
  "0010,1040", // PatientAddress
  "0010,2154", // PatientTelephoneNumbers
  "0008,0020", // StudyDate
  "0008,0021", // SeriesDate
  "0008,0023", // ContentDate
  "0008,0050", // AccessionNumber
  "0008,0090", // ReferringPhysicianName
  "0008,0092", // PerformingPhysicianName
  "0008,1030", // StudyDescription (free text, frequently carries a name)
  "0008,103E", // SeriesDescription
  "0032,1032", // RequestingPhysician
  "0032,1033", // RequestingService
];

// Normalised to upper case because stripPhiTags() uppercases every incoming key
// before lookup — a mixed-case entry here would never match, which is exactly
// how the previous case-sensitive comparison silently failed.
export const PHI_TAGS: ReadonlySet<string> = new Set(
  PHI_TAG_KEYWORDS.map((t) => t.trim().toUpperCase())
);

// Pure: return a copy of the DICOM metadata map with PHI tags removed (replaced
// with a safe placeholder string), leaving the clinical/technical tags intact.
//
// CASE NORMALISATION: the previous version uppercased ONLY tags containing a
// comma ("0010,0010"), so a parser emitting lowercase keywords
// ("patientname", "PatientID" vs "patientid") bypassed the whole list. Real
// DICOM parsers differ in case depending on how the dataset was serialised, so
// every key is now compared case-insensitively.
export function stripPhiTags(
  metadata: Record<string, any>,
  placeholder = ""
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [tag, value] of Object.entries(metadata || {})) {
    const key = tag.trim().toUpperCase();
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

// Capped limit/offset helper, matching the shape already used correctly in the
// (now-deleted) extras.ts at the old `extras.ts:66-67`.
export function boundedPaging(
  rawLimit: string | undefined,
  rawOffset: string | undefined,
  maxLimit = 100
): { limit: number; offset: number } {
  // `parseInt("0") || maxLimit` would treat an explicit limit=0 as absent
  // (0 is falsy) and silently substitute the default, so the floor below would
  // never run. Parse first, then decide.
  const parsedLimit =
    rawLimit === undefined || rawLimit === "" ? maxLimit : parseInt(rawLimit, 10);
  const parsedOffset =
    rawOffset === undefined || rawOffset === "" ? 0 : parseInt(rawOffset, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit as number, 1), maxLimit)
    : maxLimit;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset as number, 0) : 0;
  return { limit, offset };
}

// GET /api/dicom/images?patientId=&studyInstanceUid=&limit=&offset=
//
// `patientId` is now REQUIRED. This is the highest-cardinality table in the
// Worker (one row per stored instance, per series) and BOTH filters used to be
// optional, so `GET /api/dicom/images` with no query string ran
// `SELECT * FROM dicom_images ORDER BY created_at DESC` — the entire radiology
// catalogue, unbounded, to any authenticated user, including a viewer. Even
// with `patientId` set the result set was unbounded, which is a cheap way to
// burn the D1 row/response budget.
dicomApp.get("/images", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const denied = requirePatientScope(c, auth.user);
  if (denied) return denied;
  const patientId = c.req.query("patientId");
  if (!patientId) {
    return c.json(
      {
        error:
          "patientId is required. Listing the whole dicom_images table is not " +
          "permitted; request one patient at a time.",
      },
      400
    );
  }
  const parsed = parseInt(patientId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return c.json({ error: "Invalid patientId" }, 400);
  }
  const studyUid = c.req.query("studyInstanceUid");
  const { limit, offset } = boundedPaging(c.req.query("limit"), c.req.query("offset"));
  const clauses = ["patient_id = ?"];
  const binds: any[] = [parsed];
  if (studyUid) {
    clauses.push("study_instance_uid = ?");
    binds.push(studyUid);
  }
  binds.push(limit, offset);
  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM dicom_images WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds)
    .all<any>();
  return c.json({
    images: (rows.results || []).map(normalizeImage),
    limit,
    offset,
    hasMore: (rows.results || []).length === limit,
  });
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
  // Callers may assert a de-identification state, but state 2 (fully
  // de-identified) can never be self-asserted: this endpoint records metadata
  // that a client supplied, it has not inspected the object. Clamp to
  // METADATA_ONLY so a crafted `isDeidentified: true` in the request body
  // cannot promote an unscrubbed image to "fully de-identified".
  const isDeid = body?.isDeidentified ? DEID_METADATA_ONLY : DEID_NONE;
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

// POST /api/dicom/deidentify — scrub PHI from an existing image's METADATA.
//
// This is a metadata-only operation and is now labelled as such. See the big
// BLOCKER comment at the top of this file: the pixel data in object storage is
// NOT touched, so this endpoint must not report success.
//
// It writes `is_deidentified = 1` (METADATA_ONLY) and returns 422 — not 200 —
// so that no caller can treat the response as "the image is now de-identified".
// 422 is deliberate: the metadata was genuinely rewritten (that part succeeded)
// but the requested end state — a de-identified image — was not achieved.
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
    .prepare(
      `UPDATE dicom_images SET dicom_metadata = ?, is_deidentified = ?
        WHERE id = ?`
    )
    .bind(JSON.stringify(cleaned), DEID_METADATA_ONLY, id)
    .run();
  await writeAudit(c, {
    userId: auth.user.id,
    action: "dicom.deidentify.metadata_only",
    entity: "dicom_image",
    entityId: id,
    detail: {
      objectKey: existing.object_key ?? null,
      pixelsScrubbed: false,
      state: DEID_STATE_LABEL[DEID_METADATA_ONLY],
    },
  });
  return c.json(
    {
      error:
        "Pixel de-identification is NOT implemented. Only the DICOM header " +
        "stored in `dicom_metadata` was scrubbed; the object at " +
        "`object_key` in object storage was never read or rewritten and may " +
        "still carry burned-in pixel annotations. This image MUST NOT be " +
        "treated or exported as de-identified.",
      objectKey: existing.object_key ?? null,
      metadata: cleaned,
      metadataDeidentified: true,
      pixelsScrubbed: false,
      isDeidentified: DEID_METADATA_ONLY,
      isDeidentifiedState: DEID_STATE_LABEL[DEID_METADATA_ONLY],
      fullyDeidentified: false,
      requiredNextStep:
        "Rewrite the object with a PS3.15 Annex E confidentiality profile " +
        "(gdcm::Anonymizer / dcmjs), including burned-in annotation detection, " +
        "then set is_deidentified = 2.",
    },
    422
  );
});

// GET /api/dicom/studies/:patientId — group images into studies (auth)
dicomApp.get("/studies/:patientId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const denied = requirePatientScope(c, auth.user);
  if (denied) return denied;
  const patientId = parseInt(c.req.param("patientId") ?? "", 10);
  if (!Number.isInteger(patientId)) return c.json({ error: "Invalid patientId" }, 400);
  // Bounded: a patient with thousands of studies is possible in principle and
  // the GROUP BY was previously unbounded.
  const { limit } = boundedPaging(c.req.query("limit"), c.req.query("offset"), 200);
  const rows = await c.env.DB
    .prepare(
      `SELECT study_instance_uid, modality, body_part, acquisition_date, COUNT(*) as image_count
       FROM dicom_images WHERE patient_id = ? AND study_instance_uid IS NOT NULL
       GROUP BY study_instance_uid ORDER BY acquisition_date DESC LIMIT ?`
    )
    .bind(patientId, limit)
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
  const state = Number(row.is_deidentified) || 0;
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
    // Tri-state, not a boolean. `isDeidentified` is kept for compatibility
    // with existing consumers but now means strictly "FULLY de-identified"
    // (state 2), so that any consumer still testing it for truthiness stops
    // treating a metadata-only scrub as a clean image.
    isDeidentified: state === DEID_FULL,
    deidState: state,
    deidStateLabel: DEID_STATE_LABEL[state] ?? DEID_STATE_LABEL[DEID_NONE],
    pixelsScrubbed: state === DEID_FULL,
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
