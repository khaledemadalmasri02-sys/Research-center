// TASK 1 — password recovery.
//
// Focus: anti-enumeration, single-use race-freedom, session revocation on a
// successful reset, and the `code` field on every failure path.

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push({ to: input.to, subject: input.subject, text: input.text });
    return true;
  }),
}));

const STRONG = "ResetFlow1!Pass";

/** Pull the reset token out of the mocked email. */
function tokenFromEmail(index = 0): string {
  const mail = sentEmails[index];
  if (!mail) throw new Error(`No email at index ${index} (have ${sentEmails.length})`);
  const m = /token=([0-9a-f]{64})/.exec(mail.text);
  if (!m) throw new Error(`No reset token in email: ${mail.text.slice(0, 300)}`);
  return m[1]!;
}

async function requestReset(
  t: DbFixture,
  identifier: string,
  key: "email" | "username" = "email",
) {
  return request(t.app).post("/api/auth/password-reset/request").send({ [key]: identifier });
}

describe("password recovery — request", () => {
  const t0: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it("sends a token to a known email and answers neutrally", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const res = await requestReset(t0, "alice@example.com");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/if an account exists/i);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("alice@example.com");
    expect(tokenFromEmail()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts the SPA's { identifier } field as well as email / username", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const byIdentifier = await request(t0.app)
      .post("/api/auth/password-reset/request")
      .send({ identifier: "alice@example.com" });
    expect(byIdentifier.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(tokenFromEmail()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a username as well as an email", async () => {
    await t0.createUser({ username: "bob", password: STRONG, email: "bob@example.com" });
    const res = await requestReset(t0, "bob", "username");
    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
  });

  it("never echoes the token back unless dev-token mode is explicitly enabled", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const prod = await request(t0.app)
      .post("/api/auth/password-reset/request")
      .send({ identifier: "alice@example.com" });
    expect(prod.body.token).toBeUndefined();

    const saved = process.env.PASSWORD_RESET_DEV_TOKEN;
    const savedEnv = process.env.NODE_ENV;
    try {
      process.env.PASSWORD_RESET_DEV_TOKEN = "true";
      const dev = await request(t0.app)
        .post("/api/auth/password-reset/request")
        .send({ identifier: "alice@example.com" });
      expect(dev.body.token).toMatch(/^[0-9a-f]{64}$/);
      expect(dev.body.expiresInSec).toBe(1800);

      // ...but production can never be talked into it.
      process.env.NODE_ENV = "production";
      const prodRes = await request(t0.app)
        .post("/api/auth/password-reset/request")
        .send({ identifier: "alice@example.com" });
      expect(prodRes.body.token).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.PASSWORD_RESET_DEV_TOKEN;
      else process.env.PASSWORD_RESET_DEV_TOKEN = saved;
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
    }
  });

  it("matches the email case-insensitively", async () => {
    await t0.createUser({ username: "carol", password: STRONG, email: "carol@example.com" });
    const res = await requestReset(t0, "CAROL@Example.COM");
    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
  });

  it("answers BYTE-IDENTICALLY for an account that does not exist", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const real = await requestReset(t0, "alice@example.com");
    const fake = await requestReset(t0, "ghost@example.com");
    expect(fake.status).toBe(real.status);
    expect(fake.body).toEqual(real.body);
    expect(sentEmails).toHaveLength(1);
  });

  it("answers identically for a suspended / pending / email-less account and sends nothing", async () => {
    await t0.createUser({ username: "susp", password: STRONG, email: "susp@example.com", status: "suspended" });
    await t0.createUser({ username: "pend", password: STRONG, email: "pend@example.com", status: "pending" });
    await t0.createUser({ username: "noemail", password: STRONG });

    const real = await requestReset(t0, "alice-nobody@example.com");
    for (const id of ["susp@example.com", "pend@example.com"]) {
      const res = await requestReset(t0, id);
      expect(res.status, id).toBe(real.status);
      expect(res.body, id).toEqual(real.body);
    }
    const byUsername = await requestReset(t0, "noemail", "username");
    expect(byUsername.status).toBe(real.status);
    expect(byUsername.body).toEqual(real.body);
    expect(sentEmails).toHaveLength(0);
  });

  it("audits the two outcomes distinctly", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    await requestReset(t0, "alice@example.com");
    await requestReset(t0, "ghost@example.com");

    const { rows } = await t0.pool.query<{ action: string; detail: { outcome: string } }>(
      `SELECT "action", "detail" FROM "audit_log" WHERE "action" = 'auth.password_reset.requested' ORDER BY "id"`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.detail.outcome).sort()).toEqual(["no_such_account", "sent"]);
    // The unknown-account audit has no user id attached, so an operator can see
    // the enumeration attempt as such.
    const { rows: ghostRows } = await t0.pool.query<{ user_id: number | null }>(
      `SELECT "user_id" FROM "audit_log" WHERE "action" = 'auth.password_reset.requested' AND "detail"->>'outcome' = 'no_such_account'`,
    );
    expect(ghostRows[0]!.user_id).toBeNull();
  });

  it("stores only a hash of the token, plus the requesting IP and an expiry", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const res = await requestReset(t0, "alice@example.com");
    expect(res.status).toBe(200);
    const token = tokenFromEmail();
    const { rows } = await t0.pool.query<{
      token_hash: string;
      lookup_hash: string;
      requested_ip: string | null;
      used_at: Date | null;
      remaining_ms: number;
    }>(
      `SELECT "token_hash", "lookup_hash", "requested_ip", "used_at",
              EXTRACT(EPOCH FROM ("expires_at" - now())) * 1000 AS remaining_ms
         FROM "password_reset_tokens"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^sha256\$/);
    expect(rows[0]!.lookup_hash).not.toContain(token);
    expect(rows[0]!.requested_ip).toBeTruthy();
    expect(rows[0]!.used_at).toBeNull();
    // ~30 minutes.
    expect(Number(rows[0]!.remaining_ms)).toBeGreaterThan(25 * 60_000);
    expect(Number(rows[0]!.remaining_ms)).toBeLessThan(31 * 60_000);
  });

  it("invalidates outstanding tokens when a new one is requested", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    await requestReset(t0, "alice@example.com");
    const first = tokenFromEmail(0);
    await requestReset(t0, "alice@example.com");
    const second = tokenFromEmail(1);
    expect(second).not.toBe(first);

    const old = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: first, password: "BrandNew2!Pass" });
    expect(old.status).toBe(400);
    expect(old.body.code).toBe("AUTH_RESET_TOKEN_USED");

    const fresh = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: second, password: "BrandNew2!Pass" });
    expect(fresh.status).toBe(200);
  });

  it("rejects a missing identifier with AUTH_FIELD_REQUIRED", async () => {
    const res = await request(t0.app).post("/api/auth/password-reset/request").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_FIELD_REQUIRED");
  });

  it("rate-limits per identifier", async () => {
    await t0.createUser({ username: "alice", password: STRONG, email: "alice@example.com" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await requestReset(t0, "alice@example.com");
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.body.code).toBe("AUTH_RATE_LIMITED");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        expect(res.headers["retry-after"]).toBeDefined();
      }
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

/**
 * Full login for an account that has an email on file: password, then the OTP
 * challenge. `t.loginAs` stops at the 200 that carries `otpRequired`, so it
 * returns an agent with no session — this completes the second step.
 */
async function loginThroughOtp(t: DbFixture, username: string, password: string) {
  sentEmails.length = 0;
  const agent = request.agent(t.app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  expect(login.body.otpRequired).toBe(true);
  const mail = sentEmails.find((m) => m.to === `${username}@example.com`);
  expect(mail, "login OTP email").toBeDefined();
  const code = /code is:\s*(\d{4,8})/i.exec(mail!.text)?.[1];
  expect(code, "OTP in email body").toBeTruthy();
  const verify = await agent
    .post("/api/auth/login/otp/verify")
    .send({ username, loginToken: login.body.loginToken, code });
  expect(verify.status).toBe(200);
  expect(verify.body.ok).toBe(true);
  return agent;
}

describe("password recovery — confirm", () => {
  const t0: DbFixture = withDb();
  let userId: number;

  beforeEach(async () => {
    sentEmails.length = 0;
    userId = await t0.createUser({
      username: "alice",
      password: STRONG,
      email: "alice@example.com",
    });
  });

  async function freshToken(): Promise<string> {
    sentEmails.length = 0;
    const res = await requestReset(t0, "alice@example.com");
    expect(res.status).toBe(200);
    return tokenFromEmail();
  }

  it("sets the new password and clears the lockout counters", async () => {
    // Lock the account out first: a reset must also clear the streak, otherwise
    // the owner of the mailbox cannot sign in with the password they just set.
    for (let i = 0; i < 5; i++) {
      await request(t0.app).post("/api/auth/login").send({ username: "alice", password: "wrong" });
    }
    const locked = await request(t0.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: STRONG });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("AUTH_ACCOUNT_LOCKED");

    const token = await freshToken();
    const res = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows } = await t0.pool.query<{
      failed_attempts: number;
      locked_until: Date | null;
      password_hash: string;
    }>(`SELECT "failed_attempts", "locked_until", "password_hash" FROM "users" WHERE "id" = $1`, [userId]);
    expect(rows[0]!.failed_attempts).toBe(0);
    expect(rows[0]!.locked_until).toBeNull();
    expect(rows[0]!.password_hash).not.toBe(STRONG);

    // The new password works and the old one does not.
    const withNew = await request(t0.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "FreshReset9!Pass" });
    expect(withNew.status).toBe(200);
    const withOld = await request(t0.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: STRONG });
    expect(withOld.status).toBe(401);
  });

  it("revokes the sessions that were open when the reset completed", async () => {
    // A password reset must log every other device out. This account has an
    // email on file, so each device has to complete the e-mail OTP step to hold
    // a session at all — which is exactly the shape of a real second device.
    const deviceA = await loginThroughOtp(t0, "alice", STRONG);
    const deviceB = await loginThroughOtp(t0, "alice", STRONG);
    expect((await deviceA.get("/api/auth/me")).status).toBe(200);
    expect((await deviceB.get("/api/auth/me")).status).toBe(200);

    const token = await freshToken();
    const res = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    expect(res.status).toBe(200);
    expect(res.body.sessionsRevoked).toBeGreaterThanOrEqual(2);

    for (const [label, device] of [["A", deviceA], ["B", deviceB]] as const) {
      const me = await device.get("/api/auth/me");
      expect(me.status, `device ${label}`).toBe(401);
      expect(me.body.authenticated, `device ${label}`).toBe(false);
    }
    const { rows } = await t0.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "session" WHERE "sess"->>'userId' = $1`,
      [String(userId)],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("is single-use: a second redemption of the same token fails", async () => {
    const token = await freshToken();
    const first = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    expect(first.status).toBe(200);
    const second = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "Another1!Pass" });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("AUTH_RESET_TOKEN_USED");
    // ...and the password from the first redemption is still the live one.
    const login = await request(t0.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "FreshReset9!Pass" });
    expect(login.status).toBe(200);
  });

  it("is race-free: N concurrent redemptions of one token produce exactly ONE success", async () => {
    const token = await freshToken();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(t0.app)
          .post("/api/auth/password-reset/confirm")
          .send({ token, password: `RaceWinner${i}!Aa` }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 200);
    const rejected = attempts.filter((r) => r.status === 400);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.body.code).toBe("AUTH_RESET_TOKEN_USED");

    // Only one row got the token consumed, and the winner's password is the one
    // that is live (the loser's distinct passwords lost the race).
    const { rows } = await t0.pool.query<{ used: number }>(
      `SELECT count(*)::int AS used FROM "password_reset_tokens" WHERE "user_id" = $1 AND "used_at" IS NOT NULL`,
      [userId],
    );
    expect(rows[0]!.used).toBeGreaterThanOrEqual(1);
  });

  it("rejects an unknown or malformed token with AUTH_RESET_TOKEN_INVALID", async () => {
    for (const bad of ["deadbeef".repeat(8), "not-a-token", ""]) {
      const res = await request(t0.app)
        .post("/api/auth/password-reset/confirm")
        .send({ token: bad, password: "FreshReset9!Pass" });
      if (bad === "") {
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("AUTH_FIELD_REQUIRED");
      } else {
        expect(res.status, bad).toBe(400);
        expect(res.body.code).toBe("AUTH_RESET_TOKEN_INVALID");
      }
    }
  });

  it("rejects an expired token with AUTH_RESET_TOKEN_EXPIRED and leaves the password alone", async () => {
    const token = await freshToken();
    await t0.pool.query(
      `UPDATE "password_reset_tokens" SET "expires_at" = NOW() - INTERVAL '1 minute' WHERE "lookup_hash" IS NOT NULL`,
    );
    const res = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_RESET_TOKEN_EXPIRED");
    const login = await request(t0.app).post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(login.status).toBe(200);
  });

  it("enforces the password policy with AUTH_PASSWORD_WEAK", async () => {
    const token = await freshToken();
    const res = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_PASSWORD_WEAK");
    expect(res.body.error).toMatch(/at least 12 characters/i);
    // A rejected password does NOT burn the token.
    const retry = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    expect(retry.status).toBe(200);
  });

  it("refuses to reuse the current password, without burning the token", async () => {
    const token = await freshToken();
    const res = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: STRONG });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_PASSWORD_WEAK");
    expect(res.body.error).toMatch(/different from your current password/i);
    const retry = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    expect(retry.status).toBe(200);
  });

  it("requires both fields", async () => {
    const noToken = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ password: "FreshReset9!Pass" });
    expect(noToken.status).toBe(400);
    expect(noToken.body.code).toBe("AUTH_FIELD_REQUIRED");
    const noPassword = await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token: "a".repeat(64) });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.code).toBe("AUTH_FIELD_REQUIRED");
  });

  it("rate-limits confirmations per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(t0.app)
        .post("/api/auth/password-reset/confirm")
        .send({ token: "b".repeat(64), password: "FreshReset9!Pass" });
      statuses.push(res.status);
      if (res.status === 429) expect(res.body.code).toBe("AUTH_RATE_LIMITED");
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses[0]).toBe(400);
  });

  it("audits the completion with the number of sessions revoked", async () => {
    const token = await freshToken();
    await request(t0.app)
      .post("/api/auth/password-reset/confirm")
      .send({ token, password: "FreshReset9!Pass" });
    const { rows } = await t0.pool.query<{ action: string; detail: Record<string, unknown>; user_id: number }>(
      `SELECT "action", "detail", "user_id" FROM "audit_log" WHERE "action" = 'auth.password_reset.completed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(userId);
    expect(rows[0]!.detail).toHaveProperty("revokedSessions");
  });
});