import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, isAdmin } from "../lib/security";

export const auditApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/audit — global timeline (admin only), paginated + filters
auditApp.get("/", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const action = c.req.query("action");
  const userId = c.req.query("userId");

  const where: string[] = [];
  const binds: any[] = [];
  if (action) {
    where.push("action = ?");
    binds.push(action);
  }
  if (userId) {
    where.push("user_id = ?");
    binds.push(parseInt(userId, 10));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await c.env.DB
    .prepare(`SELECT * FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<any>();
  return c.json({ entries: (rows.results || []).map(normalize) });
});

// GET /api/audit/me — own timeline (any authenticated user)
auditApp.get("/me", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const rows = await c.env.DB
    .prepare("SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .bind(auth.user.id, limit, offset)
    .all<any>();
  return c.json({ entries: (rows.results || []).map(normalize) });
});

function normalize(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    detail: typeof r.detail === "string" ? safeJson(r.detail) : r.detail,
    ip: r.ip,
    createdAt: r.created_at,
  };
}

function safeJson(v: any) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
