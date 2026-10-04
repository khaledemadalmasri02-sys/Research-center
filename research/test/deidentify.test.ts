import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, adminUser, viewerUser } from "./helpers";
import { getAuthUser, writeAudit } from "../src/lib/security";
import {
  csvCell,
  csvLine,
  aggregateAge,
  yearOfVisit,
  safeExportRow,
  EXPORT_COLUMNS,
} from "../src/routes/deidentify";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  requirePatientScope: (u: any) => (canEditLike(u) ? null : new Response()),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

function canEditLike(u: any) {
  return !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin");
}

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
    expect(line.split(",").length).toBe(EXPORT_COLUMNS.length);
  });

  it("EXPORT_COLUMNS is a Safe Harbor allow-list (no free text, no exact dates)", () => {
    expect([...EXPORT_COLUMNS]).toEqual([
      "pseudonym",
      "age",
      "sex",
      "collection_type",
      "year_of_visit",
    ]);
    for (const forbidden of [
      "patient_name",
      "patient_id",
      "birthDate",
      "date_of_visit",
      "chief_complaint",
      "provisional_diagnosis",
      "final_confirmed_diagnosis",
      "ai_prediction_output",
      "notes",
    ]) {
      expect(EXPORT_COLUMNS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe("Safe Harbor aggregations (W1)", () => {
  it("aggregates ages above 89 into a single 90+ bucket", () => {
    expect(aggregateAge(90)).toBe("90+");
    expect(aggregateAge(89)).toBe("89");
    expect(aggregateAge("93")).toBe("90+");
    expect(aggregateAge(150)).toBe("90+");
    expect(aggregateAge(45)).toBe("45");
    expect(aggregateAge(0)).toBe("0");
    expect(aggregateAge(null)).toBe("");
    expect(aggregateAge("")).toBe("");
    expect(aggregateAge("unknown")).toBe("");
  });

  it("reduces a date to its year only", () => {
    expect(yearOfVisit("2024-03-17")).toBe("2024");
    expect(yearOfVisit("2024-03-17T10:22:01Z")).toBe("2024");
    expect(yearOfVisit(20240719)).toBe("2024");
    expect(yearOfVisit(null)).toBe("");
    expect(yearOfVisit("")).toBe("");
    expect(yearOfVisit("not-a-date")).toBe("");
  });

  it("safeExportRow drops every non-allow-listed field", () => {
    const row = safeExportRow(
      {
        id: 7,
        patient_name: "John Doe",
        patient_id: "P123",
        age: 95,
        sex: "Male",
        collection_type: "clinic",
        date_of_visit: "2024-03-17",
        chief_complaint: "see Jane Doe, MRN 4412",
        provisional_diagnosis: "HTN in Mrs. Doe",
        final_confirmed_diagnosis: "HTN",
        ai_prediction_output: "no acute findings for Doe^John",
        notes: "secret",
      },
      "PS-ABCDEF0123"
    );
    expect(row).toEqual({
      pseudonym: "PS-ABCDEF0123",
      age: "90+",
      sex: "Male",
      collection_type: "clinic",
      year_of_visit: "2024",
    });
    const serialised = JSON.stringify(row);
    for (const forbidden of [
      "John Doe",
      "Jane Doe",
      "P123",
      "4412",
      "chief",
      "MRN",
      "2024-03-17",
      "03-17",
      "secret",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("deidentify routes", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  const PATIENTS = [
    {
      id: 1,
      patient_name: "John Doe",
      patient_id: "P1",
      age: 30,
      sex: "Male",
      collection_type: "clinic",
      date_of_visit: "2024-03-17",
      chief_complaint: "follow-up for Jane Doe MRN 4412",
      provisional_diagnosis: "HTN",
      final_confirmed_diagnosis: "HTN",
      ai_prediction_output: "no acute findings",
      notes: "secret note",
    },
  ];

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
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("rejects a viewer export with 403", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    expect(res.status).toBe(403);
  });

  it("no longer responds to GET /export (was a CSRF write primitive)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "GET" }, env);
    // The mutating GET is gone: no pseudonym rows may be written by a
    // cross-site <img src> navigation.
    expect([404, 405]).toContain(res.status);
    expect(db.calls.some((c) => c.sql.includes("INSERT OR IGNORE INTO pseudonyms"))).toBe(false);
  });

  it("500s instead of using a default salt when SESSION_SECRET is unset", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const noSecret = { ...env, SESSION_SECRET: "" } as any;
    db.responder = (sql) => {
      if (sql.includes("FROM patients")) return { results: PATIENTS };
      return {};
    };
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, noSecret);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/SESSION_SECRET/);
    // Nothing may be pseudonymised with a fallback salt.
    expect(db.calls.some((c) => c.sql.includes("INSERT OR IGNORE INTO pseudonyms"))).toBe(false);
  });

  it("500s on POST /pseudonym when SESSION_SECRET is unset", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const noSecret = { ...env, SESSION_SECRET: "" } as any;
    const res = await app.request(
      "/api/deidentify/pseudonym",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: 1, studyCode: "S1" }),
      },
      noSecret
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/SESSION_SECRET/);
  });

  it("generates a deterministic pseudonym (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
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

  it("fails loudly (409) when the D1 patients table is empty (split brain)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => (sql.includes("FROM patients") ? { results: [] } : {});
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    // A 0-row CSV would read as a successful de-identification run.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/split-brain/i);
  });

  it("exports a Safe Harbor CSV: pseudonym, aggregated age, year only, no PHI substrings", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.includes("FROM patients")) return { results: PATIENTS };
      if (sql.includes("FROM pseudonyms")) return { first: { pseudonym: "PS-1234567890" } };
      if (sql.startsWith("INSERT")) return { lastRowId: 1 };
      return {};
    };
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const csv = await res.text();

    expect(csv.split("\n")[0]).toBe("pseudonym,age,sex,collection_type,year_of_visit");
    expect(csv).toContain("PS-1234567890");
    expect(csv).toContain("2024");
    expect(csv).toContain("Male");

    // No identifier substrings anywhere in the body.
    for (const forbidden of [
      "John Doe",
      "Jane Doe",
      "patientName",
      "patientId",
      "patient_name",
      "patient_id",
      "birthDate",
      "birth_date",
      "chiefComplaint",
      "chief_complaint",
      "provisional_diagnosis",
      "final_confirmed_diagnosis",
      "ai_prediction_output",
      "MRN",
      "4412",
      "secret note",
    ]) {
      expect(csv).not.toContain(forbidden);
    }

    // No month-day anywhere: an exact date is a Safe Harbor identifier.
    expect(csv).not.toMatch(/\d{2}-\d{2}/);
    expect(csv).not.toContain("2024-03-17");
  });

  it("aggregates a 90+ patient to \"90+\" and a 30-year-old to 30 in the same run", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.includes("FROM patients")) {
        return {
          results: [
            { id: 1, age: 95, sex: "F", collection_type: "clinic", date_of_visit: "2023-01-01" },
            { id: 2, age: 30, sex: "M", collection_type: "clinic", date_of_visit: "2024-12-31" },
          ],
        };
      }
      if (sql.includes("FROM pseudonyms")) return { first: { pseudonym: "PS-0000000001" } };
      if (sql.startsWith("INSERT")) return { lastRowId: 1 };
      return {};
    };
    const res = await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    const csv = await res.text();
    expect(csv).toContain("90+");
    expect(csv).toMatch(/(^|,)30,/m);
    expect(csv).toContain("2023");
    expect(csv).toContain("2024");
  });

  it("audit detail records the exported column list", async () => {
    auth.mockResolvedValue({ user: adminUser });
    db.responder = (sql) => {
      if (sql.includes("FROM patients")) return { results: PATIENTS };
      if (sql.includes("FROM pseudonyms")) return { first: { pseudonym: "PS-1234567890" } };
      if (sql.startsWith("INSERT")) return { lastRowId: 1 };
      return {};
    };
    await app.request("/api/deidentify/export?studyCode=S1", { method: "POST" }, env);
    expect(audit).toHaveBeenCalled();
    const params = (audit.mock.calls as any[]).at(-1)[1];
    expect(params.detail.columns).toEqual([...EXPORT_COLUMNS]);
    expect(params.detail.studyCode).toBe("S1");
  });
});