import { describe, it, expect } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

// Reset the in-memory rate-limit buckets between tests so per-IP
// counters from one test don't leak into the next.
const { __resetRateLimits } = await import("../src/lib/security.ts");

describe("P1.3 — body parser limit + per-IP rate limits", () => {
  const t: DbFixture = withDb();

  it("rejects a 2 MB JSON body with 413 (default 1 MB limit)", async () => {
    __resetRateLimits();
    // 2 MB of valid JSON. We pad the string and parse it so the
    // server actually tries to allocate the buffer.
    const huge = "x".repeat(2 * 1024 * 1024);
    const body = JSON.stringify({ username: "a", password: huge });
    const res = await request(t.app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(body);
    // express's body-parser emits 413 Payload Too Large.
    expect(res.status).toBe(413);
  }, 15_000);

  it("rejects a >1 MB JSON body on a normal route (default 1 MB)", async () => {
    __resetRateLimits();
    await t.createUser({ username: "r1", password: "StrongPass1!" });
    const agent = await t.loginAs("r1", "StrongPass1!");
    // /api/patients requires auth + a JSON body. Pad to slightly over 1 MB.
    const huge = "x".repeat(1.2 * 1024 * 1024);
    const body = JSON.stringify({ notes: huge });
    const res = await agent
      .post("/api/patients")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(413);
  }, 15_000);

  it("rate-limits /api/storage/uploads/request-url per IP", async () => {
    __resetRateLimits();
    await t.createUser({
      username: "u1",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("u1", "StrongPass1!");

    // 60 requests in the budget should all be 200 (or 500 if the
    // objectStorageService misbehaves; we accept anything non-429).
    for (let i = 0; i < 60; i++) {
      const res = await agent
        .post("/api/storage/uploads/request-url")
        .send({
          name: "a.png",
          size: 100,
          contentType: "image/png",
        });
      expect(res.status).not.toBe(429);
    }
    // 61st must be 429.
    const blocked = await agent
      .post("/api/storage/uploads/request-url")
      .send({
        name: "a.png",
        size: 100,
        contentType: "image/png",
      });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("rate-limits /api/storage/upload-file per IP", async () => {
    __resetRateLimits();
    await t.createUser({
      username: "u2",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("u2", "StrongPass1!");

    // The route may 200/500 (no body validation), but should not 429
    // for the first 30 calls.
    for (let i = 0; i < 30; i++) {
      const res = await agent
        .post("/api/storage/upload-file")
        .send({ patientId: "p1" });
      expect(res.status).not.toBe(429);
    }
    const blocked = await agent
      .post("/api/storage/upload-file")
      .send({ patientId: "p1" });
    expect(blocked.status).toBe(429);
  });

  it("rate-limits /api/analysis/datasets upload per IP", async () => {
    __resetRateLimits();
    await t.createUser({
      username: "u3",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("u3", "StrongPass1!");
    const csv = "patient_id,age\nP1,30\nP2,40\n";

    // 20 successful dataset uploads (or 200/500 on each) — the test
    // only asserts the rate limit, not the parse logic.
    for (let i = 0; i < 20; i++) {
      const res = await agent
        .post("/api/analysis/datasets")
        .attach("file", Buffer.from(csv), "t.csv")
        .field("name", "t");
      expect(res.status).not.toBe(429);
    }
    const blocked = await agent
      .post("/api/analysis/datasets")
      .attach("file", Buffer.from(csv), "t.csv")
      .field("name", "t");
    expect(blocked.status).toBe(429);
  });

  it("rate-limits /api/analysis/datasets/:id/analyze per IP", async () => {
    __resetRateLimits();
    await t.createUser({
      username: "u4",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("u4", "StrongPass1!");

    // We need a real dataset to analyze, but the rate limit fires
    // before the dataset is loaded (it's the first check after
    // requireAuth). So requests for a non-existent dataset still
    // count toward the rate limit; the first 30 return 400 ("Dataset
    // not found"), the 31st returns 429.
    for (let i = 0; i < 30; i++) {
      const res = await agent
        .post("/api/analysis/datasets/9999/analyze")
        .send({ type: "descriptive", options: { variable: "age" } });
      expect(res.status).not.toBe(429);
    }
    const blocked = await agent
      .post("/api/analysis/datasets/9999/analyze")
      .send({ type: "descriptive", options: { variable: "age" } });
    expect(blocked.status).toBe(429);
  });

  it("rate-limits /api/storage/images/import per IP", async () => {
    __resetRateLimits();
    await t.createUser({
      username: "u5",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("u5", "StrongPass1!");

    // Bad URL bodies return 400/500 — we just need the rate limit to
    // not fire until the 31st request.
    for (let i = 0; i < 30; i++) {
      const res = await agent
        .post("/api/storage/images/import")
        .send({ url: "file:///etc/passwd" });
      expect(res.status).not.toBe(429);
    }
    const blocked = await agent
      .post("/api/storage/images/import")
      .send({ url: "file:///etc/passwd" });
    expect(blocked.status).toBe(429);
  });
});
