import type { Context } from "hono";

const sanitizeFilename = (name: string): string => {
  return name.trim().replace(/[^a-zA-Z0-9.\-_]/g, "_");
};

interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadUrlRequest;
}

interface R2SignedUrlOptions {
  key: string;
  httpMethod: string;
  contentType?: string;
  expires: number;
}

interface R2BucketWithSignedURL {
  get(key: string): Promise<Response>;
  put(key: string, body: BodyInit, options?: Record<string, any>): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: Record<string, any>): Promise<{ objects: Array<{ key: string }> }>;
  head(key: string, options?: Record<string, any>): Promise<Response>;
  getSignedURL(method: string, options: R2SignedUrlOptions): Promise<URL>;
}

interface SessionData {
  authenticated: boolean;
  username?: string;
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

      const bucket = (c.env as any).S3_BUCKET || "uploads";
      const safeName = sanitizeFilename(body.name);
      const objectId = `${Date.now()}-${safeName}`;
      const objectKey = `radiology/${bucket}/${objectId}`;

      const bindings = c.env as any;
      let uploadURL: string;

      if (bindings.R2_BUCKET) {
        const r2Bucket = bindings.R2_BUCKET as unknown as R2BucketWithSignedURL;
        if (typeof r2Bucket.getSignedURL === "function") {
          const signedURL = await r2Bucket.getSignedURL("put", {
            key: objectKey,
            httpMethod: "PUT",
            contentType: body.contentType,
            expires: 900,
          });
          uploadURL = signedURL.toString();
        } else {
          return c.json({ error: "R2 signed URL not available" }, 500);
        }
      } else if (bindings.S3_BUCKET) {
        const region = bindings.S3_REGION || "auto";
        const endpoint = bindings.S3_ENDPOINT;
        const accessKeyId = bindings.S3_ACCESS_KEY_ID || "";
        const secretAccessKey = bindings.S3_SECRET_ACCESS_KEY || "";

        if (accessKeyId && secretAccessKey) {
          const baseUrl = endpoint 
            ? `${endpoint}/${bucket}` 
            : `https://${bucket}.s3.${region}.amazonaws.com`;
          const url = new URL(objectKey, baseUrl);
          uploadURL = url.toString();
        } else {
          uploadURL = `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
        }
      } else {
        return c.json({ error: "Storage not configured" }, 500);
      }

      return c.json<UploadUrlResponse>({
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
      return c.json({ error: "Failed to generate upload URL" }, 500);
    }
  },

  OPTIONS: (c: Context) => {
    return c.newResponse(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
  },
};