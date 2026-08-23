import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

function parseJson(value: any): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export const recordVerifyApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/record-verify/:recordId — second independent entry; compares the
// submitted data against the stored record and records concordance/conflicts.
recordVerifyApp.post("/:recordId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const recordId = parseInt(c.req.param("recordId") ?? "", 10);
  if (!Number.isInteger(recordId) || recordId <= 0)
    return c.json({ error: "Invalid recordId" }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const secondData = body?.secondData;
  if (!secondData || typeof secondData !== "object")
    return c.json({ error: "secondData object is required." }, 400);

  const db = c.env.DB;
  const record = await db.prepare("SELECT * FROM records WHERE id = ?").bind(recordId).first<any>();
  if (!record) return c.json({ error: "Record not found." }, 404);

  const primary = parseJson(record.data);
  const compareKeys: string[] = Array.isArray(body?.compareKeys)
    ? body.compareKeys
    : Array.from(new Set([...Object.keys(primary), ...Object.keys(secondData)]));

  const conflictFields: string[] = [];
  for (const key of compareKeys) {
    if (JSON.stringify(primary[key]) !== JSON.stringify(secondData[key])) {
      conflictFields.push(key);
    }
  }
  const total = compareKeys.length || 1;
  const concordance = ((total - conflictFields.length) / total) * 100;
  const status = conflictFields.length === 0 ? "matched" : "conflict";

  const result = (await db
    .prepare(
      `INSERT INTO record_verifications (record_id, second_user_id, second_data, status, conflict_fields, concordance)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      recordId,
      auth.user.id,
      JSON.stringify(secondData),
      status,
      JSON.stringify(conflictFields),
      concordance
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;

  await writeAudit(c, {
    userId: auth.user.id,
    action: "record.verify",
    entity: "record",
    entityId: recordId,
    detail: { status, concordance, conflictFields },
  });
  return c.json({ ok: true, id, status, concordance, conflictFields }, 201);
});

// GET /api/record-verify/queue — verifications needing review (conflicts)
recordVerifyApp.get("/queue", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT id, record_id as recordId, second_user_id as secondUserId,
            status, conflict_fields as conflictFields, concordance, created_at as createdAt
       FROM record_verifications WHERE status = 'conflict' ORDER BY created_at DESC`
  ).all<any>();
  return c.json({ queue: rows.results || [] });
});

// GET /api/record-verify/:recordId — verifications for a record
recordVerifyApp.get("/:recordId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const recordId = parseInt(c.req.param("recordId") ?? "", 10);
  if (!Number.isInteger(recordId) || recordId <= 0)
    return c.json({ error: "Invalid recordId" }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT id, record_id as recordId, status, conflict_fields as conflictFields,
            concordance, created_at as createdAt
       FROM record_verifications WHERE record_id = ? ORDER BY created_at DESC`
  )
    .bind(recordId)
    .all<any>();
  return c.json({ recordId, verifications: rows.results || [] });
});
