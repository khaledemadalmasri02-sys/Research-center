import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, editorUser, viewerUser } from "./helpers";
import { getAuthUser, isAdmin, writeAudit } from "../src/lib/security";
import { buildSimplePdf } from "../src/lib/pdf";

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

  it("returns a PDF for a patient (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
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
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("denies the patient PDF to a viewer (no owner column to scope against)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/reports/patient/5/pdf", { method: "GET" }, env);
    expect(res.status).toBe(403);
  });

  it("400s on a non-numeric patient id", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/reports/patient/abc/pdf", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("only marks a FULLY de-identified image as [deid]", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("FROM dicom_images WHERE patient_id")) {
        return {
          results: [
            { modality: "CT", study_instance_uid: "s1", is_deidentified: 0 },
            { modality: "MR", study_instance_uid: "s2", is_deidentified: 1 },
            { modality: "US", study_instance_uid: "s3", is_deidentified: 2 },
          ],
        };
      }
      return { results: [] };
    };
    const res = await app.request("/api/reports/patient/5/pdf", { method: "GET" }, env);
    const text = new TextDecoder().decode(await res.arrayBuffer());
    // A metadata-only scrub (state 1) must NOT print "[deid]".
    expect(text).toContain("PIXELS NOT SCRUBBED");
    expect(text).toMatch(/US s3 \[deid\]/);
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

  // NOTE: the cross-store erasure behaviour (D1 + object storage + Postgres,
  // per-store counts, partial-failure pending marker) is covered in
  // test/gdpr.test.ts. The old assertion here
  // (`ok:true, deletedRows: 8` from four D1 tables) encoded exactly the
  // false-completion this fix removed: it passed while the real PHI store
  // (Postgres) and every radiology object in S3/MinIO were untouched.

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
