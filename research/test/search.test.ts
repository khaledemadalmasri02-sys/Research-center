import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser } from "./helpers";
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

describe("search + saved views", () => {
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

  it("searches records (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE")) {
        return { results: [{ id: 1, definition_id: 2, data: JSON.stringify({ note: "stable" }), created_at: "2024-01-01" }] };
      }
      return { results: [] };
    };
    const res = await app.request(
      "/api/search",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "stable" }) },
      env
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.results[0].data.note).toBe("stable");
  });

  it("ignores unsafe filter keys (no injection into json_extract path)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    let capturedSql = "";
    db.responder = (sql) => {
      capturedSql = sql;
      if (sql.startsWith("SELECT * FROM records WHERE")) {
        return { results: [{ id: 1, definition_id: 2, data: "{}", created_at: "x" }] };
      }
      return { results: [] };
    };
    await app.request(
      "/api/search",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: { "x); DROP TABLE records; --": "y" } }) },
      env
    );
    // The malicious key must NOT appear in the generated SQL.
    expect(capturedSql).not.toContain("DROP TABLE");
    expect(capturedSql).not.toContain("x);");
  });

  it("creates and lists a saved view (auth)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO saved_views")) return { lastRowId: 3 };
      if (sql.startsWith("SELECT * FROM saved_views WHERE user_id")) {
        return { results: [{ id: 3, name: "My view", definition_id: 2, filters: "{}", sort: "{}" }] };
      }
      return {};
    };
    const create = await app.request(
      "/api/saved-views",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "My view", definitionId: 2, filters: { sex: "M" } }) },
      env
    );
    expect(create.status).toBe(201);
    const list = await app.request("/api/saved-views", { method: "GET" }, env);
    const body = await list.json();
    expect(body.views[0].name).toBe("My view");
  });

  it("deletes a saved view (auth)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = () => ({});
    const res = await app.request("/api/saved-views/3", { method: "DELETE" }, env);
    expect(res.status).toBe(200);
  });
});
