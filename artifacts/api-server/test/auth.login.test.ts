import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

describe("auth.login (P0.3 — slice 1)", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    // Create a user with no email (legacy / dev path) so login issues a
    // session directly, bypassing the 2FA email roundtrip.
    await t.createUser({
      username: "alice",
      password: "CorrectHorse42",
      role: "editor",
      canAdminAccess: false,
    });
  });

  it("returns 400 when username or password is missing", async () => {
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Username and password are required." });
  });

  it("returns 401 for an unknown user with consistent timing", async () => {
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "nobody", password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials." });
  });

  it("returns 401 for a wrong password", async () => {
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "WrongPass123" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials." });
  });

  it("increments failed_attempts on a wrong password", async () => {
    await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "wrong1" });
    const r = await t.pool.query<{ failed_attempts: number }>(
      `SELECT "failed_attempts" FROM "users" WHERE "username" = $1`,
      ["alice"],
    );
    expect(r.rows[0].failed_attempts).toBe(1);
  });

  it("locks the account after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await request(t.app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "wrong" });
    }
    const r = await t.pool.query<{
      failed_attempts: number;
      locked_until: string | null;
    }>(
      `SELECT "failed_attempts", "locked_until" FROM "users" WHERE "username" = $1`,
      ["alice"],
    );
    expect(r.rows[0].failed_attempts).toBe(5);
    expect(r.rows[0].locked_until).not.toBeNull();
    // The api-server uses `timestamp` (no timezone) so we compare on the
    // server side via SQL to avoid Node <-> Postgres timezone drift.
    const cmp = await t.pool.query<{ remaining_ms: number }>(
      `SELECT EXTRACT(EPOCH FROM ("locked_until" - now())) * 1000 AS remaining_ms
         FROM "users" WHERE "username" = $1`,
      ["alice"],
    );
    expect(Number(cmp.rows[0].remaining_ms)).toBeGreaterThan(0);
  });

  it("returns 429 when the account is locked even with the right password", async () => {
    for (let i = 0; i < 5; i++) {
      await request(t.app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "wrong" });
    }
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "CorrectHorse42" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/locked/i);
  });

  it("issues a session for a password-only user (no email) and reports role", async () => {
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "CorrectHorse42" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      username: "alice",
      role: "editor",
      canAdminAccess: false,
    });
    // Session cookie should be set.
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(String(res.headers["set-cookie"])).toMatch(/^rc_sid=/);
  });

  it("resets failed_attempts on a successful login", async () => {
    // Bump failed_attempts to 2, then succeed.
    await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "wrong" });
    await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "wrong" });
    await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "CorrectHorse42" });
    const r = await t.pool.query<{ failed_attempts: number }>(
      `SELECT "failed_attempts" FROM "users" WHERE "username" = $1`,
      ["alice"],
    );
    expect(r.rows[0].failed_attempts).toBe(0);
  });

  it("rejects pending accounts with 403", async () => {
    await t.createUser({
      username: "pending-user",
      password: "CorrectHorse42",
      role: "editor",
      status: "pending",
    });
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "pending-user", password: "CorrectHorse42" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/pending/);
  });

  it("rejects suspended accounts with 403", async () => {
    await t.createUser({
      username: "suspended-user",
      password: "CorrectHorse42",
      role: "editor",
      status: "suspended",
    });
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "suspended-user", password: "CorrectHorse42" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/);
  });

  it("rate-limits more than 10 attempts per IP in 15 minutes", async () => {
    for (let i = 0; i < 10; i++) {
      await request(t.app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "wrong" });
    }
    const res = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "alice", password: "wrong" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Too many attempts/);
  });
});