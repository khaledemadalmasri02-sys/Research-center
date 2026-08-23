import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, editorUser, viewerUser } from "./helpers";
import { getAuthUser, isAdmin, writeAudit } from "../src/lib/security";
import { buildSimplePdf } from "../src/lib/pdf";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("minimal PDF builder — pure", () => {
  it("produces a valid PDF header and EOF", () => {
    const bytes = buildSimplePdf(["line one", "line two"], "Test");
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.includes("%%EOF")).toBe(true);
    expect(text.includes("/Type /Catalog")).toBe(true);
  });

  it("escapes parentheses in lines", () => {
    const bytes = buildSimplePdf(["(unsafe) text"]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("\\(unsafe\\) text");
    expect(text).not.toContain("(unsafe) text");
  });
});

describe("reports routes", () => {
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

  it("returns a PDF for a patient (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM consents WHERE patient_id")) {
        return { results: [{ consent_version_id: 1, status: "signed", signed_at: "2024-01-01", withdrawn_at: null }] };
      }
      if (sql.includes("FROM diagnosis_codes WHERE patient_id")) {
        return { results: [{ code_system: "ICD10", code: "I10", display: "HTN" }] };
      }
      if (sql.includes("FROM dicom_images WHERE patient_id")) {
        return { results: [{ modality: "CT", study_instance_uid: "1.2", is_deidentified: 0 }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/reports/patient/5/pdf", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = await res.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 8));
    expect(head).toBe("%PDF-1.4");
  });
});

describe("GDPR routes", () => {
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

  it("cascades erasure across patient-scoped tables (admin)", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.startsWith("DELETE FROM")) return { changes: 2 };
      return {};
    };
    const res = await app.request("/api/gdpr/erasure/5", { method: "DELETE" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.deletedRows).toBe(8); // 2 per table × 4 tables
  });

  it("rejects erasure for non-admin (403)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request("/api/gdpr/erasure/5", { method: "DELETE" }, env);
    expect(res.status).toBe(403);
  });

  it("lists retention candidates (admin)", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.includes("FROM consents WHERE status = 'withdrawn'")) {
        return { results: [{ patient_id: 7, cnt: 1, earliest: "2023-01-01" }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/gdpr/retention?days=365", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.candidates[0].patientId).toBe(7);
  });

  it("rejects retention for non-admin (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/gdpr/retention", { method: "GET" }, env);
    expect(res.status).toBe(403);
  });
});
