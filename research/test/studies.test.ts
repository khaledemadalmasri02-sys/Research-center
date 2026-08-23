import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser } from "./helpers";
import { getAuthUser, canEdit, writeAudit } from "../src/lib/security";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("studies routes", () => {
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

  it("creates a study (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO studies")) return { lastRowId: 3 };
      return {};
    };
    const res = await app.request(
      "/api/studies",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ST1", title: "Stroke", enrollmentTarget: 100 }) },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(3);
  });

  it("rejects study create for viewer (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/studies",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "X", title: "Y" }) },
      env
    );
    expect(res.status).toBe(403);
  });

  it("adds a site to a study (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO sites")) return { lastRowId: 5 };
      return {};
    };
    const res = await app.request(
      "/api/studies/1/sites",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Site A", country: "EG", enrollmentCount: 12 }) },
      env
    );
    expect(res.status).toBe(201);
  });

  it("lists studies with enrollment totals (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM studies")) {
        return { results: [{ id: 1, code: "ST1", title: "Stroke", irb_number: null, status: "active", enrollment_target: 100 }] };
      }
      if (sql.includes("FROM sites GROUP BY study_id")) {
        return { results: [{ study_id: 1, enrolled: 30, site_count: 2 }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/studies", { method: "GET" }, env);
    const body = await res.json();
    expect(body.studies[0].enrolled).toBe(30);
    expect(body.studies[0].siteCount).toBe(2);
  });

  it("returns dashboard with remaining target (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM studies WHERE id")) {
        return { first: { id: 1, code: "ST1", title: "Stroke", enrollment_target: 100 } };
      }
      if (sql.startsWith("SELECT id, name, country, enrollment_count FROM sites")) {
        return { results: [{ id: 1, name: "A", country: "EG", enrollment_count: 40 }, { id: 2, name: "B", country: "US", enrollment_count: 10 }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/studies/1/dashboard", { method: "GET" }, env);
    const body = await res.json();
    expect(body.enrolled).toBe(50);
    expect(body.remaining).toBe(50);
    expect(body.sites).toHaveLength(2);
  });

  it("404 dashboard for missing study", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM studies WHERE id")) return { first: null };
      return { results: [] };
    };
    const res = await app.request("/api/studies/99/dashboard", { method: "GET" }, env);
    expect(res.status).toBe(404);
  });

  it("creates an arm (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO study_arms")) return { lastRowId: 7 };
      return {};
    };
    const res = await app.request(
      "/api/studies/1/arms",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Control" }) },
      env
    );
    expect(res.status).toBe(201);
  });

  it("attaches a record event (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO record_events")) return { lastRowId: 9 };
      return {};
    };
    const res = await app.request(
      "/api/studies/1/record-events",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: 21, event: "baseline", armId: 7, repeatInstance: 1 }) },
      env
    );
    expect(res.status).toBe(201);
  });
});
