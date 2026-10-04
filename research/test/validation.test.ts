import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";
import { evaluateRules } from "../src/routes/validation";

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

describe("validation rules engine — pure evaluate", () => {
  const rules: any[] = [
    { id: 1, fieldKey: "age", ruleType: "required", params: {}, severity: "error" },
    { id: 2, fieldKey: "age", ruleType: "range", params: { min: 0, max: 120 }, severity: "error" },
    { id: 3, fieldKey: "mrn", ruleType: "regex", params: { pattern: "^MRN-\\d+$" }, severity: "error" },
    { id: 4, fieldKey: "sex", ruleType: "cross_field", params: { otherField: "gender", op: "eq" }, severity: "warning" },
  ];

  it("flags a missing required field as an error", () => {
    const v = evaluateRules(rules, {});
    expect(v.some((x) => x.field === "age" && x.ruleType === "required")).toBe(true);
  });

  it("flags out-of-range values", () => {
    const v = evaluateRules(rules, { age: 200 });
    expect(v.some((x) => x.ruleType === "range")).toBe(true);
  });

  it("passes valid data (no errors)", () => {
    const v = evaluateRules(rules, { age: 30, mrn: "MRN-123", sex: "M", gender: "M" });
    expect(v.filter((x) => x.severity === "error")).toHaveLength(0);
  });

  it("treats cross_field mismatch as a warning, not a hard error", () => {
    const v = evaluateRules(rules, { age: 30, mrn: "MRN-1", sex: "M", gender: "F" });
    const errs = v.filter((x) => x.severity === "error");
    const warns = v.filter((x) => x.severity === "warning");
    expect(errs).toHaveLength(0);
    expect(warns.some((x) => x.ruleType === "cross_field")).toBe(true);
  });
});

describe("validation rules engine — routes", () => {
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

  it("creates and lists a rule (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO validation_rules")) return { lastRowId: 2 };
      if (sql.startsWith("SELECT * FROM validation_rules"))
        return { results: [{ id: 2, definition_id: 0, field_key: "age", rule_type: "range", params: '{"min":0,"max":120}', message: null, severity: "error" }] };
      return {};
    };
    const create = await app.request(
      "/api/validation/rules",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fieldKey: "age", ruleType: "range", params: { min: 0, max: 120 } }) },
      env
    );
    expect(create.status).toBe(201);
    const list = await app.request("/api/validation/rules", { method: "GET" }, env);
    const body = await list.json();
    expect(body.rules[0].fieldKey).toBe("age");
    expect(body.rules[0].params).toEqual({ min: 0, max: 120 });
  });

  it("validates data against stored rules (DB path)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM validation_rules"))
        return { results: [{ id: 1, definition_id: 0, field_key: "age", rule_type: "required", params: "{}", message: null, severity: "error" }] };
      if (sql.startsWith("SELECT COUNT")) return { first: { c: 0 } };
      return {};
    };
    const res = await app.request(
      "/api/validation/validate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definitionId: 0, data: {} }) },
      env
    );
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors[0].field).toBe("age");
  });
});
