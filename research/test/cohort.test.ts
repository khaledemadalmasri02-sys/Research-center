import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, adminUser, viewerUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";

function canEditLike(u: any) {
  return !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin");
}

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => canEditLike(u),
  requirePatientScope: (_c: any, u: any) =>
    canEditLike(u) ? null : new Response("Forbidden", { status: 403 }),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;
const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;

describe("cohort builder", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    audit.mockReset();
    db.calls = [];
  });

  const patients = [
    { id: 1, patient_id: "P1", age: 30, sex: "Male", final_confirmed_diagnosis: "Asthma" },
    { id: 2, patient_id: "P2", age: 45, sex: "Female", final_confirmed_diagnosis: "Hypertension" },
  ];

  it("builds a cohort from filters", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.includes("FROM patients") ? { results: patients } : {});
    const res = await app.request(
      "/api/cohort/build",
      { method: "POST", body: JSON.stringify({ filters: [{ field: "sex", op: "eq", value: "Male" }] }) },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(Array.isArray(body.cohort)).toBe(true);
  });

  it("rejects filters with a non-allowed field (no SQL injection surface)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.includes("FROM patients") ? { results: [] } : {});
    const res = await app.request(
      "/api/cohort/build",
      { method: "POST", body: JSON.stringify({ filters: [{ field: "version_no; DROP TABLE patients", op: "eq", value: "x" }] }) },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    // ensure the malicious field never reached the SQL
    expect(db.calls.some((c) => c.sql.includes("DROP TABLE"))).toBe(false);
  });

  it("exports the cohort as CSV", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.includes("FROM patients") ? { results: patients } : {});
    const res = await app.request(
      "/api/cohort/export",
      { method: "POST", body: JSON.stringify({ filters: [] }) },
      env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const csv = await res.text();
    expect(csv).toContain("patient_id,age,sex,final_confirmed_diagnosis");
    expect(csv).toContain("P1,30,Male,Asthma");
  });

  it("returns a codebook of allowed fields", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request("/api/cohort/codebook", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.codebook.some((f: any) => f.field === "age" && f.type === "integer")).toBe(true);
  });

  it("computes a cross-tabulation", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("GROUP BY") ? { results: [{ rowVal: "Male", colVal: "Asthma", count: 1 }] } : {};
    const res = await app.request(
      "/api/cohort/stats",
      { method: "POST", body: JSON.stringify({ rowField: "sex", colField: "final_confirmed_diagnosis" }) },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cells[0]).toMatchObject({ rowVal: "Male", colVal: "Asthma", count: 1 });
  });
});

describe("cohort bulk export authorisation (W5)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    audit.mockReset();
    db.calls = [];
    db.responder = (sql) => (sql.includes("FROM patients") ? { results: [] } : {});
  });

  const ROSTER_BODY = JSON.stringify({
    fields: ["patient_name", "chief_complaint"],
    filters: [],
  });

  it("denies a viewer on POST /export", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/cohort/export",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: ROSTER_BODY },
      env
    );
    expect(res.status).toBe(403);
    // And no patient row was read at all.
    expect(db.calls.some((c) => c.sql.includes("FROM patients"))).toBe(false);
  });

  it("denies a viewer on POST /build", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/cohort/build",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: ROSTER_BODY },
      env
    );
    expect(res.status).toBe(403);
    expect(db.calls.some((c) => c.sql.includes("FROM patients"))).toBe(false);
  });

  it("denies a viewer on POST /stats", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/cohort/stats",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowField: "sex", colField: "chief_complaint" }),
      },
      env
    );
    expect(res.status).toBe(403);
  });

  it("401 when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await app.request(
      "/api/cohort/export",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: ROSTER_BODY },
      env
    );
    expect(res.status).toBe(401);
  });

  it("allows an editor and an admin", async () => {
    for (const user of [editorUser, adminUser]) {
      db.calls = [];
      auth.mockResolvedValue({ user });
      const res = await app.request(
        "/api/cohort/export",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        env
      );
      expect(res.status).toBe(200);
    }
  });

  it("still lets a viewer read the (non-patient) codebook", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/cohort/codebook", { method: "GET" }, env);
    expect(res.status).toBe(200);
  });
});

describe("cohort export audit detail (W5)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    audit.mockReset();
    db.calls = [];
    db.responder = (sql) =>
      sql.includes("FROM patients")
        ? { results: [{ id: 1, patient_name: "John Doe", chief_complaint: "cough" }] }
        : {};
  });

  it("records the full field list and filters, not just a count", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request(
      "/api/cohort/export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: ["patient_name", "chief_complaint"],
          filters: [
            { field: "sex", op: "eq", value: "Male" },
            { field: "chief_complaint", op: "contains", value: "cough" },
          ],
        }),
      },
      env
    );
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.action).toBe("cohort.export");
    expect(params.detail.fields).toEqual(["patient_name", "chief_complaint"]);
    expect(params.detail.filters).toEqual([
      { field: "sex", op: "eq", value: "Male" },
      { field: "chief_complaint", op: "contains", value: "cough" },
    ]);
    expect(params.detail.count).toBe(1);
    // The previous implementation logged `{filters: undefined, count}`.
    expect(params.detail.filters).not.toBeUndefined();
  });

  it("records only filters that were actually applied", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request(
      "/api/cohort/build",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: [
            { field: "sex", op: "eq", value: "Male" },
            { field: "not_a_field", op: "eq", value: "x" },
            { field: "age", op: "DROP TABLE", value: "x" },
          ],
        }),
      },
      env
    );
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.action).toBe("cohort.build");
    expect(params.detail.filters).toEqual([{ field: "sex", op: "eq", value: "Male" }]);
    // Default column set is logged explicitly, not as `undefined`.
    expect(params.detail.fields).toEqual([
      "id",
      "patient_id",
      "age",
      "sex",
      "final_confirmed_diagnosis",
    ]);
  });

  it("records the paging window on export", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request(
      "/api/cohort/export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: [], limit: 5, offset: 10 }),
      },
      env
    );
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.detail.limit).toBe(5);
    expect(params.detail.offset).toBe(10);
    const q = db.calls.find((c) => c.sql.includes("FROM patients"))!;
    expect(q.sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(q.binds).toContain(5);
    expect(q.binds).toContain(10);
  });

  it("caps an oversized export limit", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request(
      "/api/cohort/export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: [], limit: 1000000 }),
      },
      env
    );
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.detail.limit).toBe(10000);
    const q = db.calls.find((c) => c.sql.includes("FROM patients"))!;
    expect(q.binds).toContain(10000);
    expect(q.binds).not.toContain(1000000);
  });
});