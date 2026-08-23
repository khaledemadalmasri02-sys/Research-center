import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

const VALID_SYSTEMS = new Set(["ICD10", "SNOMED"]);

export const codingApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/codings/search?q=&system= — autocomplete over the terminology table
codingApp.get("/search", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const q = (c.req.query("q") || "").trim();
  const system = c.req.query("system");
  if (!q) return c.json({ codes: [] });

  const like = `%${q}%`;
  const clauses = ["(code LIKE ? OR display LIKE ?)"];
  const binds: any[] = [like, like];
  if (system && VALID_SYSTEMS.has(system)) {
    clauses.push("code_system = ?");
    binds.push(system);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, code_system as codeSystem, code, display
       FROM terminology_codes WHERE ${clauses.join(" AND ")}
       ORDER BY code LIMIT 25`
  )
    .bind(...binds)
    .all<any>();
  return c.json({ codes: rows.results || [] });
});

// POST /api/diagnoses/code — attach a standardized code to a patient/record
codingApp.post("/code", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const codeSystem = typeof body?.codeSystem === "string" ? body.codeSystem : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!VALID_SYSTEMS.has(codeSystem)) return c.json({ error: "codeSystem must be ICD10 or SNOMED." }, 400);
  if (!code) return c.json({ error: "code is required." }, 400);

  const patientId = body?.patientId != null ? parseInt(body.patientId, 10) : null;
  const recordId = body?.recordId != null ? parseInt(body.recordId, 10) : null;
  if (patientId == null && recordId == null)
    return c.json({ error: "patientId or recordId is required." }, 400);

  // Validate the code exists in the terminology table.
  const term = await c.env.DB.prepare(
    "SELECT display FROM terminology_codes WHERE code_system = ? AND code = ?"
  )
    .bind(codeSystem, code)
    .first<any>();
  if (!term) return c.json({ error: "Unknown code for this system." }, 400);

  const result = (await c.env.DB
    .prepare(
      `INSERT INTO diagnosis_codes (patient_id, record_id, code_system, code, display, confidence, coded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      patientId,
      recordId,
      codeSystem,
      code,
      term.display,
      body?.confidence != null ? Number(body.confidence) : null,
      auth.user.id
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;

  await writeAudit(c, {
    userId: auth.user.id,
    action: "diagnosis.code",
    entity: "diagnosis",
    entityId: id,
    detail: { codeSystem, code, patientId, recordId },
  });
  return c.json({ ok: true, id, display: term.display }, 201);
});

// GET /api/diagnoses?patientId=&recordId= — list coded diagnoses
codingApp.get("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const patientId = c.req.query("patientId");
  const recordId = c.req.query("recordId");
  const clauses: string[] = [];
  const binds: any[] = [];
  if (patientId) { clauses.push("patient_id = ?"); binds.push(parseInt(patientId, 10)); }
  if (recordId) { clauses.push("record_id = ?"); binds.push(parseInt(recordId, 10)); }
  if (!clauses.length) return c.json({ error: "patientId or recordId required." }, 400);

  const rows = await db.prepare(
    `SELECT id, patient_id as patientId, record_id as recordId, code_system as codeSystem,
            code, display, confidence, created_at as createdAt
       FROM diagnosis_codes WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`
  )
    .bind(...binds)
    .all<any>();
  return c.json({ diagnoses: rows.results || [] });
});
