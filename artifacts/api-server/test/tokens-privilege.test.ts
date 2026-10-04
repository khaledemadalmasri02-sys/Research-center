// A1 — self-service privilege escalation via the API-token scope picker.
//
// A `viewer`-session POST to /api/tokens with "admin" in `scopes` must be
// rejected AND must not write a token row; an admin session may still mint
// one; and a *stored* token holding the "admin" scope but owned by a
// non-admin must resolve to canAdminAccess === false.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";
import { __resetRateLimits, rateLimit, hashPassword, hashOtp, verifyOtp } from "../src/lib/security";
import { pool } from "@workspace/db";
import { issueToken } from "../src/lib/apiToken";

describe("A1 — /api/tokens admin scope is not self-service", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
  });

  async function countTokens(userId: number): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "api_tokens" WHERE "user_id" = $1`,
      [userId],
    );
    return Number(rows[0]!.count);
  }

  it("rejects a viewer-session POST that asks for the admin scope", async () => {
    const userId = await t.createUser({
      username: "scope-viewer",
      password: "StrongPass1!",
      role: "viewer",
    });
    const agent = await t.loginAs("scope-viewer", "StrongPass1!");
    const before = await countTokens(userId);
    const res = await agent.post("/api/tokens").send({
      name: "self-escalation",
      scopes: ["admin", "read"],
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
    // No token row may be written for the rejected request.
    expect(await countTokens(userId)).toBe(before);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "api_tokens" WHERE "user_id" = $1`,
      [userId],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("rejects an editor-session POST that asks for the admin scope", async () => {
    const userId = await t.createUser({
      username: "scope-editor",
      password: "StrongPass1!",
      role: "editor",
    });
    const agent = await t.loginAs("scope-editor", "StrongPass1!");
    const res = await agent
      .post("/api/tokens")
      .send({ name: "escalate", scopes: ["admin"] });
    expect(res.status).toBe(403);
    expect(await countTokens(userId)).toBe(0);
  });

  it("lets an admin session mint an admin-scoped token", async () => {
    const userId = await t.createUser({
      username: "scope-admin",
      password: "StrongPass1!",
      role: "admin",
      canAdminAccess: true,
    });
    const agent = await t.loginAs("scope-admin", "StrongPass1!");
    const res = await agent
      .post("/api/tokens")
      .send({ name: "automation", scopes: ["admin", "read", "write"] });

    expect(res.status).toBe(201);
    expect(res.body.scopes).toContain("admin");
    expect(typeof res.body.token).toBe("string");
    expect(await countTokens(userId)).toBe(1);
  });

  it("still issues non-admin scopes for non-admins", async () => {
    const userId = await t.createUser({
      username: "scope-plain",
      password: "StrongPass1!",
      role: "editor",
    });
    const agent = await t.loginAs("scope-plain", "StrongPass1!");
    const res = await agent
      .post("/api/tokens")
      .send({ name: "reader", scopes: ["records:read"] });
    expect(res.status).toBe(201);
    expect(res.body.scopes).toEqual(["records:read"]);
    expect(await countTokens(userId)).toBe(1);
  });

  it("rate-limits token issuance (audit + limit on issuance)", async () => {
    const userId = await t.createUser({
      username: "scope-flood",
      password: "StrongPass1!",
      role: "editor",
    });
    const agent = await t.loginAs("scope-flood", "StrongPass1!");
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await agent.post("/api/tokens").send({ name: `t${i}`, scopes: ["read"] });
      statuses.push(res.status);
    }
    expect(statuses[0]).toBe(201);
    expect(statuses).toContain(429);
    // The per-user budget is 5, so at most 5 rows can exist.
    expect(await countTokens(userId)).toBeLessThanOrEqual(5);

    // Every issuance (allowed or denied) is audited.
    const { rows } = await pool.query<{ action: string }>(
      `SELECT action FROM "audit_log" WHERE action LIKE 'api_token.create%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});

describe("A1 — an admin-scoped token never out-privileges its owner", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
  });

  /**
   * Proves the effective privilege end to end: `GET /api/users` is behind
   * requireAdmin, so it answers 403 unless the resolved session really has
   * canAdminAccess.
   */
  async function adminRouteStatus(plaintext: string): Promise<number> {
    const res = await request(t.app)
      .get("/api/users")
      .set("Authorization", `Bearer ${plaintext}`);
    return res.status;
  }

  it("403s an admin-only route for an admin-scoped token owned by a non-admin", async () => {
    const userId = await t.createUser({
      username: "token-owner",
      password: "StrongPass1!",
      role: "editor",
      canAdminAccess: false,
    });

    // Written straight to the table: the route refuses to mint this for a
    // non-admin, so this reproduces tokens issued before the fix.
    const issued = await issueToken(userId, "legacy-admin", ["admin", "write"]);
    expect(issued.scopes).toContain("admin");
    expect(await adminRouteStatus(issued.plaintext)).toBe(403);
  });

  it("allows an admin-only route for an admin-scoped token owned by an admin", async () => {
    const userId = await t.createUser({
      username: "token-owner-admin",
      password: "StrongPass1!",
      role: "admin",
      canAdminAccess: true,
    });
    const issued = await issueToken(userId, "real-admin", ["admin"]);
    expect(await adminRouteStatus(issued.plaintext)).toBe(200);
  });

  it("does not let a revoked token authenticate", async () => {
    const userId = await t.createUser({
      username: "token-revoked",
      password: "StrongPass1!",
      role: "editor",
    });
    const issued = await issueToken(userId, "revoked", ["read"]);
    await request(t.app)
      .delete(`/api/tokens/${issued.id}`)
      .set("Authorization", `Bearer ${issued.plaintext}`);
    expect(await adminRouteStatus(issued.plaintext)).toBe(401);
  });
});

describe("A1 — supporting invariants", () => {
  it("rateLimit buckets are independent per key and resettable", () => {
    expect(rateLimit("bucket-a", 1, 60_000).success).toBe(true);
    expect(rateLimit("bucket-a", 1, 60_000).success).toBe(false);
    expect(rateLimit("bucket-b", 1, 60_000).success).toBe(true);
    __resetRateLimits();
    expect(rateLimit("bucket-a", 1, 60_000).success).toBe(true);
  });

  it("passwords still use a bcrypt KDF while OTPs do not", async () => {
    const hash = await hashPassword("StrongPass1!");
    expect(hash.startsWith("$2")).toBe(true);

    const otpHash = hashOtp("123456");
    expect(otpHash.startsWith("sha256$")).toBe(true);
    expect(otpHash).not.toContain("123456");
    expect(verifyOtp("123456", otpHash)).toBe(true);
    expect(verifyOtp("654321", otpHash)).toBe(false);
    // Salts differ per OTP, so identical codes hash differently.
    expect(hashOtp("123456")).not.toBe(otpHash);
    // Legacy bcrypt hashes fail closed rather than being treated as a match.
    expect(verifyOtp("123456", hash)).toBe(false);
  });
});
