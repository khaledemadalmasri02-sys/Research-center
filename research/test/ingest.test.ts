import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser } from "./helpers";
import { getAuthUser, canEdit, writeAudit } from "../src/lib/security";
import { parseHl7, extractPid, hl7Unescape } from "../src/routes/ingest";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("HL7 v2 parser — pure", () => {
  const msg = [
    "MSH|^~\\&|MedResearch|Site|Receiver|App|20240101000000||ORU^R01|1|P|2.5",
    "PID|1||P123||Doe^John||19700101|M",
    "OBX|1|ST|note|^stable",
  ].join("\r");

  it("splits into typed segments", () => {
    const segs = parseHl7(msg);
    expect(segs[0].type).toBe("MSH");
    expect(segs[1].type).toBe("PID");
    expect(segs.find((s) => s.type === "OBX")?.fields[3]).toBe("note");
  });

  it("extracts PID patient fields, unescaping", () => {
    const segs = parseHl7(msg);
    const pid = segs.find((s) => s.type === "PID")!;
    const p = extractPid(pid.fields);
    expect(p.patientId).toBe("P123");
    expect(p.patientName).toBe("Doe^John");
    expect(p.dob).toBe("19700101");
    expect(p.sex).toBe("M");
  });

  it("unescapes HL7 field separators", () => {
    expect(hl7Unescape("a\\F\\b\\S\\c")).toBe("a|b^c");
  });
});

describe("HL7 ingest route", () => {
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

  const sample = [
    "MSH|^~\\&|MedResearch|Site|R|A|20240101000000||ORU^R01|1|P|2.5",
    "PID|1||P777||Smith^Jane||19850606|F",
  ].join("\r");

  it("ingests a message and creates a record (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("FROM record_definitions WHERE name = 'Patients'")) return { first: { id: 1 } };
      if (sql.startsWith("INSERT INTO records")) return { lastRowId: 42 };
      return {};
    };
    const res = await app.request(
      "/api/ingest/hl7",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: sample }) },
      env
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.recordId).toBe(42);
    expect(body.patient.patientId).toBe("P777");
    expect(body.patient.sex).toBe("F");
  });

  it("rejects ingest for viewer (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/ingest/hl7",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: sample }) },
      env
    );
    expect(res.status).toBe(403);
  });

  it("422 when no PID segment", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/ingest/hl7",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "MSH|^~\\&|X" }) },
      env
    );
    expect(res.status).toBe(422);
  });

  it("400 on empty message", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/ingest/hl7",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "   " }) },
      env
    );
    expect(res.status).toBe(400);
  });
});
