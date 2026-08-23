import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";
import { csvCell, csvLine } from "../src/routes/deidentify";

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

describe("deidentify pure helpers", () => {
  it("csvCell escapes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell(null)).toBe("");
  });

  it("csvLine joins configured columns in order", () => {
    const line = csvLine({ pseudonym: "PS-1", age: 30, sex: "Male" });
    expect(line.startsWith("PS-1,30,Male")).toBe(true);
    expect(line.split(",").length).toBe(10);
  });
});

describe("deidentify routes", () => {
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

  it("rejects unauthenticated export with 401", async () => {
    auth.mockResolvedValue(null);
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });

  it("generates a deterministic pseudonym (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    let call = 0;
    db.responder = (sql) => {
      if (sql.includes("FROM pseudonyms")) return { first: { pseudonym: "PS-DEADBEEF12" } };
      return {};
    };
    const body1 = await (
      await app.request(
        "/api/deidentify/pseudonym",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, studyCode: "S1" }) },
        env
      )
    ).json();
    const body2 = await (
      await app.request(
        "/api/deidentify/pseudonym",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId: 1, studyCode: "S1" }) },
        env
      )
    ).json();
    expect(body1.pseudonym).toBe("PS-DEADBEEF12");
    expect(body2.pseudonym).toBe(body1.pseudonym);
    expect(audit).toHaveBeenCalled();
  });

  it("exports a de-identified CSV that drops PHI and substitutes pseudonym", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("FROM patients"))
        return {
          results: [
            {
              id: 1,
              patient_name: "John Doe",
              age: 30,
              sex: "Male",
              notes: "secret note",
              chief_complaint: null,
            },
          ],
        };
      if (sql.includes("FROM pseudonyms")) return { first: { pseudonym: "PS-1234567890" } };
      if (sql.startsWith("INSERT")) return { lastRowId: 1 };
      return {};
    };
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("PS-1234567890");
    expect(csv).toContain("30");
    expect(csv).toContain("Male");
    expect(csv).not.toContain("John Doe");
    expect(csv).not.toContain("secret note");
    expect(csv).not.toContain("patient_name");
  });
});
