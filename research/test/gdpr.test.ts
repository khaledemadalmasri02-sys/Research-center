import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeApp, makeEnv, FakeD1, adminUser, editorUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";
import { collectObjectKeys } from "../src/routes/gdpr";
import {
  SECURITY_CATEGORIES,
  resolveSuppressionScope,
} from "../src/routes/unsubscribe";

function isAdminLike(u: any) {
  return !!u?.canAdminAccess;
}

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => isAdminLike(u),
  canEdit: (u: any) =>
    !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  requirePatientScope: (_c: any, u: any) =>
    !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin")
      ? null
      : new Response("Forbidden", { status: 403 }),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;
const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;

// The Worker's `fetch` is used for the internal api-server erasure call and for
// S3 deletes. Route by URL.
function stubFetch(impl: (url: string, init?: any) => Response | Promise<Response>) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      return impl(url, init);
    })
  );
}

describe("GDPR erasure reaches every store (W3)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: any;

  // D1 row counts keyed by table, so the DELETE-vs-SELECT verification in the
  // handler can be exercised properly.
  const COUNTS: Record<string, number> = {
    consents: 2,
    diagnosis_codes: 3,
    dicom_images: 4,
    pseudonyms: 1,
    pending_erasure: 0,
  };
  const DELETED_KEYS: string[] = [];
  let backendBehaviour: () => Response = () =>
    new Response(JSON.stringify({ deletedRows: 11 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  function responder(sql: string, binds: any[]): any {
    const count = sql.match(/COUNT\(\*\) as n FROM ([a-z_]+)/i)?.[1];
    if (count) return { first: { n: COUNTS[count] ?? 0 } };

    if (sql.includes("FROM patients WHERE id = ?")) {
      return {
        first: {
          radiology_images: JSON.stringify([
            "radiology/P1/a.dcm",
            "radiology/P1/b.dcm",
            "https://pacs.example.com/study/1", // not an object key: ignored
          ]),
          radiology_image_file_path_or_link: "radiology/P1/c.dcm",
        },
      };
    }
    if (sql === "SELECT object_key FROM dicom_images WHERE patient_id = ?") {
      return { results: [{ object_key: "radiology/P1/a.dcm" }] };
    }
    if (sql === "SELECT object_key FROM radiology_images WHERE patient_id = ?") {
      return { results: [{ object_key: "radiology/P1/b.dcm" }] };
    }
    if (sql === "SELECT document_object_key FROM consents WHERE patient_id = ?") {
      return { results: [{ document_object_key: "radiology/P1/consent.pdf" }] };
    }
    if (sql.startsWith("DELETE FROM")) {
      const t = sql.match(/DELETE FROM ([a-z_]+)/i)![1];
      const n = COUNTS[t] ?? 0;
      COUNTS[t] = 0;
      return { changes: n };
    }
    if (sql.startsWith("UPDATE audit_log")) return { changes: 5 };
    if (sql.startsWith("INSERT INTO pending_erasure")) return { lastRowId: 1 };
    if (sql.includes("FROM pending_erasure WHERE patient_id = ?")) return { first: null };
    return {};
  }

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = {
      ...makeEnv(db),
      API_BACKEND_URL: "https://backend.internal",
      INBOUND_EMAIL_SECRET: "shared-secret",
      R2_BUCKET: {
        get: async () => new Response(null, { status: 404 }),
        put: async () => {},
        delete: async (key: string) => {
          DELETED_KEYS.push(key);
        },
      },
    };
    auth.mockReset();
    audit.mockReset();
    db.calls = [];
    db.responder = responder;
    DELETED_KEYS.length = 0;
    COUNTS.consents = 2;
    COUNTS.diagnosis_codes = 3;
    COUNTS.dicom_images = 4;
    COUNTS.pseudonyms = 1;
    COUNTS.pending_erasure = 0;
    backendBehaviour = () =>
      new Response(JSON.stringify({ deletedRows: 11 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    stubFetch((url) => {
      if (url.startsWith("https://backend.internal/api/gdpr/erasure/")) return backendBehaviour();
      return new Response("{}", { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 for an unauthenticated request", async () => {
    auth.mockResolvedValue(null);
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    expect(res.status).toBe(403);
  });

  it("collects object keys BEFORE dropping the pseudonym linkage", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    const sqls = db.calls.map((c) => c.sql);
    const firstObjectRead = sqls.findIndex((s) => s.includes("FROM dicom_images WHERE patient_id"));
    const firstDelete = sqls.findIndex((s) => s.startsWith("DELETE FROM"));
    expect(firstObjectRead).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(firstObjectRead);
  });

  it("erases every store and reports counts (ok:true)", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // D1: all four tables cleared.
    expect(body.counts.d1.consents).toBe(2);
    expect(body.counts.d1.diagnosis_codes).toBe(3);
    expect(body.counts.d1.dicom_images).toBe(4);
    expect(body.counts.d1.pseudonyms).toBe(1);
    expect(body.counts.d1Total).toBe(10);
    expect(body.counts.d1Total).toBe(body.counts.d1ExpectedTotal);

    // Object storage: every collected key deleted.
    expect(body.counts.objectStorageExpected).toBe(4);
    expect(body.counts.objectStorage).toBe(4);
    expect(DELETED_KEYS.sort()).toEqual([
      "radiology/P1/a.dcm",
      "radiology/P1/b.dcm",
      "radiology/P1/c.dcm",
      "radiology/P1/consent.pdf",
    ]);
    // The external PACS URL is not an object key and must not be deleted.
    expect(DELETED_KEYS.some((k) => k.includes("pacs.example.com"))).toBe(false);

    // Postgres: reached over an authenticated internal call.
    expect(body.counts.postgres).toBe(11);
    expect((fetch as any).mock.calls.some((c: any[]) =>
      String(c[0]).startsWith("https://backend.internal/api/gdpr/erasure/1")
    )).toBe(true);

    // Audit trail retained but anonymised.
    expect(body.counts.auditRowsAnonymised).toBe(5);
    const auditUpdate = db.calls.find((c) => c.sql.startsWith("UPDATE audit_log"))!;
    expect(auditUpdate.sql).toContain("user_id = NULL");
    expect(auditUpdate.sql).toContain("detail = NULL");
    expect(auditUpdate.sql).not.toMatch(/DELETE FROM audit_log/);

    // No pending marker on a clean run.
    expect(db.calls.some((c) => c.sql.includes("INSERT INTO pending_erasure"))).toBe(false);
  });

  it("sends the internal erasure secret and never a bare request", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    const call = (fetch as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("/api/gdpr/erasure/")
    )!;
    expect(call[1].headers["x-inbound-email-secret"]).toBe("shared-secret");
    expect(call[1].method).toBe("DELETE");
  });

  it("partial failure: api-server has no erasure route -> ok:false + pending marker", async () => {
    auth.mockResolvedValue({ user: adminUser });
    backendBehaviour = () => new Response("Not Found", { status: 404 });
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Partial erasure/);
    expect(body.error).toMatch(/Do NOT report this erasure/);

    const postgres = body.stores.find((s: any) => s.store === "postgres");
    expect(postgres.ok).toBe(false);
    expect(postgres.note).toMatch(/no erasure route/);

    // The marker exists and is retryable.
    const marker = db.calls.find((c) => c.sql.includes("INSERT INTO pending_erasure"))!;
    expect(marker).toBeDefined();
    expect(marker.binds[0]).toBe(1);
    // bind order: patientId, requestedBy, stores, detail
    expect(String(marker.binds[2])).toMatch(/postgres/);

    // Audit records the partial, not a success.
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.action).toBe("gdpr.erasure.partial");
  });

  it("partial failure: a D1 delete that removes fewer rows than counted", async () => {
    auth.mockResolvedValue({ user: adminUser });
    // Simulate a trigger/concurrent-write shortfall on dicom_images.
    const inner = responder;
    db.responder = (sql: string, binds: any[]) => {
      if (sql.startsWith("DELETE FROM dicom_images")) {
        COUNTS.dicom_images = 0;
        return { changes: 1 }; // expected 4
      }
      return inner(sql, binds);
    };
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.counts.d1.dicom_images).toBe(1);
    expect(body.counts.d1ExpectedTotal).toBe(10);
    const d1 = body.stores.find((s: any) => s.store === "d1");
    expect(d1.ok).toBe(false);
    expect(d1.note).toMatch(/did not match/);
    expect(db.calls.some((c) => c.sql.includes("INSERT INTO pending_erasure"))).toBe(true);
  });

  it("partial failure: object-store delete error is reported", async () => {
    auth.mockResolvedValue({ user: adminUser });
    env.R2_BUCKET = {
      get: async () => new Response(null, { status: 404 }),
      put: async () => {},
      delete: async () => {
        throw new Error("R2 unavailable");
      },
    };
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, env);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const objects = body.stores.find((s: any) => s.store === "object_storage");
    expect(objects.ok).toBe(false);
    expect(objects.note).toMatch(/R2 unavailable/);
  });

  it("does not call the Postgres store unauthenticated when no secret is set", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const noSecret = { ...env, INBOUND_EMAIL_SECRET: "" } as any;
    const res = await app.request("/api/gdpr/erasure/1", { method: "DELETE" }, noSecret);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const postgres = body.stores.find((s: any) => s.store === "postgres");
    expect(postgres.note).toMatch(/refusing to call the Postgres store unauthenticated/);
    expect(
      (fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes("/api/gdpr/erasure/"))
    ).toBe(false);
  });

  it("lists pending erasures for an admin", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) =>
      sql.includes("FROM pending_erasure WHERE status = 'pending'")
        ? {
            results: [
              {
                patient_id: 1,
                requested_by: 1,
                status: "pending",
                attempts: 2,
                stores: JSON.stringify([{ store: "postgres" }]),
                detail: "{}",
                created_at: "x",
                updated_at: "y",
              },
            ],
          }
        : {};
    const res = await app.request("/api/gdpr/pending", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending[0].patientId).toBe(1);
    expect(body.pending[0].attempts).toBe(2);
  });
});

describe("collectObjectKeys (pure)", () => {
  it("de-duplicates and ignores non-keys", async () => {
    const db = new FakeD1();
    db.responder = (sql) => {
      if (sql.includes("FROM patients WHERE id = ?")) {
        return {
          first: {
            radiology_images: JSON.stringify([
              "radiology/P/a.dcm",
              "radiology/P/a.dcm",
              "null",
              "",
              "https://pacs/x",
            ]),
            radiology_image_file_path_or_link: "radiology/P/b.dcm",
          },
        };
      }
      if (sql === "SELECT object_key FROM dicom_images WHERE patient_id = ?") {
        return { results: [{ object_key: "radiology/P/a.dcm" }] };
      }
      return { results: [] };
    };
    const keys = await collectObjectKeys(
      { env: makeEnv(db) } as any,
      1
    );
    expect(keys.sort()).toEqual(["radiology/P/a.dcm", "radiology/P/b.dcm"]);
  });
});

describe("security categories can never be suppressed (W7 cross-check)", () => {
  it("includes login-otp, which the api-server uses for 2FA", () => {
    expect(SECURITY_CATEGORIES.has("login-otp")).toBe(true);
    expect(SECURITY_CATEGORIES.has("signup-otp")).toBe(true);
    expect(SECURITY_CATEGORIES.has("password-reset")).toBe(true);
    expect(SECURITY_CATEGORIES.has("transactional")).toBe(true);
  });

  it("'all' expands to non-security categories only", () => {
    const { scope, refusedSecurity } = resolveSuppressionScope("all");
    expect(refusedSecurity).toBe(true);
    expect(scope).not.toContain("all");
    for (const cat of scope) {
      expect(SECURITY_CATEGORIES.has(cat)).toBe(false);
    }
    expect(scope.length).toBeGreaterThan(0);
  });

  it("a direct request for a security category resolves to nothing", () => {
    expect(resolveSuppressionScope("login-otp")).toEqual({
      scope: [],
      refusedSecurity: true,
    });
  });
});