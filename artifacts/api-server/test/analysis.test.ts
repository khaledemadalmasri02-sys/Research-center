import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

// Realistic but tiny CSV: two numeric columns (age, bp) and one string
// (sex) so we can exercise t-test, ANOVA, correlation, regression.
const SAMPLE_CSV = [
  "patient_id,age,bp,sex,group",
  "P001,45,120,M,A",
  "P002,52,135,M,A",
  "P003,38,118,F,B",
  "P004,61,142,M,A",
  "P005,29,110,F,B",
  "P006,55,130,M,C",
  "P007,47,125,F,A",
  "P008,33,115,M,B",
  "P009,68,150,M,C",
  "P010,42,122,F,B",
].join("\n");

async function uploadDataset(
  agent: Awaited<ReturnType<DbFixture["loginAs"]>>,
  csv: string,
  filename = "patients.csv",
): Promise<{ id: number; variables: { name: string }[] }> {
  const res = await agent
    .post("/api/analysis/datasets")
    .attach("file", Buffer.from(csv, "utf8"), filename)
    .field("name", "Test patients");
  expect(res.status).toBe(201);
  return res.body as { id: number; variables: { name: string }[] };
}

describe("analysis.upload + analyze (P0.3 — slice 4)", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "analyst",
      password: "StrongPass1!",
    });
  });

  it("rejects unauthenticated dataset upload with 401", async () => {
    const res = await request(t.app)
      .post("/api/analysis/datasets")
      .attach("file", Buffer.from(SAMPLE_CSV), "patients.csv");
    expect(res.status).toBe(401);
  });

  it("rejects upload with no file with 400", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const res = await agent.post("/api/analysis/datasets");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No file uploaded." });
  });

  it("uploads a CSV, parses variables, and lists it under the owner", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);
    expect(ds.id).toBeGreaterThan(0);
    expect(ds.variables.map((v) => v.name).sort()).toEqual(
      ["age", "bp", "group", "patient_id", "sex"].sort(),
    );

    const list = await agent.get("/api/analysis/datasets");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: ds.id,
      source: "upload",
      format: "csv",
      rowCount: 10,
    });
  });

  it("does not leak another user's dataset via the list endpoint", async () => {
    const agentA = await t.loginAs("analyst", "StrongPass1!");
    await uploadDataset(agentA, SAMPLE_CSV);

    await t.createUser({
      username: "other",
      password: "StrongPass1!",
    });
    const agentB = await t.loginAs("other", "StrongPass1!");
    const list = await agentB.get("/api/analysis/datasets");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it("runs an independent t-test on a numeric column", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const run = await agent
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "ttest",
        options: {
          mode: "independent",
          dependent: "age",
          groupVariable: "sex",
        },
      });
    expect(run.status).toBe(201);
    expect(run.body).toHaveProperty("id");
    // The result body has a t-stat and a p-value (Welch's t-test default).
    expect(run.body.stats).toHaveProperty("t");
    expect(run.body.stats).toHaveProperty("p");
  });

  it("runs a one-way ANOVA across three groups", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const run = await agent
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "anova",
        options: { dependent: "age", group: "group" },
      });
    expect(run.status).toBe(201);
    // F-statistic and p-value. The lib/stats engine uses "F" (capital).
    expect(run.body.stats).toHaveProperty("F");
    expect(run.body.stats).toHaveProperty("p");
  });

  it("runs a Pearson correlation between two numeric columns", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const run = await agent
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "correlation",
        options: { method: "pearson", variables: ["age", "bp"] },
      });
    expect(run.status).toBe(201);
    // Result is JSON: look for either "r":<num> or "r=..." in tables.
    const flat = JSON.stringify(run.body);
    expect(flat).toMatch(/r["':\s=]/);
  });

  it("runs a descriptive summary", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const run = await agent
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "descriptive",
        options: { variable: "age" },
      });
    expect(run.status).toBe(201);
    const flat = JSON.stringify(run.body);
    // mean, std, min, max
    expect(flat).toMatch(/mean/i);
    expect(flat).toMatch(/std/i);
  });

  it("rejects analysis on a non-existent dataset with 400", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const res = await agent
      .post("/api/analysis/datasets/99999/analyze")
      .send({
        type: "descriptive",
        options: { variable: "age" },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("rejects analysis on another user's dataset with 400", async () => {
    const agentA = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agentA, SAMPLE_CSV);

    await t.createUser({
      username: "other2",
      password: "StrongPass1!",
    });
    const agentB = await t.loginAs("other2", "StrongPass1!");
    const res = await agentB
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "descriptive",
        options: { variable: "age" },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("persists a run and fetches it back via GET /runs/:id", async () => {
    const agent = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const run = await agent
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({
        type: "descriptive",
        options: { variable: "age" },
      });
    expect(run.status).toBe(201);
    const runId: number = run.body.id;

    const fetched = await agent.get(`/api/analysis/runs/${runId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      id: runId,
      type: "descriptive",
      datasetId: ds.id,
    });
  });

  it("returns 404 for a run owned by someone else", async () => {
    const agentA = await t.loginAs("analyst", "StrongPass1!");
    const ds = await uploadDataset(agentA, SAMPLE_CSV);
    const run = await agentA
      .post(`/api/analysis/datasets/${ds.id}/analyze`)
      .send({ type: "descriptive", options: { variable: "age" } });
    expect(run.status).toBe(201);

    await t.createUser({
      username: "other3",
      password: "StrongPass1!",
    });
    const agentB = await t.loginAs("other3", "StrongPass1!");
    const res = await agentB.get(`/api/analysis/runs/${run.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe("analysis.chart + export (P0.3 — slice 4)", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "chartuser",
      password: "StrongPass1!",
    });
  });

  it("builds a histogram for a numeric column", async () => {
    const agent = await t.loginAs("chartuser", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const res = await agent
      .post(`/api/analysis/datasets/${ds.id}/chart`)
      .send({ kind: "histogram", variable: "age" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("histogram");
    expect(res.body.variable).toBe("age");
    expect(Array.isArray(res.body.bins)).toBe(true);
  });

  it("builds a scatter plot for two numeric columns", async () => {
    const agent = await t.loginAs("chartuser", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const res = await agent
      .post(`/api/analysis/datasets/${ds.id}/chart`)
      .send({ kind: "scatter", variable: "age", variable2: "bp" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("scatter");
    expect(res.body.points.length).toBe(10);
  });

  it("builds a bar chart for a categorical column", async () => {
    const agent = await t.loginAs("chartuser", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const res = await agent
      .post(`/api/analysis/datasets/${ds.id}/chart`)
      .send({ kind: "bar", variable: "sex" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("bar");
    expect(Array.isArray(res.body.bars)).toBe(true);
  });

  it("rejects chart on a non-existent dataset with 400", async () => {
    const agent = await t.loginAs("chartuser", "StrongPass1!");
    const res = await agent
      .post("/api/analysis/datasets/99999/chart")
      .send({ kind: "histogram", variable: "age" });
    expect(res.status).toBe(400);
  });

  it("exports a dataset to CSV with the right content type", async () => {
    const agent = await t.loginAs("chartuser", "StrongPass1!");
    const ds = await uploadDataset(agent, SAMPLE_CSV);

    const res = await agent
      .post(`/api/analysis/datasets/${ds.id}/export`)
      .send({ format: "csv" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const body = res.text;
    expect(body).toContain("age,bp,sex,group");
    // Round-trip: parse and check row count.
    const rows = body.trim().split("\n");
    expect(rows.length).toBe(11); // 10 data + 1 header
  });
});

describe("analysis.from-query (P0.3 — slice 4)", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await t.createUser({
      username: "queryuser",
      password: "StrongPass1!",
    });
  });

  it("rejects a query with no valid columns with 400", async () => {
    const agent = await t.loginAs("queryuser", "StrongPass1!");
    const res = await agent
      .post("/api/analysis/datasets/from-query")
      .send({ columns: ["nonexistent"] });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(t.app)
      .post("/api/analysis/datasets/from-query")
      .send({ columns: ["age", "sex"] });
    expect(res.status).toBe(401);
  });
});