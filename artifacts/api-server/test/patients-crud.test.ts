// P2.9 — /api/patients test slice.
//
// Validates CRUD on patients and exercises the new zod validate()
// middleware (P2.5). Each test runs in a fresh DB (withDb() truncates
// after every test) and uses the real api-server app + supertest.

import { describe, it, expect, beforeEach } from "vitest";
import { withDb, type DbFixture } from "./helpers/db";

describe("P2.9 — /api/patients", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "alice",
      password: "CorrectHorse42",
      role: "editor",
      canAdminAccess: false,
    });
    await t.createUser({
      username: "bob",
      password: "CorrectHorse42",
      role: "editor",
      canAdminAccess: false,
    });
  });

  // ----- Auth gate ---------------------------------------------------------

  it("returns 401 for unauthenticated requests", async () => {
    const { default: request } = await import("supertest");
    const res = await request(t.app).get("/api/patients");
    expect(res.status).toBe(401);
  });

  // ----- CRUD happy path ---------------------------------------------------

  it("creates a patient, fetches it, updates it, then deletes it", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");

    // Create
    const create = await agent
      .post("/api/patients")
      .send({ patientId: "P001", patientName: "Alice Patient", age: 42, sex: "Female" });
    expect(create.status).toBe(201);
    const id = create.body.id as number;
    expect(typeof id).toBe("number");
    expect(create.body.patientId).toBe("P001");
    expect(create.body.sex).toBe("Female");

    // List — patient is visible
    const list = await agent.get("/api/patients");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.patients).toHaveLength(1);
    expect(list.body.patients[0].id).toBe(id);

    // Read by id
    const read = await agent.get(`/api/patients/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.patientId).toBe("P001");

    // Patch
    const patch = await agent
      .patch(`/api/patients/${id}`)
      .send({ age: 43, chiefComplaint: "Headache" });
    expect(patch.status).toBe(200);
    expect(patch.body.age).toBe(43);
    expect(patch.body.chiefComplaint).toBe("Headache");

    // Delete
    const del = await agent.delete(`/api/patients/${id}`);
    expect(del.status).toBe(204);

    // List is now empty
    const listAfter = await agent.get("/api/patients");
    expect(listAfter.body.total).toBe(0);
    expect(listAfter.body.patients).toHaveLength(0);
  });

  // ----- Per-user isolation ------------------------------------------------

  it("does not return alice's patients to bob", async () => {
    const alice = await t.loginAs("alice", "CorrectHorse42");
    const bob = await t.loginAs("bob", "CorrectHorse42");

    await alice
      .post("/api/patients")
      .send({ patientId: "P-ALICE", patientName: "Alice's Patient" });

    const aliceList = await alice.get("/api/patients");
    expect(aliceList.body.total).toBe(1);
    expect(aliceList.body.patients[0].patientId).toBe("P-ALICE");

    const bobList = await bob.get("/api/patients");
    expect(bobList.body.total).toBe(0);
    expect(bobList.body.patients).toHaveLength(0);
  });

  it("returns 404 when bob tries to read alice's patient by id", async () => {
    const alice = await t.loginAs("alice", "CorrectHorse42");
    const bob = await t.loginAs("bob", "CorrectHorse42");

    const create = await alice
      .post("/api/patients")
      .send({ patientId: "P-ISO", patientName: "Isolated" });
    const id = create.body.id as number;

    const read = await bob.get(`/api/patients/${id}`);
    expect(read.status).toBe(404);
  });

  // ----- Validation (P2.5 zod) ---------------------------------------------

  it("returns 400 with structured issues when the create body is invalid", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    // Missing required patientId + patientName
    const res = await agent
      .post("/api/patients")
      .send({ age: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.issues)).toBe(true);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    // Both required fields should appear in the issues list.
    expect(paths).toEqual(expect.arrayContaining(["patientId", "patientName"]));
  });

  it("returns 400 with structured issues when the :id is not an integer", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.get("/api/patients/not-a-number");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    const sources = res.body.issues.map((i: { source: string }) => i.source);
    expect(sources).toContain("params");
  });

  it("rejects an empty patch body (refine: at least one field required)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const create = await agent
      .post("/api/patients")
      .send({ patientId: "P003", patientName: "Patch test" });
    const id = create.body.id as number;
    const res = await agent.patch(`/api/patients/${id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  // ----- Search filter -----------------------------------------------------

  it("filters the list by the search query", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    await agent.post("/api/patients").send({ patientId: "P-A", patientName: "Alpha" });
    await agent.post("/api/patients").send({ patientId: "P-B", patientName: "Beta" });
    await agent.post("/api/patients").send({ patientId: "P-C", patientName: "Gamma" });

    const res = await agent.get("/api/patients?search=Alpha");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.patients[0].patientName).toBe("Alpha");
  });

  // ----- Stats -------------------------------------------------------------

  it("returns 0 totals when alice has no patients", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.get("/api/patients/stats");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.maleCount).toBe(0);
    expect(res.body.femaleCount).toBe(0);
    expect(res.body.recentCount).toBe(0);
  });
});
