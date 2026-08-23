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

describe("record verification (double data entry)", () => {
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

  it("records a matching second entry (concordance 100, status matched)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE")) return { first: { id: 1, data: '{"a":1,"b":2}' } };
      if (sql.startsWith("INSERT INTO record_verifications")) return { lastRowId: 3 };
      return {};
    };
    const res = await app.request(
      "/api/record-verify/1",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secondData: { a: 1, b: 2 } }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("matched");
    expect(body.concordance).toBe(100);
    expect(body.conflictFields).toEqual([]);
    expect(audit).toHaveBeenCalled();
  });

  it("flags conflicts and computes partial concordance", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE")) return { first: { id: 1, data: '{"a":1,"b":2,"c":3}' } };
      if (sql.startsWith("INSERT INTO record_verifications")) return { lastRowId: 4 };
      return {};
    };
    const res = await app.request(
      "/api/record-verify/1",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secondData: { a: 1, b: 99, c: 3 } }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("conflict");
    expect(body.conflictFields).toEqual(["b"]);
    expect(body.concordance).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("returns 404 verifying a missing record", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.startsWith("SELECT * FROM records WHERE") ? { first: null } : {});
    const res = await app.request(
      "/api/record-verify/999",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secondData: {} }) },
      env
    );
    expect(res.status).toBe(404);
  });

  it("lists conflict verifications in the review queue", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) =>
      sql.includes("FROM record_verifications WHERE status = 'conflict'")
        ? { results: [{ id: 4, recordId: 1, status: "conflict", conflictFields: '["b"]', concordance: 66.67 }] }
        : {};
    const res = await app.request("/api/record-verify/queue", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0].status).toBe("conflict");
  });
});
