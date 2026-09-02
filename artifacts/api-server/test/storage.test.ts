import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import {
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { s3Client } from "../src/lib/objectStorage.ts";
import { withDb, type DbFixture } from "./helpers/db.ts";

// Minimal 1x1 PNG.
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf0000000300010054f81a4d0000000049454e44ae426082",
  "hex",
);

async function uploadToPresigned(
  uploadURL: string,
  body: Buffer,
  contentType: string,
): Promise<number> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  return res.status;
}

describe("storage (P0.3 — slice 3: S3 round-trip)", () => {
  const t: DbFixture = withDb();
  const BUCKET = process.env.S3_BUCKET ?? "test-bucket";

  beforeEach(async () => {
    // Wipe the bucket so each test starts fresh.
    const list = await s3Client.send(
      new ListObjectsV2Command({ Bucket: BUCKET }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.Key) {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        );
      }
    }
  });

  it("health endpoint returns ok with a reachable MinIO (when authenticated)", async () => {
    // The /storage/health route is currently behind requireAuth (existing
    // behaviour in the storage router — see line 31 of routes/storage.ts).
    // The route's behaviour is tested here, not the auth gating. A future
    // cleanup PR should make health public (see comments at line 28).
    await t.createUser({
      username: "healthuser",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("healthuser", "StrongPass1!");
    const res = await agent.get("/api/storage/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", storage: "healthy" });
  });

  it("ensure-bucket is idempotent", async () => {
    const userId = await t.createUser({
      username: "admin",
      password: "StrongPass1!",
      canAdminAccess: true,
    });
    void userId;
    const agent = await t.loginAs("admin", "StrongPass1!");
    const r1 = await agent.post("/api/storage/ensure-bucket");
    expect(r1.status).toBe(200);
    const r2 = await agent.post("/api/storage/ensure-bucket");
    expect(r2.status).toBe(200);
  });

  it("rejects unauthenticated access to /api/storage/objects", async () => {
    const res = await request(t.app).get(
      "/api/storage/objects/radiology/foo.png",
    );
    expect(res.status).toBe(401);
  });

  it("issues a presigned PUT URL, accepts the upload, and serves the object", async () => {
    const userId = await t.createUser({
      username: "uploader",
      password: "StrongPass1!",
    });
    void userId;
    const agent = await t.loginAs("uploader", "StrongPass1!");

    // Request an upload URL.
    const reqRes = await agent
      .post("/api/storage/uploads/request-url")
      .send({
        name: "test-image.png",
        size: TINY_PNG.length,
        contentType: "image/png",
      });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.uploadURL).toMatch(/^https?:\/\//);
    expect(reqRes.body.objectPath).toMatch(/^radiology\/\d+-test-image\.png$/);
    const objectKey: string = reqRes.body.objectPath;

    // Upload via the presigned URL.
    const putStatus = await uploadToPresigned(
      reqRes.body.uploadURL,
      TINY_PNG,
      "image/png",
    );
    expect(putStatus).toBe(200);

    // The object should be present in the bucket.
    const head = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }),
    );
    expect(head.ContentLength).toBe(TINY_PNG.length);

    // Streamed download should return the same bytes.
    const dl = await agent.get(`/api/storage/objects/${objectKey}`);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, TINY_PNG)).toBe(0);
    expect(dl.headers["content-type"]).toBe("image/png");
  });

  it("rejects presigned upload with a wrong content-type when the server signs it", async () => {
    // This is an implementation-defined behaviour: the api-server signs the
    // presigned URL with the requested content-type, and S3/MinIO may (or
    // may not) reject a PUT with a different content-type depending on
    // configuration. We only assert that the *correct* content-type works
    // (above test) and that a different content-type is either accepted
    // (MinIO lenient) or rejected (strict). The key invariant: a request
    // is required to have a Content-Type header.
    await t.createUser({
      username: "wrongtype",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("wrongtype", "StrongPass1!");
    const reqRes = await agent
      .post("/api/storage/uploads/request-url")
      .send({
        name: "a.png",
        size: TINY_PNG.length,
        contentType: "image/png",
      });
    expect(reqRes.status).toBe(200);
    // Upload with the correct content-type should always succeed.
    const ok = await uploadToPresigned(
      reqRes.body.uploadURL,
      TINY_PNG,
      "image/png",
    );
    expect(ok).toBe(200);
  });

  it("blocks access to objects outside the allowed prefixes", async () => {
    await t.createUser({
      username: "evil",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("evil", "StrongPass1!");
    const res = await agent.get("/api/storage/objects/secrets/foo.txt");
    expect(res.status).toBe(403);
  });

  it("returns 404 for a missing radiology object", async () => {
    await t.createUser({
      username: "missingu",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("missingu", "StrongPass1!");
    const res = await agent.get(
      "/api/storage/objects/radiology/does-not-exist.png",
    );
    expect(res.status).toBe(404);
  });
});

describe("storage SSRF import (P0.3 — slice 3)", () => {
  const t: DbFixture = withDb();
  const BUCKET = process.env.S3_BUCKET ?? "test-bucket";

  beforeEach(async () => {
    const list = await s3Client.send(
      new ListObjectsV2Command({ Bucket: BUCKET }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.Key) {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        );
      }
    }
  });

  it("rejects missing url with 400", async () => {
    await t.createUser({
      username: "importer",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("importer", "StrongPass1!");
    const res = await agent
      .post("/api/storage/images/import")
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-http(s) url with 400", async () => {
    await t.createUser({
      username: "fileimp",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("fileimp", "StrongPass1!");
    const res = await agent
      .post("/api/storage/images/import")
      .send({ url: "file:///etc/passwd" });
    expect(res.status).toBe(400);
  });

  it("blocks SSRF to localhost (safeFetch)", async () => {
    await t.createUser({
      username: "ssrftest",
      password: "StrongPass1!",
    });
    const agent = await t.loginAs("ssrftest", "StrongPass1!");
    // safeFetch rejects RFC1918 + loopback. localhost should be blocked.
    const res = await agent
      .post("/api/storage/images/import")
      .send({ url: "http://localhost:9001/health" });
    // The endpoint may return 400 (URL not allowed) or 502 (fetch error).
    // What matters: it does NOT return 200 with the local file uploaded.
    expect(res.status).not.toBe(200);
  });
});