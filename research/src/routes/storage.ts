import type { Context } from "hono";
import { getS3Config, putObject, getObject, getPresignedUrl } from "../lib/s3";
import { resolvePatient, parseRadiologyImages, parseRadiologyLinks } from "../lib/patients";

const sanitizeFilename = (name: string): string => {
  return name.trim().replace(/[^a-zA-Z0-9.\-_]/g, "_");
};

interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

interface UploadFileRequest {
  patientId?: string | number;
  filename: string;
  contentType: string;
  fileData: string;
}

interface SessionData {
  authenticated: boolean;
  username?: string;
}

interface R2BucketWithSignedURL {
  get(key: string): Promise<Response>;
  put(key: string, body: BodyInit, options?: Record<string, any>): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: Record<string, any>): Promise<{ objects: Array<{ key: string }> }>;
  head(key: string, options?: Record<string, any>): Promise<Response>;
  getSignedURL(method: string, options: Record<string, any>): Promise<URL>;
}

function decodeBase64(data: string): Uint8Array {
  let b64 = data;
  const comma = data.indexOf(",");
  if (data.startsWith("data:") && comma !== -1) {
    b64 = data.slice(comma + 1);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const storageHandlers = {
  POST: async (c: Context) => {
    try {
      const session = c.get("session") as SessionData | null;
      if (!session?.authenticated) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const body = (await c.req.json()) as UploadUrlRequest;

      if (!body.name || !body.size || !body.contentType) {
        return c.json({ error: "Missing or invalid required fields" }, 400);
      }

      const bindings = c.env as any;
      const bucket = bindings.S3_BUCKET || "uploads";
      const safeName = sanitizeFilename(body.name);
      const objectId = `${Date.now()}-${safeName}`;
      const objectKey = `research/${bucket}/${objectId}`;
      let uploadURL: string;

      const r2Bucket = bindings.R2_BUCKET as unknown as R2BucketWithSignedURL | undefined;
      if (r2Bucket && typeof r2Bucket.getSignedURL === "function") {
        const signedURL = await r2Bucket.getSignedURL("put", {
          key: objectKey,
          httpMethod: "PUT",
          contentType: body.contentType,
          expires: 900,
        });
        uploadURL = signedURL.toString();
      } else {
        const s3 = getS3Config(bindings);
        if (!s3) {
          return c.json(
            {
              error:
                "Storage not configured. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY or configure R2 bucket.",
            },
            500
          );
        }
        uploadURL = await getPresignedUrl(s3, objectKey, "PUT", 900);
      }

      return c.json({
        uploadURL,
        objectPath: objectKey,
        metadata: {
          name: body.name,
          size: body.size,
          contentType: body.contentType,
        },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      const message = error instanceof Error ? error.message : "Failed to generate upload URL";
      return c.json({ error: message }, 500);
    }
  },

  OPTIONS: (c: Context) => {
    return c.newResponse(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
  },

  UPLOAD_FILE: async (c: Context) => {
    try {
      const session = c.get("session") as SessionData | null;
      if (!session?.authenticated) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const body = (await c.req.json()) as UploadFileRequest;
      if (!body.filename || !body.contentType || !body.fileData) {
        return c.json({ error: "filename, contentType and fileData are required" }, 400);
      }

      const bindings = c.env as any;
      const db = bindings.DB;
      const bytes = decodeBase64(body.fileData);
      const safeName = sanitizeFilename(body.filename);

      // Resolve the patient from the supplied id (handles plain-number and
      // "PAT"-prefixed forms alike).
      const resolved = body.patientId ? await resolvePatient(db, body.patientId) : null;
      const patientKey = resolved?.patientId ?? "unknown";
      const key = `radiology/${patientKey}/${Date.now()}-${safeName}`;

      const r2Bucket = bindings.R2_BUCKET as unknown as R2BucketWithSignedURL | undefined;
      let objectPath = key;

      if (r2Bucket && typeof r2Bucket.put === "function") {
        await r2Bucket.put(key, bytes as BodyInit, {
          httpMetadata: { contentType: body.contentType },
        });
      } else {
        const s3 = getS3Config(bindings);
        if (!s3) {
          return c.json({ error: "Storage not configured." }, 500);
        }
        const result = await putObject(s3, key, bytes, body.contentType);
        objectPath = result.key;
      }

      // Persist the image reference on the patient record when resolved.
      if (resolved) {
        try {
          const existing = (await db
            .prepare("SELECT radiology_images, radiology_image_file_path_or_link FROM patients WHERE id = ?")
            .bind(resolved.id)
            .first()) as any;
          const images = parseRadiologyImages(existing?.radiology_images);
          images.push(key);
          const links = parseRadiologyLinks(existing?.radiology_image_file_path_or_link);
          links.push(key);
          await db
            .prepare(
              "UPDATE patients SET radiology_images = ?, radiology_image_file_path_or_link = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            )
            .bind(JSON.stringify(images), JSON.stringify(links), resolved.id)
            .run();
        } catch (e) {
          console.error("Failed to attach image to patient:", e);
        }
      }

      return c.json({ objectPath, url: `/api/storage/public-objects/${key}` }, 201);
    } catch (error) {
      console.error("Error uploading file:", error);
      const message = error instanceof Error ? error.message : "Failed to upload file";
      return c.json({ error: message }, 500);
    }
  },

  OBJECT: async (c: Context) => {
    const session = c.get("session") as SessionData | null;
    if (!session?.authenticated) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return serveObject(c, false);
  },

  PUBLIC_OBJECT: async (c: Context) => {
    return serveObject(c, true);
  },
};

async function serveObject(c: Context, _public: boolean) {
  try {
    // Derive the object key from the request path. Some Hono builds don't
    // populate the `*` wildcard param reliably, so slice it off the path
    // explicitly (works for both /api/storage/objects/* and
    // /api/storage/public-objects/*).
    const path = c.req.path;
    const marker = _public ? "/api/storage/public-objects/" : "/api/storage/objects/";
    const idx = path.indexOf(marker);
    const key = idx === -1 ? "" : decodeURIComponent(path.slice(idx + marker.length));
    if (!key) return c.json({ error: "Missing key" }, 400);

    const bindings = c.env as any;
    const r2Bucket = bindings.R2_BUCKET as unknown as R2BucketWithSignedURL | undefined;
    if (r2Bucket && typeof r2Bucket.get === "function") {
      const res = await r2Bucket.get(key);
      if (!res || res.status === 404) return c.json({ error: "Not found" }, 404);
      const body = await res.arrayBuffer();
      return new Response(body, {
        headers: {
          "Content-Type": res.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const s3 = getS3Config(bindings);
    if (!s3) return c.json({ error: "Storage not configured." }, 500);

    const result = await getObject(s3, key);
    if (result.status >= 400) return c.json({ error: "Not found" }, 404);

    return new Response(result.body, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Error serving object:", error);
    const message = error instanceof Error ? error.message : "Failed to serve object";
    return c.json({ error: message }, 500);
  }
}
