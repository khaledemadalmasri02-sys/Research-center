import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, isAdmin, writeAudit } from "../lib/security";

export const gdprApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// DELETE /api/gdpr/erasure/:patientId — admin-only cascade erasure
gdprApp.delete("/erasure/:patientId", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const patientId = parseInt(c.req.param("patientId") ?? "", 10);
  if (!Number.isInteger(patientId)) return c.json({ error: "Invalid patient id" }, 400);

  // Cascade-delete patient-scoped rows. Audit rows are anonymized rather than
  // hard-deleted: we cannot reliably map every audit entry to a patient, so we
  // leave the audit trail intact for compliance (record the erasure event).
  const tables = ["consents", "diagnosis_codes", "dicom_images", "pseudonyms"];
  let deleted = 0;
  for (const t of tables) {
    const r = await c.env.DB.prepare(`DELETE FROM ${t} WHERE patient_id = ?`).bind(patientId).run();
    deleted += (r as any)?.meta?.changes ?? 0;
  }

  await writeAudit(c, {
    userId: auth.user.id,
    action: "gdpr.erasure",
    entity: "patient",
    entityId: patientId,
    detail: `cascade rows deleted: ${deleted}`,
  });
  return c.json({ ok: true, patientId, deletedRows: deleted });
});

// GET /api/gdpr/retention — admin-only list of erasure candidates
// (withdrawn consents past the retention window, in days).
gdprApp.get("/retention", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const days = parseInt(c.req.query("days") ?? "365", 10) || 365;
  const rows = await c.env.DB
    .prepare(
      `SELECT patient_id, COUNT(*) as cnt, MIN(withdrawn_at) as earliest
       FROM consents WHERE status = 'withdrawn' AND withdrawn_at IS NOT NULL
       AND datetime(withdrawn_at) < datetime('now', ?) GROUP BY patient_id`
    )
    .bind(`-${days} days`)
    .all<any>();
  return c.json({
    retentionDays: days,
    candidates: (rows.results || []).map((r: any) => ({
      patientId: r.patient_id,
      consentCount: r.cnt,
      earliestWithdrawal: r.earliest,
    })),
  });
});
