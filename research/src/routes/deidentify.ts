import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

// Columns considered direct identifiers / PHI that are stripped from any
// shared or exported dataset. Clinical fields (diagnosis, age, sex, findings)
// are retained because they are necessary for research analysis.
const PHI_DROP_COLUMNS = new Set([
  "patient_name",
  "radiology_image_file_path_or_link",
  "radiology_images",
  "notes",
]);

// Columns retained (in order) in a de-identified patient export.
const EXPORT_COLUMNS = [
  "pseudonym",
  "age",
  "sex",
  "collection_type",
  "date_of_visit",
  "chief_complaint",
  "provisional_diagnosis",
  "final_confirmed_diagnosis",
  "final_confirmed_diagnosis_ar",
  "ai_prediction_output",
];

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(row: Record<string, unknown>): string {
  return EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(",");
}

async function resolvePseudonym(
  c: AppContext,
  patientId: number,
  studyCode: string
): Promise<string> {
  const db = c.env.DB;
  const salt = c.env.SESSION_SECRET || "mednexus-deid";
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

  const pseudonym = await resolvePseudonym(c, patientId, studyCode);
  await writeAudit(c, {
    userId: auth.user.id,
    action: "deidentify.pseudonym",
    entity: "patient",
    entityId: patientId,
    detail: { studyCode, pseudonym },
  });
  return c.json({ patientId, studyCode, pseudonym }, 201);
});

// GET /api/deidentify/export?studyCode= — de-identified CSV of all patients
deidentifyApp.get("/export", async (c: AppContext) => {
  return runExport(c);
});

// POST /api/deidentify/export?studyCode= — same, but logs a deid job
deidentifyApp.post("/export", async (c: AppContext) => {
  return runExport(c, true);
});

async function runExport(c: AppContext, logJob = false): Promise<Response> {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const studyCode = c.req.query("studyCode") || "DEFAULT";
  const db = c.env.DB;
  const patients = await db
    .prepare("SELECT * FROM patients ORDER BY id ASC")
    .all<any>();
  const rows = patients.results || [];

  const out: Record<string, unknown>[] = [];
  for (const p of rows) {
    const pseudonym = await resolvePseudonym(c, p.id, studyCode);
    const cleaned: Record<string, unknown> = { pseudonym };
    for (const col of EXPORT_COLUMNS) {
      if (col === "pseudonym") continue;
      if (PHI_DROP_COLUMNS.has(col)) continue;
      cleaned[col] = p[col];
    }
    out.push(cleaned);
  }

  const csv =
    EXPORT_COLUMNS.join(",") +
    "\n" +
    out.map(csvLine).join("\n");

  if (logJob) {
    await db
      .prepare(
        `INSERT INTO deid_jobs (user_id, scope, status, config_json, finished_at)
         VALUES (?, 'dataset', 'done', ?, datetime('now'))`
      )
      .bind(auth.user.id, JSON.stringify({ studyCode, rows: out.length }))
      .run();
    await writeAudit(c, {
      userId: auth.user.id,
      action: "deidentify.export",
      entity: "dataset",
      detail: { studyCode, rows: out.length },
    });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deidentified_${studyCode}.csv"`,
    },
  });
}
