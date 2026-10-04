import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import {
  getAuthUser,
  canEdit,
  writeAudit,
  requirePatientScope,
} from "../lib/security";

// ---------------------------------------------------------------------------
// HIPAA Safe Harbor export column set (45 CFR 164.514(b)(2))
// ---------------------------------------------------------------------------
// The export row is built from this fixed allow-list and NEVER from `SELECT *`,
// so a newly added PHI column in `patients` cannot leak by accident.
//
//   pseudonym       salted SHA-256 over (secret, studyCode, patientId)
//   age             integer, aggregated to "90+" above 89 (§164.514(b)(2)(i))
//   sex             administrative sex
//   collection_type how the record was collected (coded, no free text)
//   year_of_visit   YEAR ONLY — every date element except the year is a
//                   Safe Harbor identifier (§164.514(b)(2)(i))
//
// REMOVED IN THIS FIX (each was previously exported and is a Safe Harbor
// identifier or a free-text PHI vector):
//   date_of_visit                  exact date → year only
//   chief_complaint                free text; routinely embeds names / MRNs
//   provisional_diagnosis          free text
//   final_confirmed_diagnosis      free text
//   final_confirmed_diagnosis_ar   free text
//   ai_prediction_output           model free-text output
//   (plus patient_name, patient_id, birth/visit dates, notes and radiology
//    object links, which were never in this list but WERE the subject of the
//    dead `PHI_DROP_COLUMNS` set — that set had an EMPTY intersection with the
//    export list, so its `continue` guard could never fire. It is deleted
//    rather than repaired: with an allow-list, a drop-list is dead weight and
//    only creates the illusion of a second line of defence.)
//
// !! NOT SAFE HARBOR COMPLIANT FOR FREE TEXT !!
// This endpoint emits no free-text clinical field, which is precisely why it
// does not need a PHI scanner today. Any endpoint that re-adds
// `chief_complaint` / `*_diagnosis` / `ai_prediction_output` must be scanned
// with a PHI detector (Microsoft Presidio, AWS Comprehend PII, or equivalent)
// AND human-reviewed before it may be labelled "de-identified"; free text
// routinely carries names, MRNs, dates and locations that no column allow-list
// can filter. Separately, de-identified *metadata* is not de-identified *pixels*
// — see routes/dicom.ts for the burned-in-annotation gap that this dataset
// export cannot address either.
export const EXPORT_COLUMNS = [
  "pseudonym",
  "age",
  "sex",
  "collection_type",
  "year_of_visit",
] as const;

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(row: Record<string, unknown>): string {
  return EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(",");
}

// Age aggregation for Safe Harbor: anything above 89 is a single bucket, so a
// 93-year-old and a 95-year-old cannot be told apart (and, combined with a
// dataset this size, cannot be re-identified by differencing).
export function aggregateAge(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
  if (!Number.isFinite(n)) return "";
  if (n > 89) return "90+";
  if (n < 0) return "";
  return String(n);
}

// Year-only date. Exact dates are a Safe Harbor identifier: with a dataset of
// this size a full date plus age plus sex is routinely enough to single out an
// individual in a small cohort.
export function yearOfVisit(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const year = String(value).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "";
}

// Build one export row from the fixed allow-list above. Pure, exported for tests.
export function safeExportRow(
  patient: Record<string, unknown>,
  pseudonym: string
): Record<string, unknown> {
  return {
    pseudonym,
    age: aggregateAge(patient.age),
    sex: patient.sex ?? "",
    collection_type: patient.collection_type ?? "",
    year_of_visit: yearOfVisit(patient.date_of_visit),
  };
}

// The pseudonym salt. There is deliberately NO fallback value here.
//
// The previous code used `c.env.SESSION_SECRET || "mednexus-deid"`. A salt
// published in the repository is not a salt: with the salt known, every
// `PS-XXXXXXXXXX` in every historical export is recomputable offline from the
// trivially guessable inputs (studyCode, patientId) — which de-identifies the
// entire dataset retroactively. Failing loudly is the only safe behaviour: if
// the operator has not set SESSION_SECRET, no export happens.
function requireDeidSalt(c: AppContext): string {
  const salt = c.env.SESSION_SECRET;
  if (!salt || !salt.trim()) {
    throw new Error(
      "SESSION_SECRET is not configured; refusing to mint pseudonyms. " +
        "A default salt would make every published pseudonym recomputable from " +
        "(studyCode, patientId)."
    );
  }
  return salt;
}

async function resolvePseudonym(
  c: AppContext,
  patientId: number,
  studyCode: string,
  salt: string
): Promise<string> {
  const db = c.env.DB;
  const material = `${salt}:${studyCode}:${patientId}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material)
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const pseudonym = "PS-" + hex.slice(0, 10).toUpperCase();

  await db
    .prepare(
      `INSERT OR IGNORE INTO pseudonyms (patient_id, study_code, pseudonym)
       VALUES (?, ?, ?)`
    )
    .bind(patientId, studyCode, pseudonym)
    .run();
  const row = (await db
    .prepare(
      "SELECT pseudonym FROM pseudonyms WHERE patient_id = ? AND study_code = ?"
    )
    .bind(patientId, studyCode)
    .first<any>()) as any;
  return row?.pseudonym || pseudonym;
}

export const deidentifyApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/deidentify/pseudonym?patientId=&studyCode= — look up existing
deidentifyApp.get("/pseudonym", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const denied = requirePatientScope(c, auth.user);
  if (denied) return denied;
  const patientId = parseInt(c.req.query("patientId") || "", 10);
  const studyCode = c.req.query("studyCode") || "";
  if (!Number.isInteger(patientId) || !studyCode)
    return c.json({ error: "patientId and studyCode are required." }, 400);
  const row = await c.env.DB.prepare(
    "SELECT pseudonym FROM pseudonyms WHERE patient_id = ? AND study_code = ?"
  )
    .bind(patientId, studyCode)
    .first<any>();
  if (!row) return c.json({ error: "No pseudonym yet." }, 404);
  return c.json({ patientId, studyCode, pseudonym: row.pseudonym });
});

// POST /api/deidentify/pseudonym — create (deterministic) pseudonym
deidentifyApp.post("/pseudonym", async (c: AppContext) => {
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
  const studyCode = typeof body?.studyCode === "string" ? body.studyCode.trim() : "";
  if (!Number.isInteger(patientId) || patientId <= 0 || !studyCode)
    return c.json({ error: "patientId and studyCode are required." }, 400);

  let salt: string;
  try {
    salt = requireDeidSalt(c);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
  const pseudonym = await resolvePseudonym(c, patientId, studyCode, salt);
  await writeAudit(c, {
    userId: auth.user.id,
    action: "deidentify.pseudonym",
    entity: "patient",
    entityId: patientId,
    detail: { studyCode, pseudonym },
  });
  return c.json({ patientId, studyCode, pseudonym }, 201);
});

// POST /api/deidentify/export?studyCode= — de-identified CSV of all patients.
//
// CSRF: this WAS `GET /export`. It is not a read: `resolvePseudonym` performs
// `INSERT OR IGNORE INTO pseudonyms` for every patient in the table, so a
// bare `<img src="https://research-center.fit/api/deidentify/export?studyCode=x">`
// on any third-party page wrote attacker-chosen rows using any logged-in
// editor's session cookie. `SameSite=Lax` does not help — a top-level
// navigation is exactly the case Lax permits. State-changing => POST. Do not
// reintroduce a GET here; csrfGuard explicitly does not cover GET.
deidentifyApp.post("/export", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const studyCode = c.req.query("studyCode") || "DEFAULT";
  const db = c.env.DB;

  // KNOWN LIMITATION: `patients` (D1) is always empty in production — see the
  // KNOWN ISSUE block in src/index.ts. This endpoint does NOT silently return
  // an empty CSV any more: an empty dataset is indistinguishable from
  // "de-identification succeeded" and would be filed as a compliant export.
  const patients = await db
    .prepare("SELECT * FROM patients ORDER BY id ASC")
    .all<any>();
  const rows = patients.results || [];
  if (rows.length === 0) {
    return c.json(
      {
        error:
          "No rows in the D1 `patients` table, so there is nothing to " +
          "de-identify. This is the known D1/Postgres split-brain: patient " +
          "records are created in Postgres behind the api-server, and this " +
          "Worker's D1 clinical routes read a table nothing writes. Refusing " +
          "to emit a 0-row CSV that reads as a successful de-identification run.",
      },
      409
    );
  }

  let salt: string;
  try {
    salt = requireDeidSalt(c);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }

  const out: Record<string, unknown>[] = [];
  for (const p of rows) {
    const pseudonym = await resolvePseudonym(c, p.id, studyCode, salt);
    out.push(safeExportRow(p, pseudonym));
  }

  const csv =
    EXPORT_COLUMNS.join(",") +
    "\n" +
    out.map(csvLine).join("\n");

  // Always audited: a POST that emits a whole (de-identified) patient roster is
  // a disclosure event regardless of whether it also records a deid job.
  await db
    .prepare(
      `INSERT INTO deid_jobs (user_id, scope, status, config_json, finished_at)
       VALUES (?, 'dataset', 'done', ?, datetime('now'))`
    )
    .bind(
      auth.user.id,
      JSON.stringify({ studyCode, rows: out.length, columns: EXPORT_COLUMNS })
    )
    .run();
  await writeAudit(c, {
    userId: auth.user.id,
    action: "deidentify.export",
    entity: "dataset",
    detail: { studyCode, rows: out.length, columns: EXPORT_COLUMNS },
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deidentified_${studyCode}.csv"`,
      // De-identified derivatives are the ONLY thing allowed to be publicly
      // cacheable, and even then not for a year: pseudonym->patient linkage
      // can be re-established by the holder of the key, so a stale cached copy
      // outlives the study's consent window.
      "Cache-Control": "private, no-store",
    },
  });
});