import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, editorUser, viewerUser } from "./helpers";
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
const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;

describe("consent routes", () => {
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

  it("rejects unauthenticated requests with 401", async () => {
    auth.mockResolvedValue(null);
    const res = await app.request("/api/consent/versions", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });

  it("lists active consent versions", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("FROM consent_versions")
        ? { results: [{ id: 1, code: "V1", label: "Std", irb_number: null, effective_at: "t" }] }
        : {};
    const res = await app.request("/api/consent/versions", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0].code).toBe("V1");
  });

  it("signs a consent (editor) and writes audit", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("consent_versions WHERE id")) return { first: { id: 1 } };
      if (sql.startsWith("INSERT INTO consents")) return { lastRowId: 5 };
      return {};
    };
    const res = await app.request(
      "/api/consent/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, consentVersionId: 1 }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(5);
    expect(audit).toHaveBeenCalled();
    expect(db.calls.some((c) => c.sql.startsWith("INSERT INTO consents"))).toBe(true);
  });

  it("rejects signing with an invalid patientId", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/consent/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: -1, consentVersionId: 1 }) },
      env
    );
    expect(res.status).toBe(400);
  });

  it("rejects signing against an unknown consent version", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.includes("consent_versions WHERE id") ? { first: null } : {});
    const res = await app.request(
      "/api/consent/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, consentVersionId: 99 }) },
      env
    );
    expect(res.status).toBe(400);
  });

  it("blocks protocol creation for non-admins (403) but allows admin (201)", async () => {
    // editor -> 403
    auth.mockResolvedValue({ user: editorUser });
    let res = await app.request(
      "/api/consent/protocols",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "S1", title: "Study" }) },
      env
    );
    expect(res.status).toBe(403);

    // admin -> 201
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => (sql.startsWith("INSERT INTO study_protocols") ? { lastRowId: 9 } : {});
    res = await app.request(
      "/api/consent/protocols",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "S1", title: "Study" }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(9);
  });

  it("withdraws a signed consent", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("SELECT * FROM consents WHERE id")) return { first: { id: 1 } };
      return {};
    };
    const res = await app.request(
      "/api/consent/1/withdraw",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "req" }) },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("withdrawn");
    expect(db.calls.some((c) => c.sql.startsWith("UPDATE consents"))).toBe(true);
  });
});
