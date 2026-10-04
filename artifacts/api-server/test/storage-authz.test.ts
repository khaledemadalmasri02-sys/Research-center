// A2 + A3 — object-store authorisation.
//
// A2: /api/storage/public-objects/* must reject unauthenticated callers, reject
//     authenticated non-admins, and never resolve a key outside its configured
//     search prefix (traversal / absolute key).
// A3: /api/storage/objects/* and /api/storage/images/by-patient/:patientId must
//     apply the object ACL layer plus patients.user_id ownership, and must not
//     stream bytes for a denied request.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { withDb, type DbFixture } from "./helpers/db";
import {
  s3Client,
  resolveKeyWithinPrefix,
  ObjectStorageService,
} from "../src/lib/objectStorage";
import { pool } from "@workspace/db";
import { __resetRateLimits } from "../src/lib/security";

const BUCKET = process.env.S3_BUCKET ?? "test-bucket";
const PATIENT_TABLE = process.env.PATIENT_TABLE ?? "patients";

async function seedObject(key: string, body = "phi-bytes") {
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

/** Replace `patientIds` with patients owned by `userId`. */
async function seedPatients(
  userId: number,
  patientIds: string[],
): Promise<void> {
  for (const id of patientIds) {
    await pool.query(`DELETE FROM "${PATIENT_TABLE}" WHERE "patient_id" = $1`, [id]);
  }
  for (const id of patientIds) {
    await pool.query(
      `INSERT INTO "${PATIENT_TABLE}"
         ("patient_id", "patient_name", "user_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, now(), now())`,
      [id, `Patient ${id}`, userId],
    );
  }
}

describe("A2 — retired /storage/public-objects route", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
    await wipeBucket();
    // A dump in the bucket: exactly what the route used to be able to stream.
    await seedObject("backups/nightly.sql", "-- full database dump");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(t.app).get("/api/storage/public-objects/backups/nightly.sql");
    expect([401, 403]).toContain(res.status);
    expect(res.text).not.toContain("full database dump");
  });

  it("rejects an authenticated non-admin with 403", async () => {
    await t.createUser({ username: "po-editor", password: "StrongPass1!", role: "editor" });
    const agent = await t.loginAs("po-editor", "StrongPass1!");
    const res = await agent.get("/api/storage/public-objects/backups/nightly.sql");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("full database dump");
  });

  it("answers 410 Gone for an admin (route retired, kept registered)", async () => {
    await t.createUser({
      username: "po-admin",
      password: "StrongPass1!",
      role: "admin",
      canAdminAccess: true,
    });
    const agent = await t.loginAs("po-admin", "StrongPass1!");
    const res = await agent.get("/api/storage/public-objects/backups/nightly.sql");
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/retired/i);
    expect(res.text).not.toContain("full database dump");
  });
});

describe("A2 — searchPublicObject cannot escape its prefix", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
    await wipeBucket();
    await seedObject("backups/nightly.sql", "-- full database dump");
    await seedObject("secrets/api-key.txt", "AKIA-not-really");
  });

  it("resolves a normal in-prefix path", () => {
    expect(resolveKeyWithinPrefix("mednexus", "logo.png")).toBe("/mednexus/logo.png");
    expect(resolveKeyWithinPrefix("/mednexus/", "a/b.png")).toBe("/mednexus/a/b.png");
  });

  it("refuses traversal, absolute keys and over-long keys", () => {
    for (const bad of [
      "../../backups/nightly.sql",
      "../backups/nightly.sql",
      "a/../../backups/nightly.sql",
      "/backups/nightly.sql",
      "//backups/nightly.sql",
      `x/${"y".repeat(1100)}`,
      "",
      ".",
    ]) {
      expect(resolveKeyWithinPrefix("mednexus", bad), `should refuse: ${bad}`).toBeNull();
    }
  });

  it("never returns a key outside the prefix from the live service", async () => {
    const previous = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
    // A configured search path is "<bucket>/<key-prefix>" — `parseObjectPath`
    // reads the first segment as the bucket.
    process.env.PUBLIC_OBJECT_SEARCH_PATHS = `${BUCKET}/mednexus`;
    try {
      const svc = new ObjectStorageService();
      for (const probe of [
        "../../backups/nightly.sql",
        "/backups/nightly.sql",
        "../../secrets/api-key.txt",
      ]) {
        const found = await svc.searchPublicObject(probe);
        expect(found, `should not resolve: ${probe}`).toBeNull();
      }

      // A genuine in-prefix object still resolves (no false negatives).
      await seedObject("mednexus/logo.png");
      const ok = await svc.searchPublicObject("logo.png");
      expect(ok?.key).toBe("mednexus/logo.png");

      // ...but not from a sibling prefix.
      await seedObject("other/logo.png");
      expect(await svc.searchPublicObject("../other/logo.png")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_OBJECT_SEARCH_PATHS;
      else process.env.PUBLIC_OBJECT_SEARCH_PATHS = previous;
    }
  });

  it("no authenticated route streams a backups/ object", async () => {
    const anon = await request(t.app).get("/api/storage/objects/backups/nightly.sql");
    expect([401, 403]).toContain(anon.status);
    expect(anon.text).not.toContain("full database dump");
  });
});

