import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, viewerUser } from "./helpers";
import { getAuthUser, isAdmin } from "../src/lib/security";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("audit / activity APIs", () => {
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

  it("returns global timeline for admin", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM audit_log")) {
        return { results: [{ id: 1, user_id: 2, action: "auth.login", entity: "user", entity_id: 2, detail: null, ip: "1.2.3.4", created_at: "2024-01-01" }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/audit?limit=50", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries[0].action).toBe("auth.login");
  });

  it("forbids global timeline for non-admin (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/audit", { method: "GET" }, env);
    expect(res.status).toBe(403);
  });

  it("returns own timeline for any authenticated user", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM audit_log WHERE user_id")) {
        return { results: [{ id: 5, user_id: 3, action: "record.update", entity: "record", entity_id: 9, detail: '{"k":1}', ip: null, created_at: "2024-02-02" }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/audit/me", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries[0].detail).toEqual({ k: 1 });
  });
});
