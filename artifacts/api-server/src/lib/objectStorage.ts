import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectAclCommand,
  type PutObjectCommandOutput,
  type HeadObjectOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  getObjectAclPolicy,
  ObjectAccessGroup,
} from "./objectAcl";

const DEFAULT_S3_REGION = "us-east-1";
const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 300;

// Legacy read-path env vars. New code writes only to
// <bucket>/radiology/<object-id>; the env vars below are kept so a
// bucket that still contains objects from an older deployment
// (under the historical /mednexus/ or /objects/ prefix) is
// readable. See STORAGE.md (repo root) for the canonical scheme.
const PUBLIC_OBJECT_SEARCH_PATHS_ENV = "PUBLIC_OBJECT_SEARCH_PATHS";
const PRIVATE_OBJECT_DIR_ENV = "PRIVATE_OBJECT_DIR";

const s3Region = process.env.S3_REGION || DEFAULT_S3_REGION;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;

export const s3Client = new S3Client({
  region: s3Region,
  endpoint: s3Endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: s3AccessKey || "minioadmin",
    secretAccessKey: s3SecretKey || "minioadmin",
  },
});

if (process.env.NODE_ENV === "production" && (!s3AccessKey || !s3SecretKey)) {
  throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set in production");
}

export class ObjectNotFoundError extends Error {
  constructor(message = "Object not found") {
    super(message);
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class BucketNotFoundError extends Error {
  constructor(message = "Bucket not found") {
    super(message);
    this.name = "BucketNotFoundError";
    Object.setPrototypeOf(this, BucketNotFoundError.prototype);
  }
}

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotConfiguredError";
    Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
  }
}

export interface S3Object {
  bucketName: string;
  key: string;
}

export interface StoredObject {
  bucketName: string;
  objectName: string;
  metadata?: Record<string, string>;
}

export class ObjectStorageService {
  private bucket?: string;
  private publicSearchPaths: string[] = [];

  constructor() {
    this.bucket = this.getBucket();
    this.publicSearchPaths = this.getPublicObjectSearchPaths();
  }

  getBucket(): string {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new StorageNotConfiguredError(
        "S3_BUCKET environment variable is not set. Configure S3-compatible storage."
      );
    }
    return bucket;
  }

  getRegion(): string {
    return process.env.S3_REGION || DEFAULT_S3_REGION;
  }

  getSignedUrlExpiresSeconds(): number {
    const val = process.env.S3_SIGNED_URL_EXPIRES_SECONDS;
    return val ? parseInt(val, 10) : DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
  }

  getPublicObjectSearchPaths(): string[] {
    const pathsStr = process.env[PUBLIC_OBJECT_SEARCH_PATHS_ENV] || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env[PRIVATE_OBJECT_DIR_ENV] || "";
    if (!dir) {
      throw new StorageNotConfiguredError(
        `No private object directory configured. Set ${PRIVATE_OBJECT_DIR_ENV} environment variable.`
      );
    }
    return dir;
  }

  parseObjectPath(path: string): S3Object {
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
    const pathParts = path.split("/");
    if (pathParts.length < 3) {
      throw new Error("Invalid path: must contain at least a bucket name");
    }

    const bucketName = pathParts[1];
    const objectName = pathParts.slice(2).join("/");

    return { bucketName, key: objectName };
  }

  async ensureBucketExists(): Promise<void> {
    if (!this.bucket) {
      throw new StorageNotConfiguredError("S3_BUCKET not configured");
    }

    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        throw new BucketNotFoundError(
          `Bucket '${this.bucket}' does not exist. Please create it first.`
        );
      }
      throw err;
    }
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "NotFound" || err.name === "NoSuchKey") {
        return false;
      }
      throw err;
    }
  }

  async searchPublicObject(filePath: string): Promise<S3Object | null> {
    for (const searchPath of this.publicSearchPaths) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, key } = this.parseObjectPath(fullPath);
      const exists = await this.objectExists(bucketName, key);
      if (exists) {
        return { bucketName, key };
      }
    }

    return null;
  }

  async downloadObject(
    object: S3Object,
    cacheTtlSec: number = 3600
  ): Promise<Response> {
    try {
      const command = new GetObjectCommand({
        Bucket: object.bucketName,
        Key: object.key,
      });

      const response = await s3Client.send(command);
      const body = response.Body;

      if (!body) {
        throw new ObjectNotFoundError(`Object not found: s3://${object.bucketName}/${object.key}`);
      }

      const nodeStream = body as Readable;
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

      const headers: Record<string, string> = {
        "Content-Type": response.ContentType || "application/octet-stream",
        "Cache-Control": `private, max-age=${cacheTtlSec}`,
      };

      if (response.ContentLength) {
        headers["Content-Length"] = String(response.ContentLength);
      }

      const aclPolicy = await getObjectAclPolicy({ bucketName: object.bucketName, key: object.key });
      const isPublic = aclPolicy?.visibility === "public";
      headers["Cache-Control"] = `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`;

      return new Response(webStream, { headers });
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err.name === "NotFound" || err.name === "NoSuchKey" || err.message?.includes("not found")) {
        throw new ObjectNotFoundError(`Object not found: s3://${object.bucketName}/${object.key}`);
      }
      throw err;
    }
  }

  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    ttlSec: number = 900
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(s3Client, command, {
      expiresIn: ttlSec,
    });
  }

  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    ttlSec: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return getSignedUrl(s3Client, command, {
      expiresIn: ttlSec,
    });
  }

  async uploadObject(
    bucket: string,
    key: string,
    body: Uint8Array | Readable | Blob,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<{ etag: string; versionId?: string }> {
    const params: PutObjectCommandOutput = await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
      })
    );

    return {
      etag: params.ETag || "",
      versionId: params.VersionId,
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  }

  async getObjectMetadata(bucket: string, key: string): Promise<HeadObjectOutput> {
    return s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  }

  async setAclPolicy(
    object: S3Object,
    aclPolicy: ObjectAclPolicy
  ): Promise<void> {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: object.bucketName,
        Key: object.key,
      })
    );

    await s3Client.send(
      new PutObjectCommand({
        Bucket: object.bucketName,
        Key: object.key,
        Body: response.Body,
        ContentType: response.ContentType,
        Metadata: {
          aclPolicy: JSON.stringify(aclPolicy),
        },
      })
    );
  }

  async getObjectAclPolicyFromS3(object: S3Object): Promise<ObjectAclPolicy | null> {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: object.bucketName,
          Key: object.key,
        })
      );

      const xmlStr = response.Metadata?.aclPolicy;
      if (!xmlStr) {
        return null;
      }

      return JSON.parse(xmlStr as string);
    } catch {
      return null;
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, key } = this.parseObjectPath(fullPath);

    return this.getPresignedUploadUrl(bucketName, key, "application/octet-stream");
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return rawPath.startsWith("/objects/")
      ? rawPath
      : rawPath.startsWith("https://")
        ? this.normalizeFromUrl(rawPath)
        : rawPath;
  }

  private normalizeFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname;

      const privateObjectDir = this.getPrivateObjectDir();
      if (!path.startsWith(privateObjectDir)) {
        return `s3://${this.bucket}/${path}`;
      }

      const entityId = path.slice(privateObjectDir.length);
      return `/objects/${entityId}`;
    } catch {
      return url;
    }
  }

  async getObjectEntityFile(objectPath: string): Promise<S3Object> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError("Invalid object path format");
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError("Invalid object path");
    }

    const entityId = parts.slice(1).join("/");
    const objectEntityDir = this.getPrivateObjectDir();
    const objectPathS3 = `${objectEntityDir}/${entityId}`;

    const { bucketName, key } = this.parseObjectPath(objectPathS3);

    const exists = await this.objectExists(bucketName, key);
    if (exists) {
      return { bucketName, key };
    }

    const extMatch = key.match(/\.[a-zA-Z0-9]{2,5}$/);
    if (!extMatch) {
      const response = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: key,
          MaxKeys: 1,
        })
      );

      const commonPrefix = response.CommonPrefixes?.[0]?.Prefix;
      if (commonPrefix) {
        const foundKey = commonPrefix.slice(0, -1);
        return { bucketName, key: foundKey };
      }

      const contents = response.Contents;
      if (contents && contents.length > 0 && contents[0]?.Key) {
        return { bucketName, key: contents[0].Key };
      }
    }

    throw new ObjectNotFoundError(`Object not found: ${objectPath}`);
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3Object;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const aclPolicy = await getObjectAclPolicy({ bucketName: objectFile.bucketName, key: objectFile.key });

    if (!aclPolicy) {
      return false;
    }

    const permission = requestedPermission ?? ObjectPermission.READ;

    if (aclPolicy.visibility === "public" && permission === ObjectPermission.READ) {
      return true;
    }

    if (!userId) {
      return false;
    }

    if (aclPolicy.owner === userId) {
      return true;
    }

    for (const rule of aclPolicy.aclRules || []) {
      const accessGroup = createObjectAccessGroup(rule.group);
      if (
        (await accessGroup.hasMember(userId)) &&
        isPermissionAllowed(permission, rule.permission)
      ) {
        return true;
      }
    }

    return false;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await this.setAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

export enum ObjectAccessGroupType {}

function createObjectAccessGroup(group: ObjectAccessGroup): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}