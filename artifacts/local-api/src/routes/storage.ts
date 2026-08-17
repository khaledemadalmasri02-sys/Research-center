import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const sanitizeFilename = (name: string): string => {
  return name.trim().replace(/[^a-zA-Z0-9.\-_]/g, "_");
};

router.get("/storage/health", async (_req: Request, res: Response) => {
  res.json({ status: "ok", storage: "healthy" });
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const bucket = process.env.S3_BUCKET || "mednexus";
    const safeName = sanitizeFilename(name);
    const objectId = `${Date.now()}-${safeName}`;

    const objectKey = `radiology/${bucket}/${objectId}`;

    const endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
    const uploadURL = `${endpoint.replace(/\/$/, "")}/${bucket}/${objectKey}`;

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath: objectKey,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    (req as any).log?.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/:filePath", (_req, res) => {
  res.status(200).json({ message: "Storage placeholder" });
});

export default router;