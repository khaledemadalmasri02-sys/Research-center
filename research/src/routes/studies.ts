import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

export const studiesApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/studies — list studies with enrollment totals (auth)
studiesApp.get("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const studies = await c.env.DB.prepare("SELECT * FROM studies ORDER BY created_at DESC").all<any>();
  const sitesRows = await c.env.DB.prepare("SELECT study_id, SUM(enrollment_count) as enrolled, COUNT(*) as site_count FROM sites GROUP BY study_id").all<any>();
  const byStudy: Record<number, any> = {};
  for (const s of sitesRows.results || []) byStudy[s.study_id] = s;
  const list = (studies.results || []).map((st: any) => ({
    id: st.id,
    code: st.code,
    title: st.title,
    irbNumber: st.irb_number,
    status: st.status,
    enrollmentTarget: st.enrollment_target,
    enrolled: byStudy[st.id]?.enrolled || 0,
    siteCount: byStudy[st.id]?.site_count || 0,
  }));
  return c.json({ studies: list });
});

// POST /api/studies — create a study (editor+)
studiesApp.post("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!code || !title) return c.json({ error: "code and title are required." }, 400);
  const result = (await c.env.DB
    .prepare("INSERT INTO studies (code, title, irb_number, status, enrollment_target) VALUES (?, ?, ?, ?, ?)")
    .bind(code, title, body?.irbNumber ?? null, body?.status ?? "active", Number(body?.enrollmentTarget) || 0)
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "study.create", entity: "study", entityId: id });
  return c.json({ ok: true, id }, 201);
});

// POST /api/studies/:id/sites — add a site (editor+)
studiesApp.post("/:id/sites", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const studyId = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(studyId)) return c.json({ error: "Invalid study id" }, 400);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "site name is required." }, 400);
  const result = (await c.env.DB
    .prepare("INSERT INTO sites (study_id, name, country, pi_user_id, enrollment_count) VALUES (?, ?, ?, ?, ?)")
    .bind(studyId, name, body?.country ?? null, body?.piUserId ?? null, Number(body?.enrollmentCount) || 0)
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "study.site.create", entity: "site", entityId: id });
  return c.json({ ok: true, id }, 201);
});

// GET /api/studies/:id/arms — list arms (auth)
studiesApp.get("/:id/arms", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const studyId = parseInt(c.req.param("id") ?? "", 10);
  const rows = await c.env.DB.prepare("SELECT * FROM study_arms WHERE study_id = ? ORDER BY id").bind(studyId).all<any>();
  return c.json({ arms: (rows.results || []).map((r: any) => ({ id: r.id, name: r.name })) });
});

// POST /api/studies/:id/arms — create an arm (editor+)
studiesApp.post("/:id/arms", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const studyId = parseInt(c.req.param("id") ?? "", 10);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "arm name is required." }, 400);
  const result = (await c.env.DB.prepare("INSERT INTO study_arms (study_id, name) VALUES (?, ?)").bind(studyId, name).run()) as any;
  return c.json({ ok: true, id: result?.meta?.last_row_id }, 201);
});

// POST /api/studies/:id/record-events — attach a record to an event/arm (editor+)
studiesApp.post("/:id/record-events", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const recordId = parseInt(body?.recordId, 10);
  if (!Number.isInteger(recordId)) return c.json({ error: "recordId is required." }, 400);
  const armId = body?.armId != null ? parseInt(body.armId, 10) : null;
  const result = (await c.env.DB
    .prepare(
      "INSERT INTO record_events (record_id, event, arm_id, repeat_instance, completed_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(recordId, body?.event ?? null, armId, Number(body?.repeatInstance) || 1, body?.completedAt ?? null)
    .run()) as any;
  await writeAudit(c, { userId: auth.user.id, action: "study.record_event.create", entity: "record_event", entityId: recordId });
  return c.json({ ok: true, id: result?.meta?.last_row_id }, 201);
});

// GET /api/studies/:id/dashboard — enrollment vs target + per-site (auth)
studiesApp.get("/:id/dashboard", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const studyId = parseInt(c.req.param("id") ?? "", 10);
  const study = await c.env.DB.prepare("SELECT * FROM studies WHERE id = ?").bind(studyId).first<any>();
  if (!study) return c.json({ error: "Not found" }, 404);
  const sites = await c.env.DB.prepare("SELECT id, name, country, enrollment_count FROM sites WHERE study_id = ? ORDER BY id").bind(studyId).all<any>();
  const total = (sites.results || []).reduce((acc: number, s: any) => acc + (s.enrollment_count || 0), 0);
  return c.json({
    study: { id: study.id, code: study.code, title: study.title, target: study.enrollment_target },
    enrolled: total,
    remaining: Math.max(0, study.enrollment_target - total),
    sites: (sites.results || []).map((s: any) => ({ id: s.id, name: s.name, country: s.country, enrolled: s.enrollment_count })),
  });
});
