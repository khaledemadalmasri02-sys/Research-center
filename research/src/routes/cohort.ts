import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

// Allow-listed patient columns for cohort filtering/export. Field names are
// NEVER taken verbatim from user input — only entries here are emitted into SQL,
// and all values are bound as parameters (no string interpolation).
const FIELD_TYPES: Record<string, string> = {
  id: "integer",
  patient_id: "string",
  patient_name: "string",
  age: "integer",
  sex: "string",
  collection_type: "string",
  collection_date: "string",
  date_of_visit: "string",
  chief_complaint: "string",
  provisional_diagnosis: "string",
  final_confirmed_diagnosis: "string",
  final_confirmed_diagnosis_ar: "string",
  ai_prediction_output: "string",
  radiology_images: "string",
};
const ALLOWED = new Set(Object.keys(FIELD_TYPES));
const OPS = new Set(["eq", "neq", "contains", "gt", "lt", "gte", "lte"]);

interface Filter {
  field?: string;
  op?: string;
  value?: unknown;
}

function buildWhere(filters: Filter[]): { clause: string; binds: any[] } {
  const parts: string[] = [];
  const binds: any[] = [];
  for (const f of filters || []) {
    if (!f?.field || !ALLOWED.has(f.field)) continue;
    if (!OPS.has(f.op || "")) continue;
    const col = f.field;
    const v = f.value;
    if (f.op === "contains") {
      parts.push(`${col} LIKE ?`);
      binds.push(`%${v}%`);
    } else if (f.op === "eq") {
      parts.push(`${col} = ?`);
      binds.push(v);
    } else if (f.op === "neq") {
      parts.push(`${col} <> ?`);
      binds.push(v);
    } else if (f.op === "gt") {
      parts.push(`${col} > ?`);
      binds.push(v);
    } else if (f.op === "lt") {
      parts.push(`${col} < ?`);
      binds.push(v);
    } else if (f.op === "gte") {
      parts.push(`${col} >= ?`);
      binds.push(v);
    } else if (f.op === "lte") {
      parts.push(`${col} <= ?`);
      binds.push(v);
    }
  }
  return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", binds };
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const cohortApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/cohort/build — apply filters, return matched patient matrix
//
// Requires an edit-capable role. This endpoint returns an arbitrary
// allow-listed column set for an arbitrary filter over the WHOLE `patients`
// table, i.e. it is a query interface against the patient roster. Gating it on
// "is authenticated" (the previous behaviour) meant a `viewer` — the
// lowest-privilege role in the system — could POST
// `{"fields":["patient_name","chief_complaint"],"filters":[]}` and receive the
// entire patient roster as JSON, or as CSV from /export. There is no
// per-patient ownership model to fall back on (see requirePatientScope), so the
// role gate is the control.
cohortApp.post("/build", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user))
    return c.json({ error: "Forbidden: cohort build requires editor access." }, 403);
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const { clause, binds } = buildWhere(body?.filters || []);
  const fields: string[] = Array.isArray(body?.fields)
    ? body.fields.filter((f: any) => ALLOWED.has(f))
    : [];
  const cols = fields.length ? fields.join(", ") : "id, patient_id, age, sex, final_confirmed_diagnosis";
  const rows = await c.env.DB.prepare(`SELECT ${cols} FROM patients ${clause}`)
    .bind(...binds)
    .all<any>();
  // The previous audit detail was `{ filters: undefined, count }` — a literal
  // `undefined`, so the log recorded a COUNT and nothing else. A breach
  // investigation cannot tell which columns left the building or on whose
  // record. Log the effective field list and the effective filter set.
  await writeAudit(c, {
    userId: auth.user.id,
    action: "cohort.build",
    detail: {
      fields: fields.length ? fields : cols.split(",").map((s) => s.trim()),
      filters: normalizeFiltersForAudit(body?.filters),
      count: (rows.results || []).length,
    },
  });
  return c.json({ count: (rows.results || []).length, cohort: rows.results || [] });
});

// POST /api/cohort/export — CSV of matched patients (+ codebook header comment)
cohortApp.post("/export", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user))
    return c.json({ error: "Forbidden: cohort export requires editor access." }, 403);
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const { clause, binds } = buildWhere(body?.filters || []);
  const fields: string[] = Array.isArray(body?.fields)
    ? body.fields.filter((f: any) => ALLOWED.has(f))
    : ["id", "patient_id", "age", "sex", "final_confirmed_diagnosis"];
  // Bound the export. An unbounded cohort export is both a DoS vector (the
  // whole roster in one response) and a bulk-disclosure event with no
  // pagination for the operator to have noticed it was oversized.
  const limit = Math.min(
    Math.max(parseInt(String(body?.limit ?? 1000), 10) || 1000, 1),
    10000
  );
  const offset = Math.max(parseInt(String(body?.offset ?? 0), 10) || 0, 0);
  const rows = await c.env.DB
    .prepare(`SELECT ${fields.join(", ")} FROM patients ${clause} LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<any>();

  const header = fields.join(",");
  const lines = (rows.results || []).map((r: any) => fields.map((f) => csvCell(r[f])).join(","));
  const csv = header + "\n" + lines.join("\n");

  await writeAudit(c, {
    userId: auth.user.id,
    action: "cohort.export",
    // Full field list + filters + limit/offset: this is the record of exactly
    // which PHI columns were disclosed and under what selection.
    detail: {
      fields,
      filters: normalizeFiltersForAudit(body?.filters),
      limit,
      offset,
      count: (rows.results || []).length,
    },
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cohort.csv"',
      "Cache-Control": "private, no-store",
    },
  });
});

// Echo back the filters as they were actually applied (allow-listed fields
// only), so the audit entry describes the executed query rather than the
// submitted one — a request full of rejected fields must not look identical to
// one where every filter took effect.
function normalizeFiltersForAudit(filters: unknown): Array<{
  field: string;
  op: string;
  value: unknown;
}> {
  const out: Array<{ field: string; op: string; value: unknown }> = [];
  for (const f of (filters || []) as Filter[]) {
    if (!f?.field || !ALLOWED.has(f.field)) continue;
    if (!OPS.has(f.op || "")) continue;
    out.push({ field: f.field, op: f.op as string, value: f.value });
  }
  return out;
}

// GET /api/cohort/codebook — field metadata for the exported dataset
cohortApp.get("/codebook", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const codebook = Object.entries(FIELD_TYPES).map(([field, type]) => ({
    field,
    type,
    label: field.replace(/_/g, " "),
  }));
  return c.json({ codebook });
});

// POST /api/cohort/stats — cross-tabulation of two fields over the cohort
cohortApp.post("/stats", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user))
    return c.json({ error: "Forbidden: cohort stats requires editor access." }, 403);
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const rowField = body?.rowField;
  const colField = body?.colField;
  if (!ALLOWED.has(rowField) || !ALLOWED.has(colField))
    return c.json({ error: "rowField and colField must be allowed fields." }, 400);

  const { clause, binds } = buildWhere(body?.filters || []);
  const rows = await c.env.DB.prepare(
    `SELECT ${rowField} as rowVal, ${colField} as colVal, COUNT(*) as count
       FROM patients ${clause} GROUP BY ${rowField}, ${colField}`
  )
    .bind(...binds)
    .all<any>();
  return c.json({ rowField, colField, cells: rows.results || [] });
});
