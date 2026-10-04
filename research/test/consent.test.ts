import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, editorUser, viewerUser } from "./helpers";
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

// ---------------------------------------------------------------------------
// W6 — consent listing / status owner scoping.
// `consents` has a real owner column (`signed_by_user_id`); the route must use
// it, and must never fall back to "return every consent in the table".
// ---------------------------------------------------------------------------
describe("consent roster scoping (W6)", () => {
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
    db.responder = () => ({ results: [] });
  });

  it("400s when patientId is missing (no more whole-roster consent dump)", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/consent", { method: "GET" }, env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/patientId is required/);
    expect(db.calls.some((c) => c.sql.includes("FROM consents c"))).toBe(false);
  });

  it("400s on a non-numeric patientId", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/consent?patientId=abc", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("denies a viewer (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    expect((await app.request("/api/consent?patientId=1", { method: "GET" }, env)).status).toBe(403);
    expect((await app.request("/api/consent/status?patientId=1", { method: "GET" }, env)).status).toBe(403);
    expect(db.calls.some((c) => c.sql.includes("FROM consents"))).toBe(false);
  });

  it("scopes a non-admin to consents they signed", async () => {
    auth.mockResolvedValue({ user: editorUser });
    await app.request("/api/consent?patientId=1", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("FROM consents c"))!;
    expect(q.sql.slice(q.sql.indexOf("WHERE"))).toContain("c.signed_by_user_id = ?");
    expect(q.binds).toEqual([1, editorUser.id]);
  });

  it("lets an admin list any patient's consents", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/consent?patientId=1", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("FROM consents c"))!;
    // `signed_by_user_id` appears in the SELECT projection for every caller;
    // the admin must simply not get it as a WHERE restriction.
    const where = q.sql.slice(q.sql.indexOf("WHERE")).toUpperCase();
    expect(where).not.toContain("SIGNED_BY_USER_ID");
    expect(q.binds).toEqual([1]);
  });

  it("scopes /consent/status to the signing user for non-admins", async () => {
    auth.mockResolvedValue({ user: editorUser });
    await app.request("/api/consent/status?patientId=9", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("status = 'signed'"))!;
    expect(q.sql).toContain("signed_by_user_id = ?");
    expect(q.binds).toEqual([9, editorUser.id]);
  });

  it("does not scope /consent/status for an admin", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/consent/status?patientId=9", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("status = 'signed'"))!;
    expect(q.sql).not.toContain("signed_by_user_id");
  });

  it("401 unauthenticated", async () => {
    auth.mockResolvedValue(null);
    expect((await app.request("/api/consent?patientId=1", { method: "GET" }, env)).status).toBe(401);
  });
});
