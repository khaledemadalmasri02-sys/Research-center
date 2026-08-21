import type { AppContext } from "../lib/env";
import { getCookieVal, sha256Hex, randomToken, parseJsonArray, writeAudit, isAdmin, getAuthUser } from "../lib/security";

const API_TOKEN_SCOPES = [
  "read",
  "write",
  "records:read",
  "records:write",
  "feedback:read",
  "feedback:write",
  "admin",
];

function auditRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    detail: row.detail ? safeJson(row.detail) : null,
    ip: row.ip,
    createdAt: row.created_at,
  };
}

function safeJson(v: any) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

async function listSessions(c: AppContext, userId: number) {
  const currentId = getCookieVal(c, "sessionId");
  const out: any[] = [];
  try {
    const listed = await c.env.SESSIONS.list({ prefix: "sess:" });
    for (const key of listed.keys) {
      const sessionId = key.name.replace(/^sess:/, "");
      const value = await c.env.SESSIONS.get<{ userId?: number; username?: string; role?: string; createdAt?: string }>(
        key.name,
        "json"
      );
      if (value && value.userId === userId) {
        out.push({
          id: sessionId,
          current: sessionId === currentId,
          username: value.username,
          role: value.role,
          createdAt: value.createdAt,
        });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export const platformHandlers = {
  // GET /api/audit  (admin only)
  AUDIT_GLOBAL: async (c: AppContext) => {
    const auth = c.get("authUser") ?? (await getAuthUser(c));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
    const db = c.env.DB;
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 500);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
    const action = c.req.query("action");
    const userId = c.req.query("userId");

    const clauses: string[] = [];
    const binds: any[] = [];
    if (action) { clauses.push("action = ?"); binds.push(action); }
    if (userId) { clauses.push("user_id = ?"); binds.push(parseInt(userId, 10)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const countRes = await db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
      .bind(...binds).first<any>();
    const rows = await db.prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...binds, limit, offset)
      .all<any>();
    return c.json({ logs: (rows.results || []).map(auditRow), total: countRes?.count ?? 0 });
  },

  // GET /api/audit/me  (own)
  AUDIT_ME: async (c: AppContext) => {
    const auth = c.get("authUser");
    const db = c.env.DB;
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 500);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
    const countRes = await db.prepare("SELECT COUNT(*) as count FROM audit_log WHERE user_id = ?")
      .bind(auth!.user.id).first<any>();
    const rows = await db.prepare(
      "SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
      .bind(auth!.user.id, limit, offset)
      .all<any>();
    return c.json({ logs: (rows.results || []).map(auditRow), total: countRes?.count ?? 0 });
  },

  // ---- API tokens ----
  CREATE_TOKEN: async (c: AppContext) => {
    const auth = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; scopes?: string[] };
    if (!body.name || !body.name.trim()) return c.json({ error: "name required." }, 400);
    const scopes = Array.isArray(body.scopes) ? body.scopes : [];
    for (const s of scopes) {
      if (!API_TOKEN_SCOPES.includes(s)) return c.json({ error: `Invalid scope: ${s}` }, 400);
    }
    const plaintext = randomToken(32);
    const tokenHash = await sha256Hex(plaintext);
    const res = await c.env.DB.prepare(
      "INSERT INTO api_tokens (user_id, name, token_hash, scopes) VALUES (?, ?, ?, ?)"
    )
      .bind(auth!.user.id, body.name.trim(), tokenHash, JSON.stringify(scopes))
      .run();
    const id = (res as any).meta?.last_row_id;
    await writeAudit(c, { userId: auth!.user.id, action: "tokens.create", entity: "api_token", entityId: id });
    // Plaintext is returned exactly once.
    return c.json({ id, name: body.name, token: plaintext, scopes, createdAt: new Date().toISOString() }, 201);
  },

  LIST_TOKENS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const rows = await c.env.DB.prepare(
      "SELECT id, name, scopes, last_used_at, created_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
    )
      .bind(auth!.user.id)
      .all<any>();
    return c.json({
      tokens: (rows.results || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        scopes: parseJsonArray(t.scopes),
        lastUsedAt: t.last_used_at,
        createdAt: t.created_at,
        revokedAt: t.revoked_at,
      })),
    });
  },

  REVOKE_TOKEN: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = await c.env.DB.prepare("SELECT * FROM api_tokens WHERE id = ? AND user_id = ?")
      .bind(id, auth!.user.id)
      .first<any>();
    if (!row) return c.json({ error: "Not found." }, 404);
    await c.env.DB.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(id).run();
    await writeAudit(c, { userId: auth!.user.id, action: "tokens.revoke", entity: "api_token", entityId: id });
    return c.json({ ok: true });
  },

  // ---- Notifications ----
  LIST_NOTIFICATIONS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const rows = await c.env.DB.prepare(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY read ASC, created_at DESC LIMIT 100"
    )
      .bind(auth!.user.id)
      .all<any>();
    return c.json({
      notifications: (rows.results || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: !!n.read,
        createdAt: n.created_at,
      })),
    });
  },

  READ_NOTIFICATION: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    await c.env.DB.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
      .bind(id, auth!.user.id)
      .run();
    return c.json({ ok: true });
  },

  READ_ALL_NOTIFICATIONS: async (c: AppContext) => {
    const auth = c.get("authUser");
    await c.env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?")
      .bind(auth!.user.id)
      .run();
    return c.json({ ok: true });
  },

  // ---- Sessions ----
  LIST_SESSIONS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const sessions = await listSessions(c, auth!.user.id);
    return c.json({ sessions });
  },

  REVOKE_SESSION: async (c: AppContext) => {
    const auth = c.get("authUser");
    const sid = c.req.param("sid");
    const currentId = getCookieVal(c, "sessionId");
    if (sid === currentId) return c.json({ error: "Cannot revoke current session." }, 400);
    const value = await c.env.SESSIONS.get<{ userId?: number }>(`sess:${sid}`, "json");
    if (!value || value.userId !== auth!.user.id) return c.json({ error: "Not found." }, 404);
    await c.env.SESSIONS.delete(`sess:${sid}`);
    return c.json({ ok: true });
  },

  REVOKE_OTHER_SESSIONS: async (c: AppContext) => {
    const auth = c.get("authUser");
    const currentId = getCookieVal(c, "sessionId");
    const sessions = await listSessions(c, auth!.user.id);
    for (const s of sessions) {
      if (!s.current && s.id !== currentId) await c.env.SESSIONS.delete(`sess:${s.id}`);
    }
    return c.json({ ok: true });
  },
};
