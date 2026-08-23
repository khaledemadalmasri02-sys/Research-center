import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("cohort builder", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
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
