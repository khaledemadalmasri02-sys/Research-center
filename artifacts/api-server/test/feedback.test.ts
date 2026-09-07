// P2.9 — /api/feedback test slice.
//
// Validates that the zod validate() middleware (P2.5) rejects
// malformed bodies with a structured 400 and accepts well-formed
// submissions, including the rating range and type enum.

import { describe, it, expect, beforeEach } from "vitest";
import { withDb, type DbFixture } from "./helpers/db";

describe("P2.9 — /api/feedback", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "alice",
      password: "CorrectHorse42",
      role: "editor",
      canAdminAccess: false,
    });
  });

  it("accepts a minimal valid submission and returns 201", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/feedback")
      .send({ message: "Great app!" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("number");
  });

  it("accepts a full submission with type + rating", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/feedback").send({
      type: "feature",
      message: "Please add dark mode",
      rating: 5,
    });
    expect(res.status).toBe(201);
  });

  it("rejects an empty message with a structured 400", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/feedback").send({ rating: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain("message");
  });

  it("rejects an unknown feedback type at the framework boundary", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/feedback")
      .send({ type: "spam", message: "Buy crypto!" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain("type");
  });

  it("rejects a rating outside 1-5 with a structured 400", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/feedback")
      .send({ message: "Rating test", rating: 7 });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain("rating");
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { default: request } = await import("supertest");
    const res = await request(t.app)
      .post("/api/feedback")
      .send({ message: "hi" });
    expect(res.status).toBe(401);
  });
});
