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
const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;

describe("record versioning routes", () => {
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

  it("captures a snapshot of an existing record (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE")) return { first: { id: 1, data: '{"a":1}' } };
      if (sql.includes("MAX(version_no)")) return { first: { m: null } };
      if (sql.startsWith("INSERT INTO record_versions")) return { lastRowId: 7 };
      return {};
    };
    const res = await app.request(
      "/api/record-versions/1/snapshot",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeSummary: "initial" }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.versionNo).toBe(1);
    expect(audit).toHaveBeenCalled();
    expect(db.calls.some((c) => c.sql.startsWith("INSERT INTO record_versions"))).toBe(true);
  });

  it("returns 404 when snapshotting a missing record", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.startsWith("SELECT * FROM records WHERE") ? { first: null } : {});
    const res = await app.request(
      "/api/record-versions/999/snapshot",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env
    );
    expect(res.status).toBe(404);
  });

  it("lists versions for a record", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("FROM record_versions")
        ? { results: [{ recordId: 1, versionNo: 1, userId: 2, changeSummary: "init", createdAt: "t" }] }
        : {};
    const res = await app.request("/api/record-versions/1", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0].versionNo).toBe(1);
  });

  it("returns a version snapshot with a field-level diff vs the previous version", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (_sql, binds) => {
      if (_sql.includes("AND version_no = ?")) {
        const v = binds[1];
        if (v === 2) return { first: { data_snapshot: '{"a":1,"b":2}', change_summary: null, created_at: "t", user_id: 2 } };
        if (v === 1) return { first: { data_snapshot: '{"a":1}', change_summary: null, created_at: "t", user_id: 2 } };
        return { first: null };
      }
      return {};
    };
    const res = await app.request("/api/record-versions/1/2", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toEqual({ a: 1, b: 2 });
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({ key: "b", to: 2 });
  });
});
