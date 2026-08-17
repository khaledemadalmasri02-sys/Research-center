import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, BucketNotFoundError } from "../lib/objectStorage";
import { s3Client } from "../lib/objectStorage";
import { PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db, patientsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { radiologyImageService } from "../lib/radiologyImages";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

async function discoverImagesByPatientId(patientId: string): Promise<string[]> {
  if (!patientId) return [];
  try {
    const bucket = objectStorageService.getBucket();
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `radiology/patient_${patientId}_`,
    }));
    const keys: string[] = [];
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    return keys;
  } catch {
    return [];
  }
}

function isImageUrl(path: string): boolean {
  if (!path) return false;
  const trimmed = path.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function validateImportImageBody(body: unknown): { url: string; filename?: string; patientId?: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.url !== "string" || !obj.url) return null;
  return {
    url: obj.url,
    filename: typeof obj.filename === "string" ? obj.filename : undefined,
    patientId: typeof obj.patientId === "string" ? obj.patientId : undefined,
  };
}

function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

function guessExtension(url: string, contentType: string | null): string {
  if (contentType) {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("gif")) return "gif";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  }
  const m = url.match(/\.(png|jpg|jpeg|gif|webp)(\?|$)/i);
  if (m) return m[1]!.toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

router.get("/storage/health", async (_req: Request, res: Response) => {
  try {
    await objectStorageService.ensureBucketExists();
    res.json({ status: "ok", storage: "healthy" });
  } catch (error) {
    const err = error as Error & { name?: string };
    res.status(503).json({ 
      status: "unhealthy", 
      storage: "unavailable", 
      error: err.message,
      errorCode: err.name
    });
  }
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const bucket = objectStorageService.getBucket();
    const safeName = sanitizeFilename(name);
    const objectId = `${Date.now()}-${safeName}`;
    const objectKey = `radiology/${objectId}`;

    const uploadURL = await objectStorageService.getPresignedUploadUrl(
      bucket,
      objectKey,
      contentType,
      900
    );

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath: objectKey,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : (raw as string);
    
    if (!objectStorageService.getPublicObjectSearchPaths().length) {
      res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
          'utf-8'
        )
      );
      return;
    }
    
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
          'utf-8'
        )
      );
      return;
    }

    const presignedUrl = await objectStorageService.getPresignedDownloadUrl(
      file.bucketName,
      file.key,
      3600
    );

    res.redirect(303, presignedUrl);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err: err.message, filePath: req.params.filePath }, "Error serving public object");
    res.status(200).type("image/svg+xml").set("Cache-Control", "public, max-age=3600").send(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f3f4f6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui" font-size="14" font-weight="500">Image not found</text></svg>',
        'utf-8'
      )
    );
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectKey = Array.isArray(raw) ? raw.join("/") : raw;
    
    const bucket = objectStorageService.getBucket();
    const exists = await objectStorageService.objectExists(bucket, objectKey);
    
    if (!exists) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const presignedUrl = await objectStorageService.getPresignedDownloadUrl(
      bucket,
      objectKey,
      3600
    );

    res.redirect(303, presignedUrl);
  } catch (error) {
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

router.post("/storage/ensure-bucket", async (_req: Request, res: Response) => {
  try {
    await objectStorageService.ensureBucketExists();
    res.json({ message: "Bucket is ready" });
  } catch (error) {
    const err = error as Error;
    if (err instanceof BucketNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

interface ImportImageFromUrlResponse {
  objectPath: string;
  contentType: string;
}

router.post("/storage/images/import", async (req: Request, res: Response) => {
  const body = validateImportImageBody(req.body);
  if (!body) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { url, filename } = body;
  if (!isImageUrl(url)) {
    res.status(400).json({ error: "A valid image URL is required" });
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      res.status(400).json({ error: `Failed to fetch image from URL: HTTP ${response.status}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      res.status(400).json({ error: `URL does not point to an image (content-type: ${contentType})` });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);

    const ext = guessExtension(url, contentType);
    const baseName = filename ? sanitizeFilename(filename.replace(/\.[^/.]+$/, "")) : `imported_${Date.now()}`;
    const cleanExt = ext.replace(/^\./, "");
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${cleanExt}`;
    const objectKey = `radiology/${objectId}`;

    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    res.json({
      objectPath: objectKey,
      contentType: contentType,
    } as ImportImageFromUrlResponse);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err }, "Failed to import image from URL");
    res.status(500).json({ error: err.message || "Failed to import image from URL" });
  }
});

interface ImportImageByPatientResponse {
  objectPath: string;
  patientImages: string[];
}

router.post("/storage/images/by-patient", async (req: Request, res: Response) => {
  const body = validateImportImageBody(req.body);
  if (!body) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { url, filename, patientId } = body;
  if (!isImageUrl(url)) {
    res.status(400).json({ error: "A valid image URL is required" });
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      res.status(400).json({ error: `Failed to fetch image from URL: HTTP ${response.status}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      res.status(400).json({ error: `URL does not point to an image (content-type: ${contentType})` });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);

    const ext = guessExtension(url, contentType);
    const baseName = patientId ? `patient_${patientId}` : (filename ? sanitizeFilename(filename.replace(/\.[^/.]+$/, "")) : `imported_${Date.now()}`);
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const objectKey = `radiology/${objectId}`;

    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }));

    const discoveredImages = patientId ? await discoverImagesByPatientId(patientId) : [];

    res.json({
      objectPath: objectKey,
      patientImages: discoveredImages,
    } as ImportImageByPatientResponse);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err }, "Failed to import image for patient");
    res.status(500).json({ error: err.message || "Failed to import image for patient" });
  }
});

router.get("/storage/images/by-patient/:patientId", async (req: Request, res: Response) => {
  const { patientId } = req.params;
  try {
    const images = await discoverImagesByPatientId(patientId as string);
    res.json({ patientId, images });
  } catch {
    res.status(500).json({ error: "Failed to discover images" });
  }
});

router.post("/storage/images/search", async (req: Request, res: Response) => {
  const { identifier, patientId, filename } = req.body as { identifier?: string; patientId?: string; filename?: string };
  
  if (!identifier && !filename) {
    res.status(400).json({ error: "Either 'identifier' or 'filename' is required" });
    return;
  }
  
  try {
    const bucket = objectStorageService.getBucket();
    const keys: string[] = [];
    
    if (identifier) {
      const patterns = [
        `radiology/${identifier}_`,
        `radiology/patient_${identifier}_`,
        `radiology/${identifier}.`,
        `radiology/image_${identifier}.`,
      ];
      
      for (const prefix of patterns) {
        const response = await s3Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
        }));
        for (const obj of response.Contents ?? []) {
          if (obj.Key && !keys.includes(obj.Key)) {
            keys.push(obj.Key);
          }
        }
      }
    }
    
    if (filename) {
      const searchKey = filename.toLowerCase();
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "radiology/",
      }));
      for (const obj of response.Contents ?? []) {
        if (obj.Key && obj.Key.toLowerCase().includes(searchKey) && !keys.includes(obj.Key)) {
          keys.push(obj.Key);
        }
      }
    }
    
    const result: { objectPath: string; patientImages?: string[]; attachmentPatientId?: string } = {
      objectPath: keys[0] ?? "",
    };
    
    if (!result.objectPath) {
      res.status(404).json({ error: "No images found matching the criteria" });
      return;
    }
    
    if (patientId) {
      result.attachmentPatientId = patientId;
      if (!keys[0]?.startsWith("radiology/")) {
        result.objectPath = `radiology/${keys[0]}`;
      }
      result.patientImages = keys;
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to search images", details: String(error) });
  }
});

router.post("/storage/upload-file", async (req: Request, res: Response) => {
  const patientId = req.body?.patientId as string | undefined;
  
  // Ensure bucket exists first
  try {
    await objectStorageService.ensureBucketExists();
  } catch {
    res.status(503).json({ error: "Storage bucket not available" });
    return;
  }
  
  try {
    const fileData = req.body?.fileData as string | undefined;
    const filename = req.body?.filename as string | undefined;
    const contentType = req.body?.contentType as string | undefined;
    
    if (!fileData) {
      res.status(400).json({ error: "No file data provided (fileData as base64)" });
      return;
    }
    
    if (!filename) {
      res.status(400).json({ error: "No filename provided" });
      return;
    }
    
    const sanitizedFilename = sanitizeFilename(filename);
    const ext = sanitizedFilename.split('.').pop() || 'jpg';
    const baseName = patientId ? `patient_${patientId}` : `upload_${Date.now()}`;
    const objectId = `${Date.now()}-${baseName}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const objectKey = `radiology/${objectId}`;
    
    const buffer = Buffer.from(fileData, 'base64');
    
    const bucket = objectStorageService.getBucket();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType || 'image/jpeg',
    }));
    
    const result: Record<string, any> = { objectPath: objectKey, objectUrl: `/api/storage/public-objects/${objectKey}` };
    
    if (patientId) {
      req.log.info({ patientId }, "Looking up patient for image upload");
      
      const normalizedId = patientId.replace(/^PAT/, '');
      
      const [patient] = await db
        .select()
        .from(patientsTable)
        .where(eq(patientsTable.patientId, normalizedId))
        .limit(1);
      
      if (!patient) {
        const [patientWithPat] = await db
          .select()
          .from(patientsTable)
          .where(eq(patientsTable.patientId, patientId))
          .limit(1);
        
        if (!patientWithPat) {
          req.log.warn({ patientId }, "Patient not found during image upload");
          res.status(200).json(result);
          return;
        }
        
        await updatePatientImages(req, patientWithPat, objectKey, result);
        return;
      }
      
      await updatePatientImages(req, patient, objectKey, result);
    }
    
    res.json(result);
  } catch (error) {
    const err = error as Error;
    req.log.error({ err: err.message, patientId }, "Upload failed");
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

async function updatePatientImages(req: Request, patient: any, objectKey: string, result: Record<string, any>) {
  try {
    const fileData = req.body?.fileData as string | undefined;
    const fileSize = fileData ? Buffer.from(fileData, "base64").length : null;

    await radiologyImageService.addImage(patient.id, {
      objectKey,
      originalFilename: (req.body?.filename as string) ?? null,
      mimeType: (req.body?.contentType as string) ?? null,
      fileSize,
    });

    const images = await radiologyImageService.listImages(patient.id);

    req.log.info({ patientId: patient?.patientId, imageCount: images.length }, "Patient images updated successfully");

    result.patientId = patient.patientId;
    result.previewsCount = images.length;
    result.patientImages = images.map((i: { objectKey: string }) => i.objectKey);
  } catch (updateErr: any) {
    req.log.error({ updateErr, patientId: patient?.patientId }, "Failed to update patient images");
  }
}

export default router;