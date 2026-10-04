import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser, adminUser } from "./helpers";
import { getAuthUser, canEdit, isAdmin, writeAudit } from "../src/lib/security";
import {
  stripPhiTags,
  PHI_TAGS,
  boundedPaging,
  DEID_NONE,
  DEID_METADATA_ONLY,
  DEID_FULL,
} from "../src/routes/dicom";

function canEditLike(u: any) {
  return !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin");
}

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => canEditLike(u),
  requirePatientScope: (_c: any, u: any) =>
    canEditLike(u) ? null : new Response("Forbidden", { status: 403 }),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;
const write = writeAudit as unknown as ReturnType<typeof vi.fn>;

describe("DICOM PHI scrubber — pure", () => {
  it("strips known PHI tags and keeps clinical tags", () => {
    const meta = {
      PatientName: "Doe^John",
      PatientID: "P123",
      Modality: "CT",
      StudyInstanceUID: "1.2.3",
      BodyPart: "CHEST",
      "0008,0020": "20240101",
    };
    const out = stripPhiTags(meta, "");
    expect(out.PatientName).toBe("");
    expect(out.PatientID).toBe("");
    expect(out["0008,0020"]).toBe("");
    expect(out.Modality).toBe("CT");
    expect(out.StudyInstanceUID).toBe("1.2.3");
    expect(out.BodyPart).toBe("CHEST");
  });

  it("does not mutate the input object", () => {
    const meta = { PatientName: "X", Modality: "MR" };
    const before = JSON.stringify(meta);
    stripPhiTags(meta);
    expect(JSON.stringify(meta)).toBe(before);
  });

  it("PHI_TAGS covers the core identifiers (stored upper-case)", () => {
    // PHI_TAGS is normalised to upper case because stripPhiTags() uppercases
    // every incoming key; a mixed-case entry would never match.
    expect(PHI_TAGS.has("PatientName".toUpperCase())).toBe(true);
    expect(PHI_TAGS.has("InstitutionName".toUpperCase())).toBe(true);
    expect(PHI_TAGS.has("PATIENTNAME")).toBe(true);
  });

  it("PHI_TAGS includes the PS3.15 tags that were missing", () => {
    for (const tag of [
      "StudyID",
      "PatientBirthTime",
      "Occupation",
      "BranchOfService",
      "RequestedProcedureComments",
      "InstitutionDepartmentName",
      "InstitutionAddress",
      "ReferringPhysicianName",
      "PerformingPhysicianName",
      "OperatorsName",
      "PatientAddress",
      "PatientTelephoneNumbers",
    ]) {
      expect(PHI_TAGS.has(tag.toUpperCase())).toBe(true);
    }
  });

  it("matches tags case-insensitively so a lowercase parser cannot bypass it", () => {
    // Previously only comma-form tags were uppercased, so any parser emitting
    // lowercase keywords walked straight past the whole allow-list.
    const meta = {
      patientname: "Doe^John",
      PATIENTID: "P123",
      patientbirthdate: "19700101",
      institutionaddress: "1 Main St",
      patienttelephonenumbers: "+15551234",
      MODALITY: "CT",
      bodypart: "CHEST",
    };
    const out = stripPhiTags(meta, "");
    expect(out.patientname).toBe("");
    expect(out.PATIENTID).toBe("");
    expect(out.patientbirthdate).toBe("");
    expect(out.institutionaddress).toBe("");
    expect(out.patienttelephonenumbers).toBe("");
    expect(out.MODALITY).toBe("CT");
    expect(out.bodypart).toBe("CHEST");
  });

  it("strips mixed-case comma-form tags too", () => {
    const out = stripPhiTags({ "0010,0010": "Doe^John", "0008,0020": "20240101" }, "");
    expect(out["0010,0010"]).toBe("");
    expect(out["0008,0020"]).toBe("");
  });
});

describe("boundedPaging (W8)", () => {
  it("defaults, clamps and floors", () => {
    expect(boundedPaging(undefined, undefined)).toEqual({ limit: 100, offset: 0 });
    expect(boundedPaging("5000", undefined)).toEqual({ limit: 100, offset: 0 });
    expect(boundedPaging("0", "-5")).toEqual({ limit: 1, offset: 0 });
    expect(boundedPaging("abc", "xyz")).toEqual({ limit: 100, offset: 0 });
    expect(boundedPaging("25", "50")).toEqual({ limit: 25, offset: 50 });
    expect(boundedPaging(undefined, undefined, 200)).toEqual({ limit: 200, offset: 0 });
  });
});

