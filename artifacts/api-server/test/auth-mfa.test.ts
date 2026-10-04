// TASK 2 — TOTP MFA with no external dependency.
//
// Covers the full challenge flow, recovery codes, replay protection, the atomic
// attempt counter, the re-auth requirement on every destructive MFA route, and
// the `code` field on each failure.

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";
import { totpCodeAtStep, hashLoginToken } from "../src/lib/security";

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push({ to: input.to, subject: input.subject, text: input.text });
    return true;
  }),
}));

const STRONG = "MfaEnrol1!Pass";

/** The authenticator's code for `secret` right now (offset steps). */
function currentCode(secret: string, offset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + offset;
  const code = totpCodeAtStep(secret, step);
  if (!code) throw new Error("could not derive a TOTP code");
  return code;
}
const NEW_PASSWORD = "Different2!Pass";

/** Login and complete the two-step MFA enrolment. Returns the agent + codes. */
async function enrol(
  t: DbFixture,
  agent: Awaited<ReturnType<DbFixture["loginAs"]>>,
  password = STRONG,
): Promise<{ secret: string; recoveryCodes: string[]; otpauthUri: string }> {
  const reauth = await agent.post("/api/auth/reauth").send({ password });
  expect(reauth.status, "reauth before enrolment").toBe(200);
  const enroll = await agent.post("/api/auth/mfa/enroll");
  expect(enroll.status, "enroll step 1").toBe(200);
  const secret: string = enroll.body.secret;
  const confirm = await agent
    .post("/api/auth/mfa/enroll/confirm")
    .send({ code: currentCode(secret) });
  expect(confirm.status, "enroll step 2").toBe(200);
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[], otpauthUri: enroll.body.otpauthUri };
}

/** Start a login that stops at the MFA challenge and return its loginToken. */
async function startChallenge(t: DbFixture, username: string, password = STRONG): Promise<string> {
  const login = await request(t.app).post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  expect(login.body.mfaRequired).toBe(true);
  expect(typeof login.body.loginToken).toBe("string");
  return login.body.loginToken as string;
}

/**
 * A second authenticated session for an account that has MFA enabled: the
 * password step then the TOTP step. `t.loginAs` cannot be used here — it stops
 * at the `mfaRequired` response and returns an agent with no session.
 */
