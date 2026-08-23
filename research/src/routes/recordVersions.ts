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

// Field-level diff between two record data snapshots.
function diffSnapshots(
  prev: Record<string, any>,
  next: Record<string, any>
): Array<{ key: string; from: unknown; to: unknown }> {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changes: Array<{ key: string; from: unknown; to: unknown }> = [];
  for (const key of keys) {
    const from = prev[key];
    const to = next[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ key, from, to });
    }
  }
  return changes;
}

export const recordVersionsApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/record-versions/:recordId/snapshot — capture current record state
recordVersionsApp.post("/:recordId/snapshot", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const recordId = parseInt(c.req.param("recordId") ?? "", 10);
  if (!Number.isInteger(recordId) || recordId <= 0)
    return c.json({ error: "Invalid recordId" }, 400);

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const db = c.env.DB;
  const record = await db.prepare("SELECT * FROM records WHERE id = ?").bind(recordId).first<any>();
  if (!record) return c.json({ error: "Record not found." }, 404);

  const maxRow = await db
    .prepare("SELECT MAX(version_no) as m FROM record_versions WHERE record_id = ?")
    .bind(recordId)
    .first<any>();
  const versionNo = (maxRow?.m ?? 0) + 1;

  const result = (await db
    .prepare(
      `INSERT INTO record_versions (record_id, user_id, version_no, data_snapshot, change_summary)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      recordId,
      auth.user.id,
      versionNo,
      record.data,
      body?.changeSummary ? String(body.changeSummary) : null
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;

  await writeAudit(c, {
    userId: auth.user.id,
    action: "record.version",
    entity: "record",
    entityId: recordId,
    detail: { versionNo, changeSummary: body?.changeSummary ?? null },
  });
  return c.json({ ok: true, id, versionNo }, 201);
});

// GET /api/record-versions/:recordId — list versions (newest first)
recordVersionsApp.get("/:recordId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const recordId = parseInt(c.req.param("recordId") ?? "", 10);
  if (!Number.isInteger(recordId) || recordId <= 0)
    return c.json({ error: "Invalid recordId" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT id, record_id as recordId, user_id as userId, version_no as versionNo,
            change_summary as changeSummary, created_at as createdAt
       FROM record_versions WHERE record_id = ? ORDER BY version_no DESC`
  )
    .bind(recordId)
    .all<any>();
  return c.json({ recordId, versions: rows.results || [] });
});

// GET /api/record-versions/:recordId/:version — snapshot + diff vs previous
recordVersionsApp.get("/:recordId/:version", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const recordId = parseInt(c.req.param("recordId") ?? "", 10);
  const version = parseInt(c.req.param("version") ?? "", 10);
  if (!Number.isInteger(recordId) || !Number.isInteger(version) || version <= 0)
    return c.json({ error: "Invalid recordId or version" }, 400);

  const db = c.env.DB;
  const current = await db
    .prepare("SELECT * FROM record_versions WHERE record_id = ? AND version_no = ?")
    .bind(recordId, version)
    .first<any>();
  if (!current) return c.json({ error: "Version not found." }, 404);

  let previous: any = null;
  if (version > 1) {
    previous = await db
      .prepare("SELECT * FROM record_versions WHERE record_id = ? AND version_no = ?")
      .bind(recordId, version - 1)
      .first<any>();
  }

  const currentData = parseJson(current.data_snapshot);
  const previousData = previous ? parseJson(previous.data_snapshot) : {};
  const changes = diffSnapshots(previousData, currentData);

  return c.json({
    recordId,
    versionNo: version,
    changeSummary: current.change_summary,
    createdAt: current.created_at,
    userId: current.user_id,
    snapshot: currentData,
    changes,
  });
});