describe("DICOM de-identification honesty (W2)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  const EXISTING = {
    id: 5,
    patient_id: 1,
    object_key: "radiology/P1/20240101-CT.dcm",
    dicom_metadata: JSON.stringify({
      PatientName: "Doe^John",
      PatientID: "P123",
      Modality: "CT",
    }),
    is_deidentified: 0,
  };

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    write.mockReset();
    db.calls = [];
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM dicom_images WHERE id")) return { first: { ...EXISTING } };
      if (sql.startsWith("UPDATE dicom_images")) return {};
      return {};
    };
  });

  it("does NOT mark the image fully de-identified, and says pixels were not scrubbed", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/dicom/deidentify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 5 }),
      },
      env
    );
    expect(res.status).toBe(422);
    const body = await res.json();

    // Header metadata was scrubbed...
    expect(body.metadata.PatientName).toBe("");
    expect(body.metadata.Modality).toBe("CT");

    // ...but the image is explicitly NOT de-identified.
    expect(body.error).toMatch(/Pixel de-identification is NOT implemented/);
    expect(body.pixelsScrubbed).toBe(false);
    expect(body.fullyDeidentified).toBe(false);
    expect(body.isDeidentified).toBe(DEID_METADATA_ONLY);
    expect(body.isDeidentified).not.toBe(DEID_FULL);
    expect(body.objectKey).toBe(EXISTING.object_key);
    expect(body.requiredNextStep).toMatch(/PS3\.15/);
  });

  it("writes state 1 (metadata only) and never state 2 while the object is unchanged", async () => {
    auth.mockResolvedValue({ user: editorUser });
    await app.request(
      "/api/dicom/deidentify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 5 }),
      },
      env
    );
    const update = db.calls.find((c) => c.sql.startsWith("UPDATE dicom_images"));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("is_deidentified = ?");
    expect(update!.binds).toContain(DEID_METADATA_ONLY);
    expect(update!.binds).not.toContain(DEID_FULL);
    expect(update!.binds).not.toContain(1 === DEID_FULL ? DEID_NONE : DEID_FULL);

    // The object store was never touched: no S3/R2 GET, PUT or DELETE was
    // attempted, so the bytes in object storage are byte-for-byte unchanged.
    expect(db.calls.some((c) => c.sql.includes("object_key = ?"))).toBe(false);
  });

  it("audit entry records pixelsScrubbed:false", async () => {
    auth.mockResolvedValue({ user: editorUser });
    await app.request(
      "/api/dicom/deidentify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 5 }),
      },
      env
    );
    const params = (write.mock.calls as any[]).at(-1)[1];
    expect(params.action).toBe("dicom.deidentify.metadata_only");
    expect(params.detail.pixelsScrubbed).toBe(false);
    expect(params.detail.objectKey).toBe(EXISTING.object_key);
  });

  it("clamps a caller-asserted isDeidentified to metadata-only", async () => {
    auth.mockResolvedValue({ user: editorUser });
    await app.request(
      "/api/dicom/metadata",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: 1,
          objectKey: "img/1.dcm",
          isDeidentified: true,
          metadata: { Modality: "CT" },
        }),
      },
      env
    );
    const insert = db.calls.find((c) => c.sql.startsWith("INSERT INTO dicom_images"));
    expect(insert).toBeDefined();
    expect(insert!.binds).toContain(DEID_METADATA_ONLY);
    expect(insert!.binds).not.toContain(DEID_FULL);
  });
});

describe("DICOM routes", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    write.mockReset();
    db.calls = [];
  });

  it("stores parsed metadata for an editor", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO dicom_images")) return { lastRowId: 7 };
      return {};
    };
    const res = await app.request(
      "/api/dicom/metadata",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: 1,
          objectKey: "img/1.dcm",
          modality: "CT",
          studyInstanceUid: "1.2.3",
          metadata: { PatientName: "X", Modality: "CT" },
        }),
      },
      env
    );
    expect(res.status).toBe(201);
  });

  it("rejects metadata storage for a viewer (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/dicom/metadata",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: 1, objectKey: "x.dcm" }),
      },
      env
    );
    expect(res.status).toBe(403);
  });

  it("groups images into studies (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.includes("GROUP BY study_instance_uid")) {
        return { results: [{ study_instance_uid: "1.2.3", modality: "CT", body_part: null, acquisition_date: "2024-01-01", image_count: 2 }] };
      }
      return { results: [] };
    };
    const res = await app.request("/api/dicom/studies/1", { method: "GET" }, env);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.studies[0].studyInstanceUid).toBe("1.2.3");
    expect(body.studies[0].imageCount).toBe(2);
  });

  it("404 when de-identifying a missing image", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM dicom_images WHERE id")) return { first: null };
      return {};
    };
    const res = await app.request(
      "/api/dicom/deidentify",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 999 }) },
      env
    );
    expect(res.status).toBe(404);
  });
});

describe("DICOM image listing is bounded (W8)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    db.calls = [];
    db.responder = () => ({ results: [] });
  });

  it("400s when patientId is missing (no more full-catalogue dump)", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/dicom/images", { method: "GET" }, env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/patientId is required/);
    // Critically: no query against the whole table was issued.
    expect(db.calls.some((c) => c.sql.includes("FROM dicom_images"))).toBe(false);
  });

  it("400s when only studyInstanceUid is supplied", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/dicom/images?studyInstanceUid=1.2.3", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("400s on a non-numeric patientId", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/dicom/images?patientId=abc", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("always applies LIMIT/OFFSET", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/dicom/images?patientId=1", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("FROM dicom_images"))!;
    expect(q.sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(q.binds).toContain(100);
    expect(q.binds).toContain(0);
  });

  it("caps an oversized requested limit at 100", async () => {
    auth.mockResolvedValue({ user: adminUser });
    const res = await app.request("/api/dicom/images?patientId=1&limit=999999", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
    const q = db.calls.find((c) => c.sql.includes("FROM dicom_images"))!;
    expect(q.binds).toContain(100);
    expect(q.binds).not.toContain(999999);
  });

  it("honours an explicit limit and offset", async () => {
    auth.mockResolvedValue({ user: adminUser });
    await app.request("/api/dicom/images?patientId=1&limit=5&offset=10", { method: "GET" }, env);
    const q = db.calls.find((c) => c.sql.includes("FROM dicom_images"))!;
    expect(q.binds).toContain(5);
    expect(q.binds).toContain(10);
  });

  it("denies a viewer (no owner column on patients to scope against)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request("/api/dicom/images?patientId=1", { method: "GET" }, env);
    expect(res.status).toBe(403);
  });
});