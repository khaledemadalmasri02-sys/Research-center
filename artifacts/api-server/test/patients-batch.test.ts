// P2.9 — /api/patients/batch test slice.
//
// The batch endpoint accepts a list of patient records and inserts
// them in chunks. Each row is processed independently: a single bad
// record lands in the per-row `errors` array, never as a 4xx on the
// whole batch.
//
// Tests in this file use the new zod validate() middleware (P2.5) to
// verify that empty/malformed bodies are rejected at the framework
// boundary, while the per-row zod errors continue to flow through the
// `results` array.

import { describe, it, expect, beforeEach } from "vitest";
import { withDb, type DbFixture } from "./helpers/db";

describe("P2.9 — /api/patients/batch", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "alice",
      password: "CorrectHorse42",
      role: "editor",
      canAdminAccess: false,
    });
  });

  it("imports a small batch and reports per-row success", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/patients/batch").send({
      patients: [
        { patientId: "B-1", patientName: "One" },
        { patientId: "B-2", patientName: "Two" },
        { patientId: "B-3", patientName: "Three" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(3);
    expect(res.body.failed).toBe(0);
    for (const r of res.body.results) {
      expect(r.errors).toBeUndefined();
      expect(typeof r.id).toBe("number");
    }

    // All three are now in the list.
    const list = await agent.get("/api/patients");
    expect(list.body.total).toBe(3);
  });

  it("reports per-row errors without failing the whole batch", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/patients/batch").send({
      patients: [
        { patientId: "B-OK", patientName: "Valid" },
        // patientName is required by the underlying zod schema; missing
        // it should land in this row's `errors`, not 4xx the request.
        { patientId: "B-MISSING-NAME" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1);
    expect(res.body.failed).toBe(1);

    const [first, second] = res.body.results as Array<{
      id?: number;
      errors?: string[];
    }>;
    expect(first.id).toBeDefined();
    expect(first.errors).toBeUndefined();
    expect(second.id).toBeUndefined();
    expect(Array.isArray(second.errors)).toBe(true);
    expect(second.errors!.length).toBeGreaterThan(0);
  });

  it("rejects an empty patients array at the framework boundary (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/patients/batch").send({ patients: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain("patients");
  });

  it("rejects a missing patients field at the framework boundary (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.post("/api/patients/batch").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects a non-array patients field (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/patients/batch")
      .send({ patients: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});
