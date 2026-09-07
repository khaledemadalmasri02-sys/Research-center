// P2.9 — /api/saved-views test slice.
//
// saved-views is a small CRUD endpoint for per-user filter presets.
// The zod validate() middleware (P2.5) replaces the old hand-rolled
// checks, so this file mainly exercises the new structured 400s and
// the per-user isolation.

import { describe, it, expect, beforeEach } from "vitest";
import { withDb, type DbFixture } from "./helpers/db";

describe("P2.9 — /api/saved-views", () => {
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

  it("creates, lists, patches, and deletes a saved view", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");

    const create = await agent.post("/api/saved-views").send({
      definitionId: 1,
      name: "My normal patients",
      filters: { collectionType: "Normal" },
    });
    expect(create.status).toBe(201);
    const id = create.body.view.id as number;

    const list = await agent.get("/api/saved-views");
    expect(list.status).toBe(200);
    expect(list.body.views).toHaveLength(1);
    expect(list.body.views[0].name).toBe("My normal patients");

    const read = await agent.get(`/api/saved-views/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.view.name).toBe("My normal patients");

    const patch = await agent
      .patch(`/api/saved-views/${id}`)
      .send({ name: "My Normal Patients" });
    expect(patch.status).toBe(200);
    expect(patch.body.view.name).toBe("My Normal Patients");

    const del = await agent.delete(`/api/saved-views/${id}`);
    expect(del.status).toBe(200);

    const listAfter = await agent.get("/api/saved-views");
    expect(listAfter.body.views).toHaveLength(0);
  });

  it("rejects a create body with a missing name (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/saved-views")
      .send({ definitionId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain("name");
  });

  it("rejects a create body with a non-positive definitionId (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent
      .post("/api/saved-views")
      .send({ definitionId: 0, name: "Bad" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch body via the at-least-one refine (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const create = await agent
      .post("/api/saved-views")
      .send({ definitionId: 1, name: "x" });
    const id = create.body.view.id as number;
    const res = await agent.patch(`/api/saved-views/${id}`).send({});
    expect(res.status).toBe(400);
  });

  it("isolates views between users", async () => {
    const alice = await t.loginAs("alice", "CorrectHorse42");
    const bob = await t.loginAs("bob", "CorrectHorse42");

    await alice.post("/api/saved-views").send({ definitionId: 1, name: "Alice view" });

    const bobList = await bob.get("/api/saved-views");
    expect(bobList.body.views).toHaveLength(0);

    const aliceList = await alice.get("/api/saved-views");
    expect(aliceList.body.views).toHaveLength(1);
  });

  it("rejects GET with a non-numeric id (400)", async () => {
    const agent = await t.loginAs("alice", "CorrectHorse42");
    const res = await agent.get("/api/saved-views/not-a-number");
    expect(res.status).toBe(400);
    const sources = res.body.issues.map((i: { source: string }) => i.source);
    expect(sources).toContain("params");
  });
});
