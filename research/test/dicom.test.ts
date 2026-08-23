import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser, adminUser } from "./helpers";
import { getAuthUser, canEdit, isAdmin, writeAudit } from "../src/lib/security";
import { stripPhiTags, PHI_TAGS } from "../src/routes/dicom";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

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

  it("PHI_TAGS covers the core identifiers", () => {
    expect(PHI_TAGS.has("PatientName")).toBe(true);
    expect(PHI_TAGS.has("InstitutionName")).toBe(true);
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

  it("de-identifies an image's metadata (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT * FROM dicom_images WHERE id")) {
        return { first: { id: 5, dicom_metadata: JSON.stringify({ PatientName: "X", Modality: "CT" }) } };
      }
      if (sql.startsWith("UPDATE dicom_images")) return {};
      return {};
    };
    const res = await app.request(
      "/api/dicom/deidentify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 5 }),
      },
      env
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metadata.PatientName).toBe("");
    expect(body.metadata.Modality).toBe("CT");
  });

  it("groups images into studies (auth, viewer ok)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
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