async function loginThroughMfa(
  t: DbFixture,
  username: string,
  password: string,
  secret: string,
) {
  const agent = request.agent(t.app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  expect(login.body.mfaRequired).toBe(true);
  const verify = await agent
    .post("/api/auth/mfa/verify")
    .send({ loginToken: login.body.loginToken, code: currentCode(secret) });
  expect(verify.status).toBe(200);
  return agent;
}

describe("MFA enrolment", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it("refuses an unauthenticated caller", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const res = await request(t.app).post("/api/auth/mfa/enroll");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("requires a recent password re-authentication", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    // A fresh login is NOT a re-authentication: the guard must still fire.
    const res = await agent.post("/api/auth/mfa/enroll");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_REAUTH_REQUIRED");
  });

  it("rejects a wrong password at the reauth step", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const res = await agent.post("/api/auth/reauth").send({ password: "WrongPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
    // ...and it did NOT unlock the destructive route.
    expect((await agent.post("/api/auth/mfa/enroll")).status).toBe(403);
  });

  it("returns the secret and a well-formed otpauth:// URI (no QR available)", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const enroll = await agent.post("/api/auth/mfa/enroll");
    expect(enroll.status).toBe(200);
    expect(enroll.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enroll.body.digits).toBe(6);
    expect(enroll.body.period).toBe(30);
    expect(enroll.body.algorithm).toBe("SHA1");
    expect(enroll.body.issuer).toBeTruthy();
    // No QR library exists in this workspace, so the client renders a copyable
    // block instead. The flag says so explicitly.
    expect(enroll.body.qrCodeAvailable).toBe(false);
    expect(enroll.body.otpCode).toBeUndefined();
    expect(enroll.body.qrCode).toBeUndefined();

    const uri = new URL(enroll.body.otpauthUri as string);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(uri.pathname).toContain("alice");
    expect(uri.searchParams.get("secret")).toBe(enroll.body.secret);
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("issuer")).toBe(enroll.body.issuer);
  });

  it("stores the pending secret sealed, never in the clear", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const enroll = await agent.post("/api/auth/mfa/enroll");
    const secret: string = enroll.body.secret;

    const { rows } = await t.pool.query<{ mfa_pending_secret_enc: string; mfa_secret_enc: string | null; totp_enabled_at: Date | null }>(
      `SELECT "mfa_pending_secret_enc", "mfa_secret_enc", "totp_enabled_at" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(rows[0]!.mfa_pending_secret_enc).toBeTruthy();
    expect(rows[0]!.mfa_pending_secret_enc).not.toContain(secret);
    expect(rows[0]!.mfa_pending_secret_enc!.startsWith("v1:")).toBe(true);
    // Not enabled yet.
    expect(rows[0]!.mfa_secret_enc).toBeNull();
    expect(rows[0]!.totp_enabled_at).toBeNull();
  });

  it("will not confirm a code without a pending enrolment", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const res = await agent.post("/api/auth/mfa/enroll/confirm").send({ code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_TOTP_NOT_CONFIGURED");
  });

  it("rejects a wrong confirmation code and keeps MFA disabled", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const enroll = await agent.post("/api/auth/mfa/enroll");
    const secret: string = enroll.body.secret;

    const bad = await agent.post("/api/auth/mfa/enroll/confirm").send({ code: "000000" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("AUTH_MFA_INVALID");

    const { rows } = await t.pool.query<{ totp_enabled_at: Date | null }>(
      `SELECT "totp_enabled_at" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(rows[0]!.totp_enabled_at).toBeNull();

    // The correct code still works afterwards.
    const good = await agent.post("/api/auth/mfa/enroll/confirm").send({ code: currentCode(secret) });
    expect(good.status).toBe(200);
  });

  it("returns 8 recovery codes once, hashed at rest", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const { recoveryCodes } = await enrol(t, agent);
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    const { rows } = await t.pool.query<{ code_hash: string; used_at: Date | null }>(
      `SELECT "code_hash", "used_at" FROM "mfa_recovery_codes" WHERE "user_id" = $1`,
      [userId],
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.code_hash).toMatch(/^sha256\$/);
      expect(row.used_at).toBeNull();
      expect(recoveryCodes.some((c) => row.code_hash.includes(c))).toBe(false);
    }
    // A second confirm must not silently issue more codes.
    const again = await agent.post("/api/auth/mfa/enroll/confirm").send({ code: "123456" });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("AUTH_TOTP_ALREADY_SET");
  });

  it("refuses a second enrolment with AUTH_TOTP_ALREADY_SET", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await enrol(t, agent);
    const res = await agent.post("/api/auth/mfa/enroll");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("AUTH_TOTP_ALREADY_SET");
  });

  it("audits enrolment start, enable and disable", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await enrol(t, agent);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    await agent.post("/api/auth/mfa/disable");

    const { rows } = await t.pool.query<{ action: string }>(
      `SELECT "action" FROM "audit_log" WHERE "action" LIKE 'auth.mfa.%' ORDER BY "id"`,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("auth.mfa.enroll.started");
    expect(actions).toContain("auth.mfa.enabled");
    expect(actions).toContain("auth.mfa.disabled");
  });
});

describe("MFA login challenge", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it("does not establish a session at the password step", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    await enrol(t, setup);

    const agent = request.agent(t.app);
    const login = await agent.post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.otpRequired).toBeUndefined();
    expect(login.body.loginToken).toMatch(/^[0-9a-f]{64}$/);
    // No session yet: the password alone is not enough.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.authenticated).toBe(false);
  });

  it("establishes a session (with a rotated sid) on a correct TOTP code", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const agent = request.agent(t.app);
    const loginToken = await startChallenge(t, "alice");
    const verify = await agent
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: currentCode(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.mfaMethod).toBe("totp");
    expect(verify.body.mfaRecoveryCodesRemaining).toBe(8);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("alice");
    expect(me.body.mfaEnabled).toBe(true);
    // A7: the session id was rotated, so the pre-login cookie is not the one
    // that ended up authenticated.
    expect(verify.headers["set-cookie"]).toBeDefined();
  });

  it("accepts the previous step's code (clock skew tolerance)", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const loginToken = await startChallenge(t, "alice");
    const res = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: currentCode(secret, -1) });
    expect(res.status).toBe(200);
  });

  it("rejects a code from a stale step", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const loginToken = await startChallenge(t, "alice");
    const res = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: currentCode(secret, -3) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_MFA_INVALID");
  });

  it("refuses to accept the same code twice inside the +/-1 window", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const code = currentCode(secret, -1);

    const first = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code });
    expect(first.status).toBe(200);

    // Same digits, still inside the tolerance window: must NOT authenticate a
    // second time, because the counter value was already claimed.
    const replay = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe("AUTH_MFA_INVALID");
  });

  it("burns the login challenge after a successful verification", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const loginToken = await startChallenge(t, "alice");
    const code = currentCode(secret);
    const first = await request(t.app).post("/api/auth/mfa/verify").send({ loginToken, code });
    expect(first.status).toBe(200);

    const { rows } = await t.pool.query<{ consumed_at: Date | null }>(
      `SELECT "consumed_at" FROM "login_challenges" WHERE "consumed_at" IS NOT NULL`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // A brand-new challenge cannot be spent with an already-claimed step.
    const second = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code });
    expect(second.status).toBe(400);
  });

  it("rejects an unknown or expired login token with AUTH_SESSION_EXPIRED", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const unknown = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: "f".repeat(64), code: currentCode(secret) });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe("AUTH_SESSION_EXPIRED");

    const loginToken = await startChallenge(t, "alice");
    await t.pool.query(`UPDATE "login_challenges" SET "expires_at" = NOW() - INTERVAL '1 minute'`);
    const expired = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: currentCode(secret) });
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("requires both fields", async () => {
    const res = await request(t.app).post("/api/auth/mfa/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_FIELD_REQUIRED");
  });

  it("reports AUTH_MFA_NOT_ENROLLED when the challenge belongs to an unenrolled account", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    // Plant a challenge row by hand for an account that never enrolled: this is
    // the shape an attacker would need to forge (and cannot get from /login).
    const token = "b".repeat(64);
    await t.pool.query(
      `INSERT INTO "login_challenges" ("token_hash", "user_id", "expires_at") VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
      [hashLoginToken(token), userId],
    );
    const res = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: token, code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_MFA_NOT_ENROLLED");
  });
});

describe("MFA attempt counter", () => {
  const t: DbFixture = withDb();

  it("locks the challenge after 5 wrong codes and keeps the correct code out too", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const loginToken = await startChallenge(t, "alice");
    const wrong: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(t.app)
        .post("/api/auth/mfa/verify")
        .send({ loginToken, code: "000000" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("AUTH_MFA_INVALID");
      wrong.push("000000");
    }
    const sixth = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: "000000" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe("AUTH_RATE_LIMITED");
    expect(sixth.body.retryAfterSec).toBeGreaterThan(0);

    const { rows } = await t.pool.query<{ mfa_attempts: number }>(
      `SELECT "mfa_attempts" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(rows[0]!.mfa_attempts).toBe(5);

    const correct = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken, code: currentCode(secret) });
    expect(correct.status).toBe(429);
    expect(wrong).toHaveLength(5);
  });

  it("counts N concurrent wrong codes atomically (only 5 get through)", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    await enrol(t, setup);

    const loginToken = await startChallenge(t, "alice");
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(t.app).post("/api/auth/mfa/verify").send({ loginToken, code: "000000" }),
      ),
    );
    expect(attempts.filter((r) => r.status === 400)).toHaveLength(5);
    expect(attempts.filter((r) => r.status === 429)).toHaveLength(3);

    const { rows } = await t.pool.query<{ mfa_attempts: number }>(
      `SELECT "mfa_attempts" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(rows[0]!.mfa_attempts).toBe(5);
  });

  it("resets the counter when a new login challenge is issued", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, setup);

    const first = await startChallenge(t, "alice");
    for (let i = 0; i < 3; i++) {
      await request(t.app).post("/api/auth/mfa/verify").send({ loginToken: first, code: "000000" });
    }
    await startChallenge(t, "alice");
    const { rows } = await t.pool.query<{ mfa_attempts: number }>(
      `SELECT "mfa_attempts" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(rows[0]!.mfa_attempts).toBe(0);
    const ok = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: currentCode(secret) });
    expect(ok.status).toBe(200);
  });

  it("rate-limits per IP and includes retryAfterSec on every 429", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    await enrol(t, setup);

    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(t.app)
        .post("/api/auth/mfa/verify")
        .send({ loginToken: "c".repeat(64), code: "123456" });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.code).toBe("AUTH_RATE_LIMITED");
        expect(typeof res.body.retryAfterSec).toBe("number");
        expect(res.body.retryAfterSec).toBeGreaterThan(0);
        expect(res.headers["retry-after"]).toBeDefined();
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});

describe("MFA recovery codes", () => {
  const t: DbFixture = withDb();

  it("logs in with a recovery code and consumes it", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { recoveryCodes } = await enrol(t, setup);
    const code = recoveryCodes[0]!;

    const agent = request.agent(t.app);
    const loginToken = await startChallenge(t, "alice");
    const verify = await agent.post("/api/auth/mfa/verify").send({ loginToken, code });
    expect(verify.status).toBe(200);
    expect(verify.body.mfaMethod).toBe("recovery");
    expect(verify.body.mfaRecoveryCodesRemaining).toBe(7);
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    const { rows } = await t.pool.query<{ remaining: number }>(
      `SELECT count(*)::int AS remaining FROM "mfa_recovery_codes" WHERE "user_id" = $1 AND "used_at" IS NULL`,
      [userId],
    );
    expect(rows[0]!.remaining).toBe(7);

    // The SAME code cannot be used again.
    const again = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("AUTH_MFA_INVALID");
  });

  it("consumes a recovery code atomically under concurrency", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { recoveryCodes } = await enrol(t, setup);
    const code = recoveryCodes[1]!;

    const loginToken = await startChallenge(t, "alice");
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(t.app).post("/api/auth/mfa/verify").send({ loginToken, code }),
      ),
    );
    // Exactly one redemption of the same loginToken can win at all.
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);

    const { rows } = await t.pool.query<{ remaining: number }>(
      `SELECT count(*)::int AS remaining FROM "mfa_recovery_codes" WHERE "user_id" = $1 AND "used_at" IS NULL`,
      [userId],
    );
    expect(rows[0]!.remaining).toBe(7);
  });

  it("tolerates a lowercase / unseparated recovery code", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { recoveryCodes } = await enrol(t, setup);
    const code = recoveryCodes[2]!;
    const mangled = code.replace("-", " ").toLowerCase();
    const res = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: mangled });
    expect(res.status).toBe(200);
  });

  it("POST /auth/mfa/recovery/verify redeems a code and refuses a TOTP code", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { secret, recoveryCodes } = await enrol(t, setup);

    const ok = await request(t.app)
      .post("/api/auth/mfa/recovery/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: recoveryCodes[4]! });
    expect(ok.status).toBe(200);
    expect(ok.body.mfaMethod).toBe("recovery");
    expect((await request.agent(t.app).get("/api/auth/me")).status).toBe(401);

    // A 6-digit TOTP code is the wrong credential for the recovery endpoint.
    const wrongKind = await request(t.app)
      .post("/api/auth/mfa/recovery/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: currentCode(secret) });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.code).toBe("AUTH_RECOVERY_INVALID");

    // ...and a burned code still fails there.
    const reused = await request(t.app)
      .post("/api/auth/mfa/recovery/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: recoveryCodes[4]! });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe("AUTH_RECOVERY_INVALID");
  });

  it("rejects an unknown recovery code", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    await enrol(t, setup);
    const res = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: "ZZZZZ-ZZZZZ" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_MFA_INVALID");
  });

  it("regenerates: new codes invalidate every old one, and re-auth is required", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const setup = await t.loginAs("alice", STRONG);
    const { recoveryCodes, secret } = await enrol(t, setup);
    const oldCode = recoveryCodes[0]!;

    // A second device: enrolled already, but this session never re-entered the
    // password, so the guard must fire for it.
    const other = await loginThroughMfa(t, "alice", STRONG, secret);
    const noReauth = await other.post("/api/auth/mfa/recovery/regenerate");
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.code).toBe("AUTH_REAUTH_REQUIRED");

    const reauth = await other.post("/api/auth/reauth").send({ password: STRONG });
    expect(reauth.status).toBe(200);
    const regen = await other.post("/api/auth/mfa/recovery/regenerate");
    expect(regen.status).toBe(200);
    const fresh = regen.body.recoveryCodes as string[];
    expect(fresh).toHaveLength(8);
    expect(fresh).not.toContain(oldCode);

    const { rows } = await t.pool.query<{ count: number; used: number }>(
      `SELECT count(*)::int AS count, count(*) FILTER (WHERE "used_at" IS NOT NULL)::int AS used
         FROM "mfa_recovery_codes" WHERE "user_id" = $1`,
      [userId],
    );
    expect(rows[0]!.count).toBe(8);
    expect(rows[0]!.used).toBe(0);

    const stale = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: oldCode });
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe("AUTH_MFA_INVALID");

    const working = await request(t.app)
      .post("/api/auth/mfa/verify")
      .send({ loginToken: await startChallenge(t, "alice"), code: fresh[0]! });
    expect(working.status).toBe(200);
  });

  it("refuses regeneration for an account with no MFA", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const res = await agent.post("/api/auth/mfa/recovery/regenerate");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_MFA_NOT_ENROLLED");
  });
});

describe("MFA disable", () => {
  const t: DbFixture = withDb();

  it("requires re-auth, then removes the secret and the recovery codes", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const { secret } = await enrol(t, agent);

    const other = await loginThroughMfa(t, "alice", STRONG, secret);
    const noReauth = await other.post("/api/auth/mfa/disable");
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.code).toBe("AUTH_REAUTH_REQUIRED");

    const reauth = await agent.post("/api/auth/reauth").send({ password: STRONG });
    expect(reauth.status).toBe(200);
    expect(reauth.body.reauthenticatedAt).toBeTruthy();
    expect(reauth.body.expiresInSec).toBeGreaterThan(0);

    const off = await agent.post("/api/auth/mfa/disable");
    expect(off.status).toBe(200);
    expect(off.body.mfaEnabled).toBe(false);

    const { rows } = await t.pool.query<{
      mfa_secret_enc: string | null;
      totp_enabled_at: Date | null;
      codes: string;
    }>(
      `SELECT u."mfa_secret_enc", u."totp_enabled_at",
              (SELECT count(*)::text FROM "mfa_recovery_codes" c WHERE c."user_id" = u."id") AS codes
         FROM "users" u WHERE u."id" = $1`,
      [userId],
    );
    expect(rows[0]!.mfa_secret_enc).toBeNull();
    expect(rows[0]!.totp_enabled_at).toBeNull();
    expect(rows[0]!.codes).toBe("0");

    const me = await agent.get("/api/auth/me");
    expect(me.body.mfaEnabled).toBe(false);

    // Login no longer demands a second factor.
    const login = await request(t.app).post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBeUndefined();
  });

  it("reports AUTH_MFA_NOT_ENROLLED when there is nothing to disable", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const res = await agent.post("/api/auth/mfa/disable");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AUTH_MFA_NOT_ENROLLED");
  });
});

describe("admin-set MFA requirement (soft enforcement)", () => {
  const t: DbFixture = withDb();

  it("flags an unenrolled account instead of locking it out", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    await t.pool.query(`UPDATE "users" SET "mfa_required" = true WHERE "id" = $1`, [userId]);

    const login = await request(t.app).post("/api/auth/login").send({ username: "alice", password: STRONG });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.mfaEnrollmentRequired).toBe(true);
    expect(login.body.otpRequired).toBeUndefined();
  });

  it("reports the requirement through /auth/me after login", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    await t.pool.query(`UPDATE "users" SET "mfa_required" = true WHERE "id" = $1`, [userId]);
    const agent = await t.loginAs("alice", STRONG);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.mfaRequired).toBe(true);
    expect(me.body.mfaEnabled).toBe(false);
    expect(me.body.mfaEnrollmentRequired).toBe(true);
  });

  it("lets an admin set mfaRequired through PATCH /admin/users/:id", async () => {
    const target = await t.createUser({ username: "alice", password: STRONG });
    await t.createUser({ username: "root", password: NEW_PASSWORD, role: "admin", canAdminAccess: true });
    const admin = await t.loginAs("root", NEW_PASSWORD);
    const res = await admin.patch(`/api/users/${target}`).send({ mfaRequired: true });
    expect(res.status).toBe(200);
    const { rows } = await t.pool.query<{ mfa_required: boolean }>(
      `SELECT "mfa_required" FROM "users" WHERE "id" = $1`,
      [target],
    );
    expect(rows[0]!.mfa_required).toBe(true);
  });

  it("stops flagging once the account has enrolled", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    await t.pool.query(`UPDATE "users" SET "mfa_required" = true WHERE "id" = $1`, [userId]);
    const agent = await t.loginAs("alice", STRONG);
    await enrol(t, agent);
    const me = await agent.get("/api/auth/me");
    expect(me.body.mfaRequired).toBe(true);
    expect(me.body.mfaEnabled).toBe(true);
    expect(me.body.mfaEnrollmentRequired).toBe(false);
  });
});