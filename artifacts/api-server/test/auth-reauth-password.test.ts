// TASK 4 + TASK 5 — step-up re-authentication, in-session password change,
// progressive login lockout, and the machine-readable `code` contract.

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { randomBytes, createHmac } from "crypto";
import { withDb, type DbFixture } from "./helpers/db";
import { __resetRateLimits } from "../src/lib/security";

vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async () => true),
}));

const STRONG = "StepUp12345!x";
const OTHER = "AnotherPass9!y";

/**
 * Seed a session row directly and return the `rc_sid` cookie value that
 * addresses it.
 *
 * Needed for accounts the normal login flow cannot reach: an SSO-created user
 * has a placeholder password hash, so no password (right or wrong) can produce
 * a session, yet the session itself is real.
 *
 * The cookie format is express-session's: `s:<sid>.<base64 HMAC-SHA256 of the
 * sid keyed with SESSION_SECRET, padding stripped>` — i.e. cookie-signature.
 */
async function seedSession(
  t: DbFixture,
  userId: number,
  username: string,
  fields: Record<string, unknown> = {},
): Promise<{ sid: string; cookie: string }> {
  const sid = `seed-${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  const sess = {
    authenticated: true,
    userId,
    username,
    role: "editor",
    canAdminAccess: false,
    createdAt: now,
    lastActivityAt: now,
    // express-session reads `sess.cookie.expires` when it re-creates the
    // session's own view of it, so a hand-written row has to carry one.
    cookie: {
      originalMaxAge: 30 * 60 * 1000,
      expires: new Date(now + 30 * 60 * 1000).toISOString(),
      secure: false,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    },
    ...fields,
  };
  await t.pool.query(
    `INSERT INTO "session" ("sid", "sess", "expire") VALUES ($1, $2::json, NOW() + INTERVAL '2 hours')`,
    [sid, JSON.stringify(sess)],
  );
  const secret = process.env.SESSION_SECRET ?? "dev-secret-change-me";
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return { sid, cookie: `rc_sid=s:${sid}.${sig}` };
}

describe("POST /auth/reauth", () => {
  const t: DbFixture = withDb();

  it("requires an authenticated session", async () => {
    const res = await request(t.app).post("/api/auth/reauth").send({ password: STRONG });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("requires the current password", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const missing = await agent.post("/api/auth/reauth").send({});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("AUTH_FIELD_REQUIRED");

    const wrong = await agent.post("/api/auth/reauth").send({ password: "Nope1234!aaa" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(wrong.body.error).toBe("Invalid credentials.");
  });

  it("records reauthenticatedAt and unlocks the destructive routes", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);

    // Locked before.
    expect((await agent.post("/api/auth/mfa/enroll")).status).toBe(403);
    expect((await agent.post("/api/auth/password/change")).status).toBe(403);

    const res = await agent.post("/api/auth/reauth").send({ password: STRONG });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(new Date(res.body.reauthenticatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.expiresInSec).toBe(600);

    expect((await agent.post("/api/auth/mfa/enroll")).status).toBe(200);
  });

  it("records success and failure in the audit trail", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: "Wrong1234!aa" });
    await agent.post("/api/auth/reauth").send({ password: STRONG });

    const { rows } = await t.pool.query<{ action: string; user_id: number }>(
      `SELECT "action", "user_id" FROM "audit_log" WHERE "action" LIKE 'auth.reauth.%' ORDER BY "id"`,
    );
    expect(rows.map((r) => r.action)).toEqual(["auth.reauth.failure", "auth.reauth.success"]);
    expect(rows.every((r) => r.user_id === userId)).toBe(true);
  });

  it("does NOT count reauth failures towards the account lockout", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    for (let i = 0; i < 4; i++) {
      await agent.post("/api/auth/reauth").send({ password: "Wrong1234!aa" });
    }
    const { rows } = await t.pool.query<{ failed_attempts: number }>(
      `SELECT "failed_attempts" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    // Otherwise anyone holding a stolen session could lock the account out of
    // the very control they lack.
    expect(rows[0]!.failed_attempts).toBe(0);
  });

  it("rate-limits per user", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    let saw429 = false;
    for (let i = 0; i < 8; i++) {
      const res = await agent.post("/api/auth/reauth").send({ password: "Wrong1234!aa" });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.code).toBe("AUTH_RATE_LIMITED");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        expect(res.headers["retry-after"]).toBeDefined();
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it("explains that an SSO-only account cannot confirm a password", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    // An OAuth-created account carries the placeholder hash (see auth.ts), so
    // no password can ever verify for it and re-auth is impossible.
    await t.pool.query(
      `UPDATE "users" SET "password_hash" = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYh2dQHP8DjL0eW' WHERE "id" = $1`,
      [userId],
    );
    const seeded = await seedSession(t, userId, "alice");
    const res = await request(t.app)
      .post("/api/auth/reauth")
      .set("Cookie", seeded.cookie)
      .send({ password: STRONG });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_OAUTH_LINK_REQUIRED");
    expect(res.body.error).toMatch(/single sign-on/i);
  });
});

describe("POST /auth/password/change", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({ username: "alice", password: STRONG });
  });

  async function reauthedAgent(): Promise<Awaited<ReturnType<DbFixture["loginAs"]>>> {
    const agent = await t.loginAs("alice", STRONG);
    const reauth = await agent.post("/api/auth/reauth").send({ password: STRONG });
    expect(reauth.status).toBe(200);
    return agent;
  }

  it("requires a recent re-authentication", async () => {
    const agent = await t.loginAs("alice", STRONG);
    const res = await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: OTHER });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_REAUTH_REQUIRED");
    // The old password still works, i.e. nothing changed.
    expect((await t.loginAs("alice", STRONG)).get).toBeTruthy();
  });

  it("requires an authenticated session", async () => {
    const res = await request(t.app)
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: OTHER });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("changes the password, logs other devices out, and keeps the caller in", async () => {
    const agent = await reauthedAgent();
    const otherDevice = await t.loginAs("alice", STRONG);

    const res = await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: OTHER });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionsRevoked).toBe(1);

    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect((await otherDevice.get("/api/auth/me")).status).toBe(401);

    const login = await request(t.app).post("/api/auth/login").send({ username: "alice", password: OTHER });
    expect(login.status).toBe(200);
    const oldLogin = await request(t.app).post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(oldLogin.status).toBe(401);
  });

  it("refuses a wrong current password", async () => {
    const agent = await reauthedAgent();
    const res = await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: "Wrong1234!aa", newPassword: OTHER });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("enforces the password policy", async () => {
    const agent = await reauthedAgent();
    const res = await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: "weak" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_PASSWORD_WEAK");
  });

  it("refuses to reuse the current password", async () => {
    const agent = await reauthedAgent();
    const res = await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: STRONG });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_PASSWORD_WEAK");
    expect(res.body.error).toMatch(/different/i);
  });

  it("requires both fields", async () => {
    const agent = await reauthedAgent();
    for (const body of [{}, { currentPassword: STRONG }, { newPassword: OTHER }]) {
      const res = await agent.post("/api/auth/password/change").send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("AUTH_FIELD_REQUIRED");
    }
  });

  it("rate-limits", async () => {
    const agent = await reauthedAgent();
    let saw429 = false;
    for (let i = 0; i < 8; i++) {
      const res = await agent
        .post("/api/auth/password/change")
        .send({ currentPassword: "Wrong1234!aa", newPassword: OTHER });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.code).toBe("AUTH_RATE_LIMITED");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it("audits the change", async () => {
    const agent = await reauthedAgent();
    await agent
      .post("/api/auth/password/change")
      .send({ currentPassword: STRONG, newPassword: OTHER });
    const { rows } = await t.pool.query<{ action: string; detail: Record<string, unknown> }>(
      `SELECT "action", "detail" FROM "audit_log" WHERE "action" = 'auth.password.changed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toHaveProperty("revokedSessions");
  });
});

describe("login lockout", () => {
  const t: DbFixture = withDb();

  it("escalates the lock instead of serving a flat 15 minutes", async () => {
    __resetRateLimits();
    await t.createUser({ username: "alice", password: STRONG });

    // First lockout: ~1 minute.
    for (let i = 0; i < 5; i++) {
      await request(t.app).post("/api/auth/login").send({ username: "alice", password: "wrong1" });
    }
    const first = await t.pool.query<{ ms: number }>(
      `SELECT EXTRACT(EPOCH FROM ("locked_until" - now())) * 1000 AS ms FROM "users" WHERE "username" = 'alice'`,
    );
    expect(Number(first.rows[0]!.ms)).toBeGreaterThan(30_000);
    expect(Number(first.rows[0]!.ms)).toBeLessThanOrEqual(60_000);

    // Let the lock expire, trip it again without a successful login in between
    // (which would clear failed_attempts), and the window must grow.
    await t.pool.query(`UPDATE "users" SET "locked_until" = NULL WHERE "username" = 'alice'`);
    // The per-IP login budget (10 / 15 min) was spent by the first round; it is
    // not what this test is measuring.
    __resetRateLimits();
    for (let i = 0; i < 5; i++) {
      // Each round-trip would otherwise re-lock the account on its first
      // attempt and the streak could never reach 10.
      await t.pool.query(`UPDATE "users" SET "locked_until" = NULL WHERE "username" = 'alice'`);
      await request(t.app).post("/api/auth/login").send({ username: "alice", password: "wrong1" });
    }
    const second = await t.pool.query<{ ms: number; attempts: number }>(
      `SELECT EXTRACT(EPOCH FROM ("locked_until" - now())) * 1000 AS ms, "failed_attempts" AS attempts
         FROM "users" WHERE "username" = 'alice'`,
    );
    expect(second.rows[0]!.attempts).toBe(10);
    expect(Number(second.rows[0]!.ms)).toBeGreaterThan(4 * 60_000);
    expect(Number(second.rows[0]!.ms)).toBeLessThanOrEqual(5 * 60_000);
  });

  it("returns retryAfterSec on the locked response so the client can count down", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    for (let i = 0; i < 5; i++) {
      await request(t.app).post("/api/auth/login").send({ username: "alice", password: "wrong1" });
    }
    const res = await request(t.app).post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AUTH_ACCOUNT_LOCKED");
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
    expect(res.body.retryAfterSec).toBeLessThanOrEqual(60);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("returns retryAfterSec on the per-IP rate limit", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(t.app).post("/api/auth/login").send({ username: "alice", password: "wrong1" });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.code).toBe("AUTH_RATE_LIMITED");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        expect(res.body.error).toMatch(/Too many attempts/);
        break;
      }
    }
    expect(saw429).toBe(true);
  });

  it("keeps the pending/suspended statuses at 403 and adds the code", async () => {
    await t.createUser({ username: "pend", password: STRONG, status: "pending" });
    await t.createUser({ username: "susp", password: STRONG, status: "suspended" });
    const pending = await request(t.app).post("/api/auth/login").send({ username: "pend", password: STRONG });
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe("AUTH_ACCOUNT_PENDING");
    const suspended = await request(t.app).post("/api/auth/login").send({ username: "susp", password: STRONG });
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe("AUTH_ACCOUNT_SUSPENDED");
  });
});

describe("error `code` contract", () => {
  const t: DbFixture = withDb();

  /**
   * Every error body emitted from auth.ts / sessions.ts carries a machine
   * readable `code`. This walks the reachable failure paths and asserts the
   * specific value, because a frontend is now branching on it.
   */
  it("covers every reachable auth failure", async () => {
    await t.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    await t.createUser({ username: "nopass", password: STRONG });

    const seen = new Map<string, number>();

    async function record(res: { status: number; body: Record<string, unknown> }, expected: string) {
      expect(res.status, `${expected} status`).toBeGreaterThanOrEqual(400);
      expect(res.body.code, `expected ${expected}, got ${JSON.stringify(res.body)}`).toBe(expected);
      expect(typeof res.body.error).toBe("string");
      seen.set(expected, (seen.get(expected) ?? 0) + 1);
      if (res.status === 429) {
        expect(typeof res.body.retryAfterSec).toBe("number");
        expect(res.body.retryAfterSec as number).toBeGreaterThan(0);
        expect(res.headers["retry-after"]).toBeDefined();
      }
    }

    await record(
      await request(t.app).post("/api/auth/login").send({ username: "alice" }),
      "AUTH_FIELD_REQUIRED",
    );
    await record(
      await request(t.app).post("/api/auth/login").send({ username: "ghost", password: "x" }),
      "AUTH_INVALID_CREDENTIALS",
    );
    await record(
      await request(t.app).post("/api/auth/login").send({ username: "alice", password: "wrong1" }),
      "AUTH_INVALID_CREDENTIALS",
    );
    await record(
      await request(t.app).get("/api/patients"),
      "AUTH_SESSION_EXPIRED",
    );
    // `/auth/me` with no session at all is NOT an expired session: it answers
    // `{authenticated:false}` with no code (nothing to re-authenticate). The
    // expired case is covered in auth-sessions.test.ts.
    const anonymousMe = await request(t.app).get("/api/auth/me");
    expect(anonymousMe.status).toBe(401);
    expect(anonymousMe.body).toEqual({ authenticated: false });
    await record(
      await request(t.app).get("/api/sessions"),
      "AUTH_SESSION_EXPIRED",
    );
    await record(
      await request(t.app).post("/api/auth/mfa/verify").send({}),
      "AUTH_FIELD_REQUIRED",
    );
    await record(
      await request(t.app).post("/api/auth/password-reset/request").send({}),
      "AUTH_FIELD_REQUIRED",
    );
    await record(
      await request(t.app).post("/api/auth/password-reset/confirm").send({ password: "NewPass12!x" }),
      "AUTH_FIELD_REQUIRED",
    );
    await record(
      await request(t.app).post("/api/auth/password-reset/confirm").send({ token: "a".repeat(64), password: "NewPass12!x" }),
      "AUTH_RESET_TOKEN_INVALID",
    );
    await record(
      await request(t.app).post("/api/auth/signup").send({ username: "x", password: "weak" }),
      "AUTH_EMAIL_INVALID",
    );
    await record(
      await request(t.app).post("/api/auth/signup").send({ username: "xy", password: "Weak12345!x", email: "a@b.co" }),
      "AUTH_FIELD_REQUIRED",
    );
    await record(
      await request(t.app).post("/api/auth/signup").send({ username: "alice", password: "Weak12345!xyz", email: "a@b.co" }),
      "AUTH_USERNAME_TAKEN",
    );

    // Authenticated failures.
    const agent = await t.loginAs("nopass", STRONG);
    await record(await agent.post("/api/auth/mfa/enroll"), "AUTH_REAUTH_REQUIRED");
    await record(await agent.post("/api/auth/password/change").send({}), "AUTH_REAUTH_REQUIRED");
    await record(await agent.post("/api/auth/reauth").send({}), "AUTH_FIELD_REQUIRED");
    await record(await agent.post("/api/auth/reauth").send({ password: "nope1234!aa" }), "AUTH_INVALID_CREDENTIALS");
    await record(
      await agent.post("/api/auth/password/change").send({ currentPassword: "nope1234!aa", newPassword: OTHER }),
      "AUTH_REAUTH_REQUIRED",
    );
    await record(await agent.delete(`/api/sessions/${"0".repeat(16)}`), "AUTH_SESSION_REVOKED");
    await record(await agent.post("/api/sessions/revoke-others"), "AUTH_REAUTH_REQUIRED");

    // …and the re-authenticated ones.
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    await record(
      await agent.post("/api/auth/password/change").send({ currentPassword: "nope1234!aa", newPassword: OTHER }),
      "AUTH_INVALID_CREDENTIALS",
    );
    await record(
      await agent.post("/api/auth/password/change").send({ currentPassword: STRONG, newPassword: "short" }),
      "AUTH_PASSWORD_WEAK",
    );
    await record(await agent.post("/api/auth/mfa/enroll/confirm").send({ code: "123456" }), "AUTH_TOTP_NOT_CONFIGURED");
    await record(await agent.post("/api/auth/mfa/disable"), "AUTH_MFA_NOT_ENROLLED");
    await record(await agent.post("/api/auth/mfa/recovery/regenerate"), "AUTH_MFA_NOT_ENROLLED");

    // 11 distinct codes reached here; the MFA-specific ones (TOTP_ALREADY_SET,
    // MFA_NOT_ENROLLED via /auth/mfa/verify, ACCOUNT_LOCKED, RATE_LIMITED) are
    // covered by the suites above.
    expect(seen.size).toBeGreaterThanOrEqual(11);
  });

  it("covers the reset-token codes", async () => {
    const token = "c".repeat(64);
    const invalid = await request(t.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "ResetMe12!ab" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("AUTH_RESET_TOKEN_INVALID");

    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const req = await request(t.app).post("/api/auth/password-reset/request").send({ email: "a@b.co" });
    expect(req.status).toBe(200);

    // Weak password on a valid token is only reachable with a real token, which
    // the other suite covers; here we pin the code for the invalid-token path.
    expect(invalid.body.code).toBe("AUTH_RESET_TOKEN_INVALID");
  });

  it("adds the code to requireAuth without changing its error string", async () => {
    const res = await request(t.app).get("/api/notifications");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });
});