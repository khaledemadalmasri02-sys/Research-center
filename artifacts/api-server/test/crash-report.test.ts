// P1.18 — tests for the api-server /api/crash-report endpoint.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

describe("P1.18 — /api/crash-report", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    // The endpoint is unauthenticated; no user setup needed.
  });

  it("accepts a minimal valid report and returns 204", async () => {
    const res = await request(t.app)
      .post("/api/crash-report")
      .send({
        kind: "react",
        message: "Component X crashed",
        ts: new Date().toISOString(),
      });
    expect(res.status).toBe(204);
  });

  it("accepts a full payload (stack, componentStack, context)", async () => {
    const res = await request(t.app)
      .post("/api/crash-report")
      .send({
        kind: "windowerror",
        message: "Cannot read properties of undefined (reading 'x')",
        stack: "TypeError: ...\n  at foo (a.ts:1:1)",
        componentStack: "  at App\n  at Router",
        url: "https://example.com/x",
        userAgent: "Mozilla/5.0",
        ts: new Date().toISOString(),
        context: { route: "/x", build: "abc123" },
      });
    expect(res.status).toBe(204);
  });

  it("rejects a report with a missing or empty message", async () => {
    const res = await request(t.app)
      .post("/api/crash-report")
      .send({ kind: "react" });
    expect(res.status).toBe(400);
  });

  it("rejects a report with an overlong message", async () => {
    const res = await request(t.app)
      .post("/api/crash-report")
      .send({ message: "x".repeat(3000) });
    expect(res.status).toBe(400);
  });

  it("does not require authentication", async () => {
    // No `agent` — the endpoint must accept unauthenticated POSTs.
    const res = await request(t.app)
      .post("/api/crash-report")
      .send({ message: "anon crash" });
    expect(res.status).toBe(204);
  });
});
