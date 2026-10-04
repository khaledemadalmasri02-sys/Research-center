// GDPR erasure route + unsubscribe-link token (coordinator-requested).
//
// The unsubscribe link must carry an HMAC the Worker can verify
// (`research/src/routes/unsubscribe.ts::mintUnsubscribeToken`), otherwise
// every List-Unsubscribe link in every email is a dead link and CAN-SPAM
// opt-out is broken.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";
import { pool } from "@workspace/db";
import { buildUnsubscribeUrl, mintUnsubscribeToken } from "../src/lib/email";

const SECRET = "erasure-secret-for-tests";
const PATIENT_TABLE = process.env.PATIENT_TABLE ?? "patients";

/** Reference implementation copied from the Worker's mint function. */
function workerMint(secret: string, email: string, category: string): string {
  return createHmac("sha256", secret)
    .update(`${email.toLowerCase()}|${category}`)
    .digest("hex")
    .slice(0, 32);
}

async function seedPatientWithImages(
  userId: number,
  patientId: string,
  images: string[],
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO "${PATIENT_TABLE}"
       ("patient_id", "patient_name", "user_id", "radiology_images", "radiology_image_file_path_or_link", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING id`,
    [patientId, `Patient ${patientId}`, userId, JSON.stringify(images), images[0] ?? null],
  );
  return rows[0]!.id;
}

describe("DELETE /api/gdpr/erasure/:patientId", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    process.env.ERASURE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.ERASURE_SECRET;
  });

  it("401s without the erasure secret", async () => {
    await t.createUser({ username: "gdpr-user", password: "StrongPass1!" });
    const res = await request(t.app).delete("/api/gdpr/erasure/42");
    expect(res.status).toBe(401);
  });

  it("401s with a wrong secret of the same length", async () => {
    const res = await request(t.app)
      .delete("/api/gdpr/erasure/42")
      .set("x-erasure-secret", "x".repeat(SECRET.length));
    expect(res.status).toBe(401);
  });

  it("503s and refuses when no secret is configured at all (fail closed)", async () => {
    delete process.env.ERASURE_SECRET;
    const res = await request(t.app)
      .delete("/api/gdpr/erasure/42")
      .set("x-erasure-secret", SECRET);
    expect(res.status).toBe(503);
  });

  it("accepts the fallback header the Worker also sends", async () => {
    const res = await request(t.app)
      .delete("/api/gdpr/erasure/999")
      .set("x-inbound-email-secret", SECRET);
    expect(res.status).toBe(200);
  });

  it("answers 200 with 0 deleted for an unknown patient (the Worker reads 404 as 'no route')", async () => {
    const res = await request(t.app)
      .delete("/api/gdpr/erasure/does-not-exist-xyz")
      .set("x-erasure-secret", SECRET);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deletedRows).toBe(0);
    expect(res.body.objectKeys).toEqual([]);
  });

  it("400s a malformed patient id", async () => {
    const res = await request(t.app)
      .delete("/api/gdpr/erasure/bad%20id%3B%20drop")
      .set("x-erasure-secret", SECRET);
    expect(res.status).toBe(400);
  });

  it("cascades the delete, returns object keys, and anonymises audit rows", async () => {
    const userId = await t.createUser({ username: "gdpr-owner", password: "StrongPass1!" });
    const images = ["radiology/patient_42_a.png", "radiology/patient_42_b.png"];
    const patientRowId = await seedPatientWithImages(userId, "42", images);

    await pool.query(
      `INSERT INTO radiology_images (patient_id, object_key, upload_timestamp) VALUES ($1, $2, now())`,
      [patientRowId, "radiology/patient_42_c.png"],
    );

    const { rows: defRows } = await pool.query<{ id: number }>(
      `INSERT INTO record_definitions (user_id, name, fields, created_at, updated_at)
       VALUES ($1, 'Anon', '[]'::jsonb, now(), now()) RETURNING id`,
      [userId],
    );
    const { rows: recRows } = await pool.query<{ id: number }>(
      `INSERT INTO records (user_id, definition_id, data, created_at, updated_at)
       VALUES ($1, $2, '{}'::jsonb, now(), now()) RETURNING id`,
      [userId, defRows[0]!.id],
    );
    await pool.query(
      `INSERT INTO record_images (record_id, field_key, object_key, created_at) VALUES ($1, 'xray', $2, now())`,
      [recRows[0]!.id, "radiology/record_42_r.png"],
    );
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail, ip, created_at)
       VALUES ($1, 'patient.view', 'patient', $2, $3::jsonb, '10.0.0.1', now())`,
      [userId, patientRowId, JSON.stringify({ patientId: "42", note: "keep me" })],
    );

    const res = await request(t.app)
      .delete("/api/gdpr/erasure/42")
      .set("x-erasure-secret", SECRET);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.patientFound).toBe(true);
    expect(res.body.deletedRows).toBeGreaterThanOrEqual(4);
    expect(res.body.postgres.expected).toBe(res.body.postgres.deleted);

    // Object keys collected from patients, radiology_images and record_images
    // — the Worker deletes them from S3 itself.
    expect(res.body.objectKeys).toEqual(
      expect.arrayContaining([
        "radiology/patient_42_a.png",
        "radiology/patient_42_b.png",
        "radiology/patient_42_c.png",
        "radiology/record_42_r.png",
      ]),
    );

    // The PHI rows are gone.
    const { rows: patients } = await pool.query(
      `SELECT 1 FROM "${PATIENT_TABLE}" WHERE patient_id = $1`,
      ["42"],
    );
    expect(patients).toHaveLength(0);
    const { rows: records } = await pool.query(`SELECT 1 FROM records WHERE id = $1`, [
      recRows[0]!.id,
    ]);
    expect(records).toHaveLength(0);
    const { rows: recImages } = await pool.query(
      `SELECT 1 FROM record_images WHERE record_id = $1`,
      [recRows[0]!.id],
    );
    expect(recImages).toHaveLength(0);
    const { rows: radImages } = await pool.query(
      `SELECT 1 FROM radiology_images WHERE patient_id = $1`,
      [patientRowId],
    );
    expect(radImages).toHaveLength(0);

    // The audit row survives, anonymised.
    expect(res.body.auditRowsAnonymised).toBeGreaterThanOrEqual(1);
    const { rows: audit } = await pool.query<{
      action: string;
      detail: unknown;
      entity_id: number | null;
    }>(`SELECT action, detail, entity_id FROM audit_log WHERE action = 'patient.view'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ note: "keep me" });
    expect((audit[0]!.detail as Record<string, unknown>).patientId).toBeUndefined();
    expect(audit[0]!.entity_id).toBeNull();

    // The erasure itself is auditable and carries no PHI.
    const { rows: erasureAudit } = await pool.query<{
      action: string;
      detail: { deletedRows: number };
    }>(`SELECT action, detail FROM audit_log WHERE action = 'gdpr.erasure'`);
    expect(erasureAudit.length).toBeGreaterThanOrEqual(1);
    expect(erasureAudit[0]!.detail.deletedRows).toBeGreaterThan(0);
  });

  it("does not touch another patient's data", async () => {
    const userA = await t.createUser({ username: "erased-user", password: "StrongPass1!" });
    const userB = await t.createUser({ username: "kept-user", password: "StrongPass1!" });
    await seedPatientWithImages(userA, "111", ["radiology/patient_111.png"]);
    await seedPatientWithImages(userB, "222", ["radiology/patient_222.png"]);

    const res = await request(t.app)
      .delete("/api/gdpr/erasure/111")
      .set("x-erasure-secret", SECRET);
    expect(res.status).toBe(200);
    expect(res.body.objectKeys).toEqual(["radiology/patient_111.png"]);

    const { rows: kept } = await pool.query(
      `SELECT 1 FROM "${PATIENT_TABLE}" WHERE patient_id = $1`,
      ["222"],
    );
    expect(kept).toHaveLength(1);
  });
});

describe("unsubscribe link token", () => {
  const previous = { ...process.env };

  afterEach(() => {
    for (const key of ["UNSUBSCRIBE_TOKEN", "INBOUND_EMAIL_SECRET", "SESSION_SECRET"] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("matches the Worker's mint function exactly", () => {
    process.env.UNSUBSCRIBE_TOKEN = "shared-unsubscribe-secret";
    const url = buildUnsubscribeUrl("Patient@Example.COM", "support");
    const token = new URL(url).searchParams.get("token");
    expect(token).toBe(workerMint("shared-unsubscribe-secret", "patient@example.com", "support"));
    expect(url).toContain("email=patient%40example.com");
    expect(url).toContain("category=support");
  });

  it("defaults the category to all, exactly as the Worker normalises it", () => {
    process.env.UNSUBSCRIBE_TOKEN = "shared-unsubscribe-secret";
    const url = buildUnsubscribeUrl("patient@example.com");
    const parsed = new URL(url);
    // The Worker substitutes "all" for a missing category when verifying.
    expect(parsed.searchParams.get("token")).toBe(
      workerMint("shared-unsubscribe-secret", "patient@example.com", "all"),
    );
  });

  it("falls back to INBOUND_EMAIL_SECRET and omits the token when nothing is configured", () => {
    delete process.env.UNSUBSCRIBE_TOKEN;
    delete process.env.SESSION_SECRET;
    process.env.INBOUND_EMAIL_SECRET = "fallback-secret";
    expect(mintUnsubscribeToken("a@b.com", "all")).toBe(
      workerMint("fallback-secret", "a@b.com", "all"),
    );

    delete process.env.INBOUND_EMAIL_SECRET;
    const url = buildUnsubscribeUrl("a@b.com");
    expect(new URL(url).searchParams.get("token")).toBeNull();
  });
});