import type { AppContext } from "../lib/env";
import {
  getAuthUser,
  writeAudit,
  isAdmin,
  hashPassword,
  validUsername,
  strongPassword,
  parseJsonArray,
  isUniqueViolation,
} from "../lib/security";

const START_TIME = Date.now();

function publicUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name ?? null,
    email: row.email ?? null,
    role: row.role || "viewer",
    canAdminAccess: !!row.can_admin_access,
    status: row.status || "active",
    failedAttempts: row.failed_attempts ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function notify(c: AppContext, userId: number, type: string, title: string, body: string, link?: string) {
  try {
    await c.env.DB.prepare(
      `INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(userId, type, title, body, link ?? null)
      .run();
  } catch {
    /* ignore */
  }
}

export const adminHandlers = {
  // GET /api/admin/users
  LIST_USERS: async (c: AppContext) => {
    const rows = await c.env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all<any>();
    return c.json({ users: (rows.results || []).map(publicUser) });
  },

  // POST /api/admin/users  (admin creates a user directly)
  CREATE_USER: async (c: AppContext) => {
    const auth = c.get("authUser");
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
      fullName?: string;
      email?: string;
      role?: string;
      canAdminAccess?: boolean;
    };

    if (!validUsername(body.username)) {
      return c.json({ error: "Invalid username." }, 400);
    }
    const pwErr = strongPassword(body.password);
    if (pwErr) return c.json({ error: pwErr }, 400);

    const role = body.role || "viewer";
    if (!["viewer", "editor", "admin"].includes(role)) {
      return c.json({ error: "Invalid role." }, 400);
    }

    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(body.username)
      .first();
    if (existing) return c.json({ error: "Username already exists." }, 409);

    let result: any;
    try {
      result = await c.env.DB.prepare(
        `INSERT INTO users (username, password_hash, full_name, email, role, can_admin_access, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
      )
        .bind(
          body.username,
          hashPassword(body.password!),
          body.fullName || null,
          body.email || null,
          role,
          body.canAdminAccess ? 1 : 0,
          auth?.user.id ?? null
        )
        .run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "Username already exists." }, 409);
      }
      throw e;
    }

    const id = (result as any).meta?.last_row_id;
    await writeAudit(c, {
      userId: auth?.user.id,
      action: "admin.user.create",
      entity: "user",
      entityId: id,
      detail: { username: body.username, role },
    });
    return c.json({ ok: true, id }, 201);
  },

  // PATCH /api/admin/users/:id
  UPDATE_USER: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(id)) return c.json({ error: "Invalid user id" }, 400);

    const body = (await c.req.json().catch(() => ({}))) as {
      role?: string;
      canAdminAccess?: boolean;
      status?: string;
      password?: string;
    };

    const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
    if (!target) return c.json({ error: "User not found." }, 404);

    const updates: string[] = [];
    const binds: any[] = [];

    if (body.role !== undefined) {
      if (!["viewer", "editor", "admin"].includes(body.role)) {
        return c.json({ error: "Invalid role." }, 400);
      }
      updates.push("role = ?");
      binds.push(body.role);
    }
    if (body.canAdminAccess !== undefined) {
      updates.push("can_admin_access = ?");
      binds.push(body.canAdminAccess ? 1 : 0);
    }
    if (body.status !== undefined) {
      if (!["active", "pending", "suspended"].includes(body.status)) {
        return c.json({ error: "Invalid status." }, 400);
      }
      updates.push("status = ?");
      binds.push(body.status);
    }
    if (body.password) {
      const pwErr = strongPassword(body.password);
      if (pwErr) return c.json({ error: pwErr }, 400);
      updates.push("password_hash = ?");
      binds.push(hashPassword(body.password));
    }

    if (updates.length === 0) return c.json({ error: "No updates provided." }, 400);

    updates.push("updated_at = datetime('now')");
    binds.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();

    await writeAudit(c, {
      userId: auth?.user.id,
      action: "admin.user.update",
      entity: "user",
      entityId: id,
      detail: body,
    });
    return c.json({ ok: true });
  },

  // DELETE /api/admin/users/:id
  DELETE_USER: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(id)) return c.json({ error: "Invalid user id" }, 400);
    if (id === auth?.user.id) return c.json({ error: "Cannot delete yourself." }, 400);

    const target = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<any>();
    if (!target) return c.json({ error: "User not found." }, 404);

    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    await writeAudit(c, {
      userId: auth?.user.id,
      action: "admin.user.delete",
      entity: "user",
      entityId: id,
      detail: { username: target.username },
    });
    return c.json({ ok: true });
  },

  // GET /api/admin/signup-requests
  LIST_SIGNUP: async (c: AppContext) => {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM signup_requests ORDER BY created_at DESC"
    ).all<any>();
    const out = (rows.results || []).map((r: any) => ({
      id: r.id,
      username: r.username,
      fullName: r.full_name,
      email: r.email,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    }));
    return c.json({ requests: out });
  },

  // POST /api/admin/signup/:id/approve
  APPROVE_SIGNUP: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(id)) return c.json({ error: "Invalid request id" }, 400);

    const req = await c.env.DB.prepare("SELECT * FROM signup_requests WHERE id = ?").bind(id).first<any>();
    if (!req) return c.json({ error: "Request not found." }, 404);
    if (req.status !== "pending") return c.json({ error: "Already reviewed." }, 409);

    try {
      await c.env.DB.prepare(
        `INSERT INTO users (username, password_hash, full_name, email, role, can_admin_access, status, created_by)
         VALUES (?, ?, ?, ?, 'user', 0, 'active', ?)`
      )
        .bind(req.username, req.password_hash, req.full_name, req.email, auth?.user.id ?? null)
        .run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "A user with this username already exists." }, 409);
      }
      throw e;
    }

    await c.env.DB.prepare(
      `UPDATE signup_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    )
      .bind(auth?.user.id ?? null, id)
      .run();

    const newUser = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(req.username)
      .first<any>();
    if (newUser) {
      await notify(
        c,
        newUser.id,
        "signup.approved",
        "Account approved",
        `Welcome ${req.username}! Your account is now active.`,
        "/"
      );
    }

    await writeAudit(c, {
      userId: auth?.user.id,
      action: "admin.signup.approve",
      entity: "signup_request",
      entityId: id,
      detail: { username: req.username },
    });
    return c.json({ ok: true });
  },

  // POST /api/admin/signup/:id/reject
  REJECT_SIGNUP: async (c: AppContext) => {
    const auth = c.get("authUser");
    const id = parseInt(c.req.param("id") ?? "", 10);
    if (isNaN(id)) return c.json({ error: "Invalid request id" }, 400);

    const req = await c.env.DB.prepare("SELECT * FROM signup_requests WHERE id = ?").bind(id).first<any>();
    if (!req) return c.json({ error: "Request not found." }, 404);
    if (req.status !== "pending") return c.json({ error: "Already reviewed." }, 409);

    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };

    await c.env.DB.prepare(
      `UPDATE signup_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    )
      .bind(auth?.user.id ?? null, id)
      .run();

    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(req.username)
      .first<any>();
    if (existing) {
      await notify(
        c,
        existing.id,
        "signup.rejected",
        "Sign-up request rejected",
        body.reason || "Your sign-up request was not approved.",
        "/"
      );
    }

    await writeAudit(c, {
      userId: auth?.user.id,
      action: "admin.signup.reject",
      entity: "signup_request",
      entityId: id,
      detail: { username: req.username },
    });
    return c.json({ ok: true });
  },

  // POST /api/admin/backup  (admin)
  // D1 is managed/backed-up by Cloudflare; point API_BACKEND_URL at a Postgres
  // backend for the pg_dump -> S3 flow described in the plan. We expose the
  // endpoint so the System tab always resolves (rather than 404ing).
  BACKUP: async (c: AppContext) => {
    const auth = c.get("authUser") ?? (await getAuthUser(c));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
    return c.json(
      {
        ok: false,
        message:
          "Backups are handled by Cloudflare's managed D1 backups. For pg_dump → S3, set API_BACKEND_URL to a Postgres api-server.",
      },
      501
    );
  },

  // GET /api/metrics  (admin)
  METRICS: async (c: AppContext) => {
    const auth = c.get("authUser") ?? (await getAuthUser(c));
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (!isAdmin(auth.user)) return c.json({ error: "Forbidden" }, 403);
    const count = async (table: string) => {
      const r = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first<any>();
      return r?.count ?? 0;
    };
    const out = {
      users: await count("users"),
      records: await count("records"),
      recordDefinitions: await count("record_definitions"),
      feedback: await count("feedback"),
      signupRequests: await count("signup_requests"),
      notifications: await count("notifications"),
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
    };
    return c.json(out);
  },
};
