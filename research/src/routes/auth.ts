import type { AppContext } from "../lib/env";
import {
  getAuthUser,
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  getClientIp,
  writeAudit,
  isAccountLocked,
  recordAccountFailure,
  resetAccountFailures,
  bumpIpFailure,
  resetIpFailures,
  getIpFailures,
  validUsername,
  strongPassword,
} from "../lib/security";

const SIGNUP_RATE_LIMIT = 10; // per IP per 10 min

export const authHandlers = {
  // POST /api/auth/signup  ->  creates a PENDING signup request (admin approval)
  SIGNUP: async (c: AppContext) => {
    try {
      const ip = getClientIp(c);
      const failures = await getIpFailures(c, `signup:${ip}`);
      if (failures >= SIGNUP_RATE_LIMIT) {
        return c.json({ error: "Too many sign-up attempts. Try again later." }, 429);
      }

      const body = (await c.req.json().catch(() => ({}))) as {
        username?: string;
        password?: string;
        fullName?: string;
        email?: string;
        reason?: string;
      };

      if (!validUsername(body.username)) {
        return c.json({ error: "Username must be 3-64 chars (letters, numbers, . _ -)." }, 400);
      }
      const pwErr = strongPassword(body.password);
      if (pwErr) return c.json({ error: pwErr }, 400);

      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
        .bind(body.username)
        .first();
      if (existing) return c.json({ error: "Username already taken." }, 409);

      const existingReq = await c.env.DB.prepare(
        "SELECT id FROM signup_requests WHERE username = ? AND status = 'pending'"
      )
        .bind(body.username)
        .first();
      if (existingReq) return c.json({ error: "A pending request already exists." }, 409);

      await c.env.DB.prepare(
        `INSERT INTO signup_requests (username, password_hash, full_name, email, reason, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      )
        .bind(
          body.username,
          hashPassword(body.password!),
          body.fullName || null,
          body.email || null,
          body.reason || null
        )
        .run();

      await writeAudit(c, {
        action: "auth.signup.request",
        entity: "signup_request",
        detail: { username: body.username },
        ip,
      });

      return c.json({ ok: true, pending: true, message: "Your request is awaiting admin approval." }, 201);
    } catch (error) {
      console.error("Signup error:", error);
      return c.json({ error: "Failed to process sign-up." }, 500);
    }
  },

  // POST /api/auth/login
  LOGIN: async (c: AppContext) => {
    try {
      const ip = getClientIp(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        username?: string;
        password?: string;
      };

      if (!body.username || !body.password) {
        return c.json({ error: "Username and password are required." }, 400);
      }

      const ipFailures = await getIpFailures(c, ip);
      if (ipFailures >= 50) {
        return c.json({ error: "Too many attempts. Try again later." }, 429);
      }

      const user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
        .bind(body.username)
        .first<any>();
      if (!user) {
        await bumpIpFailure(c, ip);
        return c.json({ error: "Invalid credentials." }, 401);
      }

      if (isAccountLocked(user)) {
        return c.json({ error: "Account temporarily locked. Try again later." }, 423);
      }

      if (!verifyPassword(body.password, user.password_hash)) {
        await recordAccountFailure(c, user.id);
        await bumpIpFailure(c, ip);
        return c.json({ error: "Invalid credentials." }, 401);
      }

      if (user.status !== "active") {
        return c.json(
          { error: user.status === "suspended" ? "Account suspended." : "Account not active yet." },
          403
        );
      }

      await resetAccountFailures(c, user.id);
      await resetIpFailures(c, ip);

      const authUser = {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        canAdminAccess: !!user.can_admin_access,
        status: user.status,
      };
      await createSession(c, authUser);
      await writeAudit(c, { userId: user.id, action: "auth.login", entity: "user", entityId: user.id, ip });

      return c.json({
        ok: true,
        username: authUser.username,
        role: authUser.role,
        canAdminAccess: authUser.canAdminAccess,
        id: authUser.id,
      });
    } catch (error) {
      console.error("Login error:", error);
      return c.json({ error: "Failed to log in." }, 500);
    }
  },

  // POST /api/auth/logout
  LOGOUT: async (c: AppContext) => {
    const auth = await getAuthUser(c);
    if (auth) {
      await writeAudit(c, { userId: auth.user.id, action: "auth.logout", entity: "user", entityId: auth.user.id });
    }
    await destroySession(c);
    return c.json({ ok: true });
  },

  // GET /api/auth/me
  ME: async (c: AppContext) => {
    const auth = await getAuthUser(c);
    if (!auth) return c.json({ authenticated: false }, 401);
    return c.json({
      authenticated: true,
      id: auth.user.id,
      username: auth.user.username,
      fullName: auth.user.username ? auth.user.fullName : null,
      email: auth.user.email,
      role: auth.user.role,
      canAdminAccess: auth.user.canAdminAccess,
      status: auth.user.status,
    });
  },
};
