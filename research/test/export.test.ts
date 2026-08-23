import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, viewerUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";
import { buildFhirBundle, buildHl7V2, fhirGender, hl7Escape } from "../src/routes/export";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
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
  });

  it("returns a FHIR bundle for a record (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE id")) {
        return { first: { id: 10, data: JSON.stringify({ patientId: "P1", sex: "Female", note: "x" }) } };
      }
      if (sql.includes("FROM diagnosis_codes WHERE record_id")) return { results: [] };
      return {};
    };
    const res = await app.request("/api/export/fhir?recordId=10", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.resourceType).toBe("Bundle");
  });

  it("returns HL7 text for a record (auth)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE id")) {
        return { first: { id: 10, data: JSON.stringify({ patientId: "P1" }) } };
      }
      if (sql.includes("FROM diagnosis_codes WHERE record_id")) return { results: [] };
      return {};
    };
    const res = await app.request("/api/export/hl7?recordId=10", { method: "GET" }, env);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text.startsWith("MSH|^~\\&")).toBe(true);
    expect(res.headers.get("content-type")).toContain("hl7-v2");
  });

  it("404 when record missing", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM records WHERE id")) return { first: null };
      return {};
    };
    const res = await app.request("/api/export/fhir?recordId=999", { method: "GET" }, env);
    expect(res.status).toBe(404);
  });

  it("400 when recordId missing", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/export/fhir", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });
});
