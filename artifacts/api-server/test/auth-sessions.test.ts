// TASK 3 — session hardening: idle + absolute bounds, opaque session
// references, ownership checks on revoke, and the richer /auth/me payload.

import { describe, it, expect } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

const STRONG = "SessionHard3!Pass";

/** The raw sids the store holds for a user (never exposed to a client). */
async function storedSids(t: DbFixture, userId: number): Promise<string[]> {
  const { rows } = await t.pool.query<{ sid: string }>(
    `SELECT "sid" FROM "session" WHERE "sess"->>'userId' = $1`,
    [String(userId)],
  );
  return rows.map((r) => r.sid);
}

/**
 * Rewrite the stored session JSON in place.
 *
 * The timeouts are module-level constants read at import, so the only way to
 * test "what happens 31 minutes later" without a fake clock is to move the
 * timestamps the server compares against — which is also what an attacker with
 * database access would be able to observe, not something only the test can do.
 */
async function mutateSession(
  t: DbFixture,
  userId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const { rows } = await t.pool.query<{ sid: string; sess: Record<string, unknown> }>(
    `SELECT "sid", "sess" FROM "session" WHERE "sess"->>'userId' = $1`,
    [String(userId)],
  );
  for (const row of rows) {
    await t.pool.query(`UPDATE "session" SET "sess" = $2::json WHERE "sid" = $1`, [
      row.sid,
      JSON.stringify({ ...row.sess, ...patch }),
    ]);
  }
}

describe("GET /sessions — opaque references", () => {
  const t: DbFixture = withDb();

  it("never returns the session id, and every entry carries a usable ref", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const sids = await storedSids(t, userId);
    expect(sids).toHaveLength(1);

    const res = await agent.get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);

    const session = res.body.sessions[0];
    // The credential itself is gone.
    expect(session.sid).toBeUndefined();
    expect(sids[0]).not.toBe(session.ref);
    expect(JSON.stringify(res.body)).not.toContain(sids[0]!);
    // ...replaced by a stable, non-secret reference.
    expect(session.ref).toMatch(/^[0-9a-f]{16}$/);

    expect(session.current).toBe(true);
    expect(session.username).toBe("alice");
    expect(typeof session.createdAt).toBe("string");
    expect(typeof session.lastActivityAt).toBe("string");
    expect(typeof session.idleExpiresAt).toBe("string");
    expect(typeof session.absoluteExpiresAt).toBe("string");
    expect(session.ip).toBeTruthy();
    // superagent sends no User-Agent, so this is null in tests and the label
    // degrades to "Unknown client" rather than guessing.
    expect(session.device).toBe("Unknown client");
    expect(session.userAgent === null || typeof session.userAgent === "string").toBe(true);
  });

  it("parses the user agent into a coarse device label", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = request.agent(t.app);
    await agent
      .post("/api/auth/login")
      .set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
      .send({ username: "alice", password: STRONG });

    const res = await agent.get("/api/sessions");
    expect(res.body.sessions[0].device).toBe("Chrome on macOS");
  });

  it("labels an unknown client rather than guessing", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await mutateSession(t, userId, { userAgent: null });
    const res = await agent.get("/api/sessions");
    expect(res.body.sessions[0].device).toBe("Unknown client");
  });

  it("lists every device with distinct refs", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const a = await t.loginAs("alice", STRONG);
    const b = await t.loginAs("alice", STRONG);
    const c = await t.loginAs("alice", STRONG);

    const forA = await a.get("/api/sessions");
    const refs = forA.body.sessions.map((s: { ref: string }) => s.ref);
    expect(refs).toHaveLength(3);
    expect(new Set(refs).size).toBe(3);
    expect(forA.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect((await b.get("/api/sessions")).body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect((await c.get("/api/sessions")).body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it("requires authentication", async () => {
    const res = await request(t.app).get("/api/sessions");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });
});

describe("DELETE /sessions/:ref", () => {
  const t: DbFixture = withDb();

  it("revokes another device by its opaque ref and keeps the caller signed in", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const mine = await t.loginAs("alice", STRONG);
    const theirs = await t.loginAs("alice", STRONG);

    const list = await mine.get("/api/sessions");
    const otherRef = list.body.sessions.find((s: { current: boolean }) => !s.current).ref as string;

    const res = await mine.delete(`/api/sessions/${otherRef}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The caller is untouched...
    expect((await mine.get("/api/auth/me")).status).toBe(200);
    // ...the other device is not.
    const other = await theirs.get("/api/auth/me");
    expect(other.status).toBe(401);
    expect(other.body.authenticated).toBe(false);
    expect(await storedSids(t, userId)).toHaveLength(1);
  });

  it("refuses to revoke the CURRENT session", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const list = await agent.get("/api/sessions");
    const myRef = list.body.sessions.find((s: { current: boolean }) => s.current).ref as string;

    const res = await agent.delete(`/api/sessions/${myRef}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Cannot revoke the current session.");
    expect(res.body.code).toBe("AUTH_SESSION_CURRENT");
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("refuses to revoke a session belonging to ANOTHER user", async () => {
    const aliceId = await t.createUser({ username: "alice", password: STRONG });
    await t.createUser({ username: "mallory", password: STRONG });

    const alice = await t.loginAs("alice", STRONG);
    const mallory = await t.loginAs("mallory", STRONG);

    // Mallory can only see her own ref, but she can try to guess Alice's.
    const aliceList = await alice.get("/api/sessions");
    const aliceRef = aliceList.body.sessions.find((s: { current: boolean }) => s.current).ref as string;
    const rawSid = (await storedSids(t, aliceId))[0]!;

    for (const guess of [aliceRef, rawSid]) {
      const res = await mallory.delete(`/api/sessions/${guess}`);
      expect(res.status, guess).toBe(404);
      expect(res.body.code).toBe("AUTH_SESSION_REVOKED");
      expect(res.body.error).toBe("Session not found.");
    }

    // Alice is untouched.
    expect((await alice.get("/api/auth/me")).status).toBe(200);
    expect(await storedSids(t, aliceId)).toHaveLength(1);
  });

  it("404s an unknown ref instead of 403 (no enumeration oracle)", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    for (const ref of ["0123456789abcdef", "not-a-ref", "f".repeat(64)]) {
      const res = await agent.delete(`/api/sessions/${ref}`);
      expect(res.status, ref).toBe(404);
      expect(res.body.code).toBe("AUTH_SESSION_REVOKED");
    }
  });

  it("still accepts a raw sid for the legacy SPA, owner-scoped", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    await t.createUser({ username: "mallory", password: STRONG });
    const mine = await t.loginAs("alice", STRONG);
    await t.loginAs("alice", STRONG);
    const mallory = await t.loginAs("mallory", STRONG);
    const aliceSids = await storedSids(t, userId);
    const victimSid = aliceSids[aliceSids.length - 1]!;

    // Another user's raw sid is still a miss.
    const cross = await mallory.delete(`/api/sessions/${victimSid}`);
    expect(cross.status).toBe(404);

    const res = await mine.delete(`/api/sessions/${victimSid}`);
    expect(res.status).toBe(200);
  });

  it("requires authentication", async () => {
    const res = await request(t.app).delete("/api/sessions/0123456789abcdef");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("audits the revocation", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const mine = await t.loginAs("alice", STRONG);
    await t.loginAs("alice", STRONG);
    const list = await mine.get("/api/sessions");
    const otherRef = list.body.sessions.find((s: { current: boolean }) => !s.current).ref as string;
    await mine.delete(`/api/sessions/${otherRef}`);

    const { rows } = await t.pool.query<{ action: string; detail: { ref: string } }>(
      `SELECT "action", "detail" FROM "audit_log" WHERE "action" = 'auth.session.revoked'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail.ref).toBe(otherRef);
  });
});

describe("POST /sessions/revoke-others", () => {
  const t: DbFixture = withDb();

  it("requires a recent re-authentication", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await t.loginAs("alice", STRONG);

    const denied = await agent.post("/api/sessions/revoke-others");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AUTH_REAUTH_REQUIRED");

    await agent.post("/api/auth/reauth").send({ password: STRONG });
    const ok = await agent.post("/api/sessions/revoke-others");
    expect(ok.status).toBe(200);
    expect(ok.body.revoked).toBe(1);
  });

  it("keeps the caller signed in and logs out everything else", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const mine = await t.loginAs("alice", STRONG);
    const d2 = await t.loginAs("alice", STRONG);
    const d3 = await t.loginAs("alice", STRONG);
    await mine.post("/api/auth/reauth").send({ password: STRONG });

    const res = await mine.post("/api/sessions/revoke-others");
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    expect((await mine.get("/api/auth/me")).status).toBe(200);
    expect((await d2.get("/api/auth/me")).status).toBe(401);
    expect((await d3.get("/api/auth/me")).status).toBe(401);
    expect(await storedSids(t, userId)).toHaveLength(1);
  });

  it("does not touch another user's sessions", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    await t.createUser({ username: "mallory", password: STRONG });
    const alice = await t.loginAs("alice", STRONG);
    const mallory = await t.loginAs("mallory", STRONG);

    await mallory.post("/api/auth/reauth").send({ password: STRONG });
    const res = await mallory.post("/api/sessions/revoke-others");
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(0);
    // Alice's session survived.
    expect((await alice.get("/api/auth/me")).status).toBe(200);
  });

  it("the legacy DELETE /sessions alias behaves identically", async () => {
    await t.createUser({ username: "alice", password: STRONG });
    const mine = await t.loginAs("alice", STRONG);
    const other = await t.loginAs("alice", STRONG);

    const denied = await mine.delete("/api/sessions");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AUTH_REAUTH_REQUIRED");

    await mine.post("/api/auth/reauth").send({ password: STRONG });
    const res = await mine.delete("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(1);
    expect((await mine.get("/api/auth/me")).status).toBe(200);
    expect((await other.get("/api/auth/me")).status).toBe(401);
  });
});

describe("session expiry", () => {
  const t: DbFixture = withDb();
  const HOUR = 60 * 60 * 1000;

  it("ends a session that has been idle past the window", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    expect((await agent.get("/api/patients")).status).toBe(200);

    await mutateSession(t, userId, { lastActivityAt: Date.now() - 31 * 60 * 1000 });

    for (const path of ["/api/auth/me", "/api/patients", "/api/sessions", "/api/notifications"]) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.code, path).toBe("AUTH_SESSION_EXPIRED");
    }
    const me = await agent.get("/api/auth/me");
    expect(me.body.authenticated).toBe(false);
  });

  it("ends a session past the ABSOLUTE cap even if it keeps sliding", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    // Fresh activity, but the session itself is 13 hours old.
    await mutateSession(t, userId, { createdAt: Date.now() - 13 * HOUR });

    const res = await agent.get("/api/patients");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_SESSION_EXPIRED");
    expect(res.body.error).toMatch(/session expired/i);

    // Activity in between must not extend it: a "keep-alive" ping cannot buy
    // more than the absolute cap.
    await mutateSession(t, userId, { lastActivityAt: Date.now() });
    expect((await agent.get("/api/patients")).status).toBe(401);
  });

  it("keeps a session inside both windows alive and slides the idle clock", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await mutateSession(t, userId, { lastActivityAt: Date.now() - 20 * 60 * 1000 });

    expect((await agent.get("/api/patients")).status).toBe(200);

    const { rows } = await t.pool.query<{ lastActivityAt: number }>(
      `SELECT ("sess"->>'lastActivityAt')::bigint AS "lastActivityAt" FROM "session" WHERE "sess"->>'userId' = $1`,
      [String(userId)],
    );
    expect(Number(rows[0]!.lastActivityAt)).toBeGreaterThan(Date.now() - 30_000);
  });

  it("destroys the expired row instead of leaving a usable-looking cookie", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await mutateSession(t, userId, { lastActivityAt: Date.now() - 31 * 60 * 1000 });

    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(await storedSids(t, userId)).toHaveLength(0);
  });

  it("records the expiry in the audit trail", async () => {
    const userId = await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    await mutateSession(t, userId, { lastActivityAt: Date.now() - 31 * 60 * 1000 });
    await agent.get("/api/patients");

    const { rows } = await t.pool.query<{ action: string; detail: { reason: string } }>(
      `SELECT "action", "detail" FROM "audit_log" WHERE "action" = 'auth.session.expired'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.detail.reason).toBe("idle");
  });

  it("does not apply the cookie-shaped idle window to an API-token session", async () => {
    // A Bearer token resolves into a SYNTHETIC session (lib/apiToken.ts) that
    // has no createdAt/lastActivityAt and is never persisted. Applying a
    // 30-minute cookie idle timeout to it would break long-running API clients
    // for no security gain — their lifetime is `api_tokens.revoked_at`.
    await t.createUser({ username: "alice", password: STRONG });
    const agent = await t.loginAs("alice", STRONG);
    const created = await agent.post("/api/tokens").send({ name: "ci", scopes: ["read"] });
    expect(created.status).toBe(201);
    const plaintext: string = created.body.token ?? created.body.plaintext;
    expect(plaintext).toBeTruthy();

    const api = request(t.app).get("/api/patients").set("Authorization", `Bearer ${plaintext}`);
    const res = await api;
    expect(res.status).toBe(200);
  });
});

describe("GET /auth/me", () => {
  const t: DbFixture = withDb();

  it("returns everything the shell needs in one round trip", async () => {
    // No email on file: login then issues the session directly, so this test is
    // about /auth/me's payload rather than the OTP challenge.
    await t.createUser({ username: "alice", password: STRONG, role: "editor" });
    const agent = await t.loginAs("alice", STRONG);
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      username: "alice",
      role: "editor",
      canAdminAccess: false,
      canEdit: true,
      mfaEnabled: false,
      status: "active",
    });
    expect(res.body.userId).toBeTruthy();
    expect(res.body.id).toBe(res.body.userId);
    expect(typeof res.body.sessionExpiresAt).toBe("string");
    expect(new Date(res.body.sessionExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // Idle and absolute are both reported so the UI can show a countdown.
    expect(new Date(res.body.sessionIdleExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(res.body.sessionAbsoluteExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.reauthenticatedAt).toBeNull();
  });

  it("reports canEdit false for a viewer", async () => {
    await t.createUser({ username: "vic", password: STRONG, role: "viewer" });
    const agent = await t.loginAs("vic", STRONG);
    const res = await agent.get("/api/auth/me");
    expect(res.body.role).toBe("viewer");
    expect(res.body.canEdit).toBe(false);
  });

  it("reports reauthenticatedAt after a re-auth, and canAdminAccess from the DB", async () => {
    const userId = await t.createUser({
      username: "alice",
      password: STRONG,
      role: "admin",
      canAdminAccess: true,
    });
    const agent = await t.loginAs("alice", STRONG);
    const before = await agent.get("/api/auth/me");
    expect(before.body.reauthenticatedAt).toBeNull();
    expect(before.body.canAdminAccess).toBe(true);

    const reauth = await agent.post("/api/auth/reauth").send({ password: STRONG });
    expect(reauth.status).toBe(200);
    const after = await agent.get("/api/auth/me");
    expect(after.body.reauthenticatedAt).toBeTruthy();
    expect(new Date(after.body.reauthenticatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    void userId;
  });

  it("answers 401 {authenticated:false} with no session and a code when expired", async () => {
    const res = await request(t.app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
    // No session at all: no code, because nothing expired — the caller was never
    // signed in. The SPA treats both the same way.
    expect(res.body.code).toBeUndefined();
  });
});