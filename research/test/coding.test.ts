import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  requirePatientScope: (_c: any, u: any) =>
    !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin")
      ? null
      : new Response("Forbidden", { status: 403 }),
  loadScopedRecord: async (c: any, recordId: number, user: any) => {
    const admin = !!user?.canAdminAccess;
    const stmt = admin
      ? c.env.DB.prepare("SELECT * FROM records WHERE id = ?").bind(recordId)
      : c.env.DB
          .prepare("SELECT * FROM records WHERE id = ? AND user_id = ?")
          .bind(recordId, user?.id ?? -1);
    const rec = await stmt.first();
    if (!rec) return null;
    let data: any = {};
    try {
      data = typeof rec.data === "string" ? JSON.parse(rec.data) : rec.data;
    } catch {
      data = {};
    }
    return { id: rec.id, data };
  },
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;
const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;

describe("diagnosis coding (ICD-10 / SNOMED)", () => {
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

  it("searches the terminology table by code or display", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("FROM terminology_codes")
        ? { results: [{ id: 1, codeSystem: "ICD10", code: "I10", display: "Essential (primary) hypertension" }] }
        : {};
    const res = await app.request("/api/codings/search?q=hyper", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.codes[0].code).toBe("I10");
  });

  it("rejects an invalid code system", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/codings/code",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, codeSystem: "LOINC", code: "X" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  it("rejects coding a patient with an unknown code", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.startsWith("SELECT display FROM terminology_codes") ? { first: null } : {});
    const res = await app.request(
      "/api/codings/code",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, codeSystem: "ICD10", code: "ZZZ" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  it("attaches a valid code to a patient and writes audit", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT display FROM terminology_codes")) return { first: { display: "Asthma" } };
      if (sql.startsWith("INSERT INTO diagnosis_codes")) return { lastRowId: 8 };
      return {};
    };
    const res = await app.request(
      "/api/codings/code",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, codeSystem: "ICD10", code: "J45", confidence: 0.95 }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.display).toBe("Asthma");
    expect(audit).toHaveBeenCalled();
    expect(db.calls.some((c) => c.sql.startsWith("INSERT INTO diagnosis_codes"))).toBe(true);
  });

  it("lists coded diagnoses for a patient", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("FROM diagnosis_codes")
        ? { results: [{ id: 8, patientId: 1, codeSystem: "ICD10", code: "J45", display: "Asthma", confidence: 0.95 }] }
        : {};
    const res = await app.request("/api/codings?patientId=1", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diagnoses[0].code).toBe("J45");
  });
});
