// P1.14 — discoverImagesByPatientId + images/search prefix scoping,
// patientId validation, and pagination.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { s3Client } from "../src/lib/objectStorage.ts";
import { withDb, type DbFixture } from "./helpers/db";

const BUCKET = process.env.S3_BUCKET ?? "test-bucket";

async function seedObject(key: string, body = "fake-bytes") {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/png",
    }),
  );
}

async function wipeBucket() {
  let token: string | undefined = undefined;
  for (;;) {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        );
      }
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    token = res.NextContinuationToken;
  }
}

describe("P1.14 — /storage/images/by-patient/:patientId", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await wipeBucket();
    await t.createUser({
      username: "byPatientUser",
      password: "StrongPass1!",
    });
  });

  it("returns only the keys for the requested patient", async () => {
    await seedObject("radiology/patient_42_a.png");
    await seedObject("radiology/patient_42_b.png");
    await seedObject("radiology/patient_99_other.png");
    await seedObject("radiology/other_random.png");
    const agent = await t.loginAs("byPatientUser", "StrongPass1!");
    const res = await agent.get("/api/storage/images/by-patient/42");
    expect(res.status).toBe(200);
    expect(res.body.images.sort()).toEqual([
      "radiology/patient_42_a.png",
      "radiology/patient_42_b.png",
    ]);
  });

  it("returns an empty array when the patient has no images", async () => {
    const agent = await t.loginAs("byPatientUser", "StrongPass1!");
    const res = await agent.get("/api/storage/images/by-patient/42");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ patientId: "42", images: [] });
  });

  it("rejects non-numeric patientId (prefix-injection guard)", async () => {
    const agent = await t.loginAs("byPatientUser", "StrongPass1!");
    // Each of these would, if accepted, broaden the listing to
    // match objects from other patients.
    for (const bad of ["X_", "42_", "*", "42-99", "abc", "42;99"]) {
      const res = await agent.get(`/api/storage/images/by-patient/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });

  it("rejects unauthenticated access with 401", async () => {
    const res = await request(t.app).get(
      "/api/storage/images/by-patient/42",
    );
    expect(res.status).toBe(401);
  });
});

describe("P1.14 — /storage/images/search prefix scoping", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    await wipeBucket();
    await t.createUser({
      username: "searchUser",
      password: "StrongPass1!",
    });
  });

  it("identifier-based search lists only matching prefixes, never the whole bucket", async () => {
    // Seed data that matches the identifier-based search patterns:
    //   radiology/<identifier>_<rest>
    //   radiology/patient_<identifier>_<rest>
    //   radiology/<identifier>.<rest>
    //   radiology/image_<identifier>.<rest>
    // We spread 5 matched objects across the 4 patterns, plus 5
    // unrelated ones. Search for "abc" should return only the 5
    // matched ones.
    await seedObject("radiology/abc_1.png"); // pattern 1
    await seedObject("radiology/abc_2.png"); // pattern 1
    await seedObject("radiology/patient_abc_3.png"); // pattern 2
    await seedObject("radiology/abc.4.png"); // pattern 3
    await seedObject("radiology/image_abc.5.png"); // pattern 4
    for (let i = 0; i < 5; i++) {
      await seedObject(`radiology/random-${i}.png`);
    }

    const agent = await t.loginAs("searchUser", "StrongPass1!");
    const res = await agent.post("/api/storage/images/search").send({
      identifier: "abc",
    });
    expect(res.status).toBe(200);
    expect(res.body.objectPath).toMatch(/^radiology\//);
  });

  it("filename + patientId uses the patient's prefix only (no full-bucket scan)", async () => {
    // Filename containing "needle" — only matches in patient 7's set.
    await seedObject("radiology/patient_7_1.png");
    await seedObject("radiology/patient_7_2-needle.png");
    await seedObject("radiology/patient_8_3-needle.png");
    await seedObject("radiology/patient_9_4-needle.png");

    const agent = await t.loginAs("searchUser", "StrongPass1!");
    const res = await agent.post("/api/storage/images/search").send({
      filename: "needle",
      patientId: "7",
    });
    expect(res.status).toBe(200);
    expect(res.body.objectPath).toBe("radiology/patient_7_2-needle.png");
  });

  it("rejects filename without patientId/identifier (prevents O(bucket) scan)", async () => {
    const agent = await t.loginAs("searchUser", "StrongPass1!");
    const res = await agent.post("/api/storage/images/search").send({
      filename: "x.png",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/patientId or identifier/i);
  });

  it("rejects non-numeric patientId in search body", async () => {
    const agent = await t.loginAs("searchUser", "StrongPass1!");
    const res = await agent.post("/api/storage/images/search").send({
      filename: "x.png",
      patientId: "X_",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid patientId/i);
  });

  it("returns 404 when no objects match", async () => {
    const agent = await t.loginAs("searchUser", "StrongPass1!");
    const res = await agent.post("/api/storage/images/search").send({
      identifier: "does-not-exist",
    });
    expect(res.status).toBe(404);
  });
});
