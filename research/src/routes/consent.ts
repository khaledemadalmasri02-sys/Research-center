import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import {
  getAuthUser,
  isAdmin,
  canEdit,
  writeAudit,
} from "../lib/security";

export const consentApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/consent/versions — active (non-retired) consent templates
consentApp.get("/versions", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const res = await c.env.DB.prepare(
    `SELECT id, code, label, irb_number, effective_at
       FROM consent_versions
      WHERE retired_at IS NULL
      ORDER BY effective_at DESC`
  ).all<any>();
  return c.json({ versions: res.results || [] });
});

// POST /api/consent/versions — create a consent template (admin only)
consentApp.post("/versions", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Admin access required." }, 403);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!code || !label)
    return c.json({ error: "code and label are required." }, 400);

  const result = (await c.env.DB
    .prepare(
      "INSERT INTO consent_versions (code, label, irb_number, text) VALUES (?, ?, ?, ?)"
    )
    .bind(
      code,
      label,
      body?.irbNumber ? String(body.irbNumber) : null,
      body?.text ? String(body.text) : null
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, {
    userId: auth.user.id,
    action: "consent_version.create",
    entity: "consent_version",
    entityId: id,
  });
  return c.json({ ok: true, id }, 201);
});

// GET /api/consent — list consents (optionally filtered by patientId)
consentApp.get("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const db = c.env.DB;
  const patientId = c.req.query("patientId");
  const clauses = ["1=1"];
  const binds: any[] = [];
  if (patientId) {
    clauses.push("c.patient_id = ?");
    binds.push(parseInt(patientId, 10));
  }
  const rows = await db
    .prepare(
      `SELECT c.id, c.patient_id as patientId, c.consent_version_id as consentVersionId,
              c.status, c.signed_at as signedAt, c.signed_by_user_id as signedByUserId,
              c.withdrawn_at as withdrawnAt, c.withdrawn_reason as withdrawnReason,
              c.document_object_key as documentObjectKey, c.created_at as createdAt,
              v.code as versionCode, v.label as versionLabel, v.irb_number as irbNumber
         FROM consents c
         LEFT JOIN consent_versions v ON v.id = c.consent_version_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY c.created_at DESC`
    )
    .bind(...binds)
    .all<any>();
  return c.json({ consents: rows.results || [] });
});

// GET /api/consent/status?patientId= — whether a signed, non-withdrawn consent exists
consentApp.get("/status", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const patientId = c.req.query("patientId");
  if (!patientId) return c.json({ error: "patientId required" }, 400);

  const row = await c.env.DB.prepare(
    `SELECT id FROM consents
      WHERE patient_id = ? AND status = 'signed' AND withdrawn_at IS NULL
      LIMIT 1`
  )
    .bind(parseInt(patientId, 10))
    .first<any>();
  return c.json({ hasValidConsent: !!row, consentId: row?.id ?? null });
});

// POST /api/consent — record a signed consent (editor/admin)
consentApp.post("/", async (c: AppContext) => {
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
  const consentVersionId = parseInt(body?.consentVersionId, 10);
  if (!Number.isInteger(patientId) || patientId <= 0)
    return c.json({ error: "A valid patientId is required." }, 400);
  if (!Number.isInteger(consentVersionId) || consentVersionId <= 0)
    return c.json({ error: "A valid consentVersionId is required." }, 400);

  const version = await c.env.DB.prepare(
    "SELECT id FROM consent_versions WHERE id = ? AND retired_at IS NULL"
  )
    .bind(consentVersionId)
    .first<any>();
  if (!version) return c.json({ error: "Unknown or retired consent version." }, 400);

  const result = (await c.env.DB
    .prepare(
      `INSERT INTO consents (patient_id, consent_version_id, status, signed_by_user_id, document_object_key)
       VALUES (?, ?, 'signed', ?, ?)`
    )
    .bind(
      patientId,
      consentVersionId,
      auth.user.id,
      body?.documentObjectKey ? String(body.documentObjectKey) : null
    )
    .run()) as any;

  const id = result?.meta?.last_row_id;
  await writeAudit(c, {
    userId: auth.user.id,
    action: "consent.create",
    entity: "consent",
    entityId: id,
    detail: { patientId, consentVersionId },
  });
  return c.json({ ok: true, id }, 201);
});

// POST /api/consent/:id/withdraw — withdraw a previously signed consent
consentApp.post("/:id/withdraw", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const existing = await c.env.DB.prepare("SELECT * FROM consents WHERE id = ?")
    .bind(id)
    .first<any>();
  if (!existing) return c.json({ error: "Consent not found." }, 404);

  await c.env.DB.prepare(
    `UPDATE consents SET status = 'withdrawn', withdrawn_at = datetime('now'),
       withdrawn_reason = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(body?.reason ? String(body.reason) : null, id)
    .run();
  await writeAudit(c, {
    userId: auth.user.id,
    action: "consent.withdraw",
    entity: "consent",
    entityId: id,
    detail: { reason: body?.reason ?? null },
  });
  return c.json({ ok: true, id, status: "withdrawn" });
});

// GET /api/consent/protocols — list study protocols
consentApp.get("/protocols", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const rows = await c.env.DB.prepare(
    "SELECT id, code, title, irb_number, pi_name, status, created_at FROM study_protocols ORDER BY created_at DESC"
  ).all<any>();
  return c.json({ protocols: rows.results || [] });
});

// POST /api/consent/protocols — create a study protocol (admin only)
consentApp.post("/protocols", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Admin access required." }, 403);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!code || !title)
    return c.json({ error: "code and title are required." }, 400);

  const result = (await c.env.DB
    .prepare(
      `INSERT INTO study_protocols (code, title, irb_number, pi_name, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .bind(
      code,
      title,
      body?.irbNumber ? String(body.irbNumber) : null,
      body?.piName ? String(body.piName) : null
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, {
    userId: auth.user.id,
    action: "protocol.create",
    entity: "study_protocol",
    entityId: id,
  });
  return c.json({ ok: true, id }, 201);
});