describe("A3 — object reads are scoped to the owning patient", () => {
  const t: DbFixture = withDb();

  beforeEach(async () => {
    __resetRateLimits();
    await wipeBucket();

    const aliceId = await t.createUser({
      username: "alice",
      password: "StrongPass1!",
      role: "editor",
    });
    const bobId = await t.createUser({
      username: "bob",
      password: "StrongPass1!",
      role: "editor",
    });
    await seedPatients(aliceId, ["42", "420"]);
    await seedPatients(bobId, ["77"]);

    // Canonical layout + the legacy `<timestamp>-patient_<id>_` layout.
    await seedObject("radiology/patient_42_a.png", "alice-image");
    await seedObject("radiology/1700000000-patient_77_b.png", "bob-image");
  });

  it("user A cannot read user B's image key (403, body never streamed)", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.get("/api/storage/objects/radiology/1700000000-patient_77_b.png");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("bob-image");
  });

  it("user A can read their own patient's image", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.get("/api/storage/objects/radiology/patient_42_a.png");
    expect(res.status).toBe(200);
    // image/png: supertest buffers the body rather than decoding it as text.
    expect(Buffer.from(res.body as Buffer).toString("utf8")).toContain("alice-image");
  });

  it("denies a key whose patient id is only a string prefix of another patient's", async () => {
    // `patient_420` and `patient_42` are different patients; the filter must
    // not let one read the other's images.
    await seedObject("radiology/patient_420_c.png", "alice-420-image");
    const bob = await t.loginAs("bob", "StrongPass1!");
    const res = await bob.get("/api/storage/objects/radiology/patient_42_a.png");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("alice-image");

    const alice = await t.loginAs("alice", "StrongPass1!");
    const own = await alice.get("/api/storage/objects/radiology/patient_420_c.png");
    expect(own.status).toBe(200);
    expect(Buffer.from(own.body as Buffer).toString("utf8")).toContain("alice-420-image");
  });

  it("does not leak another user's patient image list", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.get("/api/storage/images/by-patient/77");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("patient_77");
  });

  it("lists only the caller's own patient images", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.get("/api/storage/images/by-patient/42");
    expect(res.status).toBe(200);
    expect(res.body.images).toEqual(["radiology/patient_42_a.png"]);
  });

  it("rejects attaching an upload to another user's patient", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.post("/api/storage/uploads/request-url").send({
      name: "scan.png",
      size: 1024,
      contentType: "image/png",
      patientId: "77",
    });
    expect([403, 404]).toContain(res.status);
  });

  it("scopes a presigned URL to the caller's own patient when patientId is given", async () => {
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.post("/api/storage/uploads/request-url").send({
      name: "scan.png",
      size: 1024,
      contentType: "image/png",
      patientId: "42",
    });
    expect(res.status).toBe(200);
    expect(res.body.objectPath).toContain("patient_42_");
  });

  it("still allows reading an unattributable object key (presigned-upload flow)", async () => {
    await seedObject("radiology/1700000000-standalone.png", "standalone");
    const alice = await t.loginAs("alice", "StrongPass1!");
    const res = await alice.get("/api/storage/objects/radiology/1700000000-standalone.png");
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).toString("utf8")).toContain("standalone");
  });
});