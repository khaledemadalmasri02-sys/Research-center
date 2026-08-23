import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, writeAudit } from "../lib/security";

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
cohortApp.post("/build", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
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
  await writeAudit(c, {
    userId: auth.user.id,
    action: "cohort.build",
    detail: { filters: body ? undefined : undefined, count: (rows.results || []).length },
  });
  return c.json({ count: (rows.results || []).length, cohort: rows.results || [] });
});

// POST /api/cohort/export — CSV of matched patients (+ codebook header comment)
cohortApp.post("/export", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
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
  const rows = await c.env.DB.prepare(`SELECT ${fields.join(", ")} FROM patients ${clause}`)
    .bind(...binds)
    .all<any>();

  const header = fields.join(",");
  const lines = (rows.results || []).map((r: any) => fields.map((f) => csvCell(r[f])).join(","));
  const csv = header + "\n" + lines.join("\n");

  await writeAudit(c, {
    userId: auth.user.id,
    action: "cohort.export",
    detail: { count: (rows.results || []).length },
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cohort.csv"',
    },
  });
});

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
