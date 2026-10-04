// A4 — read/write RBAC on /api/patients.
//
// A `viewer` session must get 403 on POST /patients, PATCH /patients/:id and
// DELETE /patients/:id, and none of those requests may reach the database.

import { describe, it, expect, beforeEach } from "vitest";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { withDb, type DbFixture } from "./helpers/db";
import { pool } from "@workspace/db";
import { s3Client } from "../src/lib/objectStorage";
import { __resetRateLimits } from "../src/lib/security";

const BUCKET = process.env.S3_BUCKET ?? "test-bucket";

async function wipeBucket() {
  let token: string | undefined = undefined;
  for (;;) {
    const res = await s3Client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      }
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    token = res.NextContinuationToken;
  }
}

const PATIENT_TABLE = process.env.PATIENT_TABLE ?? "patients";

async function userIdOf(username: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE username = $1`,
    [username],
  );
  return rows[0]!.id;
}

async function countPatients(ownerUserId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${PATIENT_TABLE}" WHERE "user_id" = $1`,
    [ownerUserId],
  );
  return Number(rows[0]!.count);
}

describe("A4 — viewers cannot mutate patients", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
    await pool.query(`DELETE FROM "${PATIENT_TABLE}"`);
    await t.createUser({ username: "carol", password: "StrongPass1!", role: "viewer" });
  });

  it("403s POST /patients and writes nothing", async () => {
    const agent = await t.loginAs("carol", "StrongPass1!");

    const res = await agent.post("/api/patients").send({
      patientId: "V-1",
      patientName: "Viewer Attempt",
    });

    expect(res.status).toBe(403);
    expect(await countPatients(await userIdOf("carol"))).toBe(0);
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`,
      ["V-1"],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("403s PATCH /patients/:id and changes nothing", async () => {
    const ownerId = await t.createUser({
      username: "dave",
      password: "StrongPass1!",
      role: "editor",
    });
    await pool.query(
      `INSERT INTO "${PATIENT_TABLE}" ("patient_id", "patient_name", "user_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, now(), now())`,
      ["E-1", "Original Name", ownerId],
    );

    const viewer = await t.loginAs("carol", "StrongPass1!");
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`,
      ["E-1"],
    );
    const res = await viewer.patch(`/api/patients/${rows[0]!.id}`).send({
      patientName: "Renamed By Viewer",
    });

    expect(res.status).toBe(403);
    const { rows: after } = await pool.query<{ patient_name: string }>(
      `SELECT patient_name FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`,
      ["E-1"],
    );
    expect(after[0]!.patient_name).toBe("Original Name");
  });

  it("403s DELETE /patients/:id and keeps the row", async () => {
    const ownerId = await t.createUser({
      username: "erin",
      password: "StrongPass1!",
      role: "editor",
    });
    await pool.query(
      `INSERT INTO "${PATIENT_TABLE}" ("patient_id", "patient_name", "user_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, now(), now())`,
      ["E-2", "Keep Me", ownerId],
    );
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`,
      ["E-2"],
    );

    const viewer = await t.loginAs("carol", "StrongPass1!");
    const res = await viewer.delete(`/api/patients/${rows[0]!.id}`);

    expect(res.status).toBe(403);
    const { rows: after } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`,
      ["E-2"],
    );
    expect(Number(after[0]!.count)).toBe(1);
  });

  it("still allows a viewer to read its own patient", async () => {
    const viewerId = await userIdOf("carol");
    const { rows: inserted } = await pool.query<{ id: number }>(
      `INSERT INTO "${PATIENT_TABLE}" ("patient_id", "patient_name", "user_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, now(), now()) RETURNING id`,
      ["E-3", "Readable", viewerId],
    );

    const viewer = await t.loginAs("carol", "StrongPass1!");
    const res = await viewer.get(`/api/patients/${inserted[0]!.id}`);
    expect(res.status).toBe(200);
  });

  it("A11 — the admin-only backfill endpoint persists discovered image keys", async () => {
    await wipeBucket();
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: "radiology/patient_900_a.png",
        Body: "img",
        ContentType: "image/png",
      }),
    );

    const ownerId = await t.createUser({
      username: "gina",
      password: "StrongPass1!",
      role: "editor",
    });
    await pool.query(
      `INSERT INTO "${PATIENT_TABLE}" ("patient_id", "patient_name", "user_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, now(), now())`,
      ["900", "Needs Backfill", ownerId],
    );

    // A non-admin cannot run the migration.
    await t.createUser({ username: "ivan", password: "StrongPass1!", role: "editor" });
    const editor = await t.loginAs("ivan", "StrongPass1!");
    const denied = await editor.post("/api/admin/patients/backfill-images");
    expect([403, 404]).toContain(denied.status);

    await t.createUser({
      username: "hank",
      password: "StrongPass1!",
      role: "admin",
      canAdminAccess: true,
    });
    const admin = await t.loginAs("hank", "StrongPass1!");
    const res = await admin.post("/api/admin/patients/backfill-images");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query<{
      radiology_images: string | null;
      radiology_image_file_path_or_link: string | null;
    }>(`SELECT radiology_images, radiology_image_file_path_or_link FROM "${PATIENT_TABLE}" WHERE patient_id = $1`, ["900"]);
    expect(rows[0]!.radiology_images).toContain("radiology/patient_900_a.png");
    expect(rows[0]!.radiology_image_file_path_or_link).toBe("radiology/patient_900_a.png");
  });

  it("still allows an editor to mutate", async () => {
    await t.createUser({ username: "edith", password: "StrongPass1!", role: "editor" });
    const editor = await t.loginAs("edith", "StrongPass1!");
    const created = await editor.post("/api/patients").send({
      patientId: "E-4",
      patientName: "Editor Created",
    });
    expect(created.status).toBe(201);
  });
});