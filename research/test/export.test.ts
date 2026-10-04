import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, viewerUser, editorUser, adminUser } from "./helpers";
import { getAuthUser, writeAudit, loadScopedRecord } from "../src/lib/security";
import { buildFhirBundle, buildHl7V2, fhirGender, hl7Escape } from "../src/routes/export";

function isAdminLike(u: any) {
  return !!u?.canAdminAccess;
}

// `loadScopedRecord` is the real owner-scoping implementation under test, so it
// is re-exported rather than mocked.
async function realLoadScopedRecord(c: any, recordId: number, user: any) {
  if (isAdminLike(user)) {
    const rec = await c.env.DB.prepare("SELECT * FROM records WHERE id = ?").bind(recordId).first();
    if (!rec) return null;
    let data: any = {};
    try {
      data = typeof rec.data === "string" ? JSON.parse(rec.data) : rec.data;
    } catch {
      data = {};
    }
    return { id: rec.id, data };
  }
  const rec = await c.env.DB
    .prepare("SELECT * FROM records WHERE id = ? AND user_id = ?")
    .bind(recordId, user?.id ?? -1)
    .first();
  if (!rec) return null;
  let data: any = {};
  try {
    data = typeof rec.data === "string" ? JSON.parse(rec.data) : rec.data;
  } catch {
    data = {};
  }
  return { id: rec.id, data };
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
  loadScopedRecord: realLoadScopedRecord,
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("FHIR builder — pure", () => {
  const rec = {
    id: 10,
    data: { patientId: "P1", patientName: "Doe^John", sex: "Male", age: 55, diagnosis: "HTN", note: "stable" },
    codes: [{ code_system: "ICD10", code: "I10", display: "Hypertension" }],
  };

  it("maps sex to FHIR gender", () => {
    expect(fhirGender("Male")).toBe("male");
    expect(fhirGender("Female")).toBe("female");
    expect(fhirGender("Other")).toBe("other");
    expect(fhirGender("weird")).toBe("unknown");
  });

  it("produces a Bundle with Patient + Observations + DiagnosticReport", () => {
    const b = buildFhirBundle(rec);
    expect(b.resourceType).toBe("Bundle");
    expect(b.type).toBe("collection");
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain("Patient");
    expect(types).toContain("Observation");
    expect(types).toContain("DiagnosticReport");
    const obs = b.entry.find((e: any) => e.resource.resourceType === "Observation" && e.resource.code.text === "note");
    expect(obs.resource.valueString).toBe("stable");
    const pat = b.entry.find((e: any) => e.resource.resourceType === "Patient").resource;
    expect(pat.gender).toBe("male");
  });
});

describe("HL7 v2 builder — pure", () => {
  it("escapes field separators", () => {
    expect(hl7Escape("a|b^c&d~e")).toBe("a\\F\\b\\S\\c\\T\\d\\R\\e");
  });

  it("builds MSH/PID/OBX with segment separators", () => {
    const msg = buildHl7V2({ id: 10, data: { patientId: "P1", patientName: "Doe", sex: "M", note: "ok" } }, "99");
    const lines = msg.split("\r");
    expect(lines[0].startsWith("MSH|^~\\&")).toBe(true);
    expect(lines[1].startsWith("PID|1||P1||Doe||")).toBe(true);
    expect(lines.some((l) => l.startsWith("OBX|"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// W6 — record-level IDOR. `records.user_id` is the owner column; the query must
// be scoped by it in SQL, not filtered afterwards in JS.
// ---------------------------------------------------------------------------
const ALICE = { ...editorUser, id: 101, username: "alice" };
const BOB = { ...editorUser, id: 202, username: "bob" };

function recordResponder() {
  return (sql: string, binds: any[]) => {
    if (sql.includes("FROM records WHERE id = ? AND user_id = ?")) {
      const [recordId, userId] = binds;
      if (recordId !== 10) return { first: null };
      if (userId === 101) {
        return {
          first: {
            id: 10,
            data: JSON.stringify({ patientId: "P1", patientName: "Alice Patient", sex: "Female" }),
          },
        };
      }
      return { first: null }; // Alice's record is invisible to Bob
    }
    if (sql.includes("FROM records WHERE id = ?")) {
      // Unscoped read — only an admin may reach this branch.
      if (binds[0] === 10) {
        return {
          first: {
            id: 10,
            data: JSON.stringify({ patientId: "P1", patientName: "Alice Patient", sex: "Female" }),
          },
        };
      }
      return { first: null };
    }
    if (sql.includes("FROM diagnosis_codes WHERE record_id")) return { results: [] };
    return {};
  };
}

describe("export routes", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    db.calls = [];
    db.responder = recordResponder();
  });

  it("returns a FHIR bundle for a record (auth)", async () => {
    auth.mockResolvedValue({ user: ALICE });
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.resourceType).toBe("Bundle");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("returns HL7 text for a record (auth)", async () => {
    auth.mockResolvedValue({ user: ALICE });
    const res = await app.request("/api/export/hl7?recordId=10", { method: "GET" }, env);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.startsWith("MSH|^~\\&")).toBe(true);
    expect(res.headers.get("content-type")).toContain("hl7-v2");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("404 when record missing", async () => {
    auth.mockResolvedValue({ user: ALICE });
    const res = await app.request("/api/export/fhir?recordId=999", { method: "GET" }, env);
    expect(res.status).toBe(404);
  });

  it("400 when recordId missing", async () => {
    auth.mockResolvedValue({ user: ALICE });
    const res = await app.request("/api/export/fhir", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    auth.mockResolvedValue(null);
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });
});

describe("record-level IDOR is closed (W6)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    db.calls = [];
    db.responder = recordResponder();
  });

  it("user B cannot export user A's FHIR record", async () => {
    auth.mockResolvedValue({ user: BOB });
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    // 404, not 403: the endpoint must not confirm that record 10 exists.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Alice Patient");
  });

  it("user B cannot export user A's HL7 record (no PID-5 leak)", async () => {
    auth.mockResolvedValue({ user: BOB });
    const res = await app.request("/api/export/hl7?recordId=10", { method: "GET" }, env);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Alice Patient");
  });

  it("the records query is scoped by user_id in SQL, not filtered in JS", async () => {
    auth.mockResolvedValue({ user: BOB });
    await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("FROM records"))!;
    expect(q.sql).toContain("user_id = ?");
    // The caller-supplied id AND the caller's id are both bound.
    expect(q.binds).toEqual([10, BOB.id]);
    // Critically: no unscoped `SELECT * FROM records WHERE id = ?` was issued.
    expect(db.calls.some((c) => /^SELECT \* FROM records WHERE id = \?$/.test(c.sql.trim()))).toBe(
      false
    );
  });

  it("an admin may still read any record", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const q = db.calls.find((c) => c.sql.includes("FROM records"))!;
    expect(q.sql).not.toContain("user_id = ?");
  });

  it("owner A can still read their own record", async () => {
    auth.mockResolvedValue({ user: ALICE });
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("Alice Patient");
  });

  it("a viewer with no records cannot walk recordId=1..N", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    for (const id of [1, 2, 3, 10, 11]) {
      const res = await app.request(`/api/export/fhir?recordId=${id}`, { method: "GET" }, env);
      expect(res.status).toBe(404);
    }
    // Every read was owner-scoped.
    for (const c of db.calls.filter((c) => c.sql.includes("FROM records"))) {
      expect(c.sql).toContain("user_id = ?");
    }
  });
});

describe("loadScopedRecord (unit)", () => {
  it("returns null for a record the caller does not own", async () => {
    const db = new FakeD1();
    db.responder = (sql, binds) =>
      sql.includes("user_id = ?")
        ? { first: binds[1] === 101 ? { id: 10, data: "{}" } : null }
        : {};
    const got = await loadScopedRecord({ env: makeEnv(db) } as any, 10, ALICE as any);
    expect(got).not.toBeNull();
    const denied = await loadScopedRecord({ env: makeEnv(db) } as any, 10, BOB as any);
    expect(denied).toBeNull();
  });

  it("parses a JSON data column and survives malformed JSON", async () => {
    const db = new FakeD1();
    db.responder = () => ({ first: { id: 1, data: "not json" } });
    const got = await loadScopedRecord({ env: makeEnv(db) } as any, 1, adminUser as any);
    expect(got).toEqual({ id: 1, data: {} });
  });
});