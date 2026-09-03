// Minimal S3 / R2 (S3-compatible) client using AWS Signature Version 4.
// Supports path-style endpoints (MinIO, Cloudflare R2) and virtual-hosted AWS S3.

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // When set (MinIO, on-prem), requests go to `${endpoint}/${bucket}/${key}`.
  endpoint?: string;
  // Force path-style even for AWS. Default: path-style when endpoint is set,
  // otherwise virtual-hosted `${bucket}.s3.${region}.amazonaws.com`.
  pathStyle?: boolean;
}

function normalizeRegion(region: string): string {
  return !region || region === "auto" ? "us-east-1" : region;
}

interface Target {
  url: string;
  host: string;
  canonicalUri: string;
  region: string;
}

function buildTarget(config: S3Config, key: string): Target {
  const region = normalizeRegion(config.region);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const usePathStyle = config.pathStyle ?? !!config.endpoint;

  if (usePathStyle) {
    const base = (config.endpoint || "").replace(/\/+$/, "");
    return {
      url: `${base}/${config.bucket}/${encodedKey}`,
      host: new URL(`${base}/`).host,
      canonicalUri: `/${config.bucket}/${encodedKey}`,
      region,
    };
  }

  const host = `${config.bucket}.s3.${region}.amazonaws.com`;
  return {
    url: `https://${host}/${encodedKey}`,
    host,
    canonicalUri: `/${encodedKey}`,
    region,
  };
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : (data as BufferSource);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function amzDate(now: Date): { full: string; short: string } {
  const iso = now.toISOString().replace(/[-:]/g, "").split(".")[0];
  return { full: iso + "Z", short: iso.slice(0, 8) };
}

function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function sha256HexAsync(data: string): Promise<string> {
  return sha256Hex(data);
}

async function signV4(
  config: S3Config,
  region: string,
  shortDate: string,
  stringToSign: string
): Promise<string> {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + config.secretAccessKey), shortDate);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = await hmac(kSigning, stringToSign);
  return Array.from(signature)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface PutObjectResult {
  url: string;
  key: string;
}

export async function putObject(
  config: S3Config,
  key: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<PutObjectResult> {
  const target = buildTarget(config, key);
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const payloadHash = await sha256Hex(bytes);
  const amz = amzDate(new Date());
  const { authorization } = await buildSignatureAsync(
    config,
    target,
    "PUT",
    payloadHash,
    amz,
    { "content-type": contentType }
  );

  const headers: Record<string, string> = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz.full,
    "content-type": contentType,
    authorization,
  };

  const res = await fetch(target.url, {
    method: "PUT",
    headers,
    body: bytes as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 PUT failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return { url: target.url, key };
}

export interface GetObjectResult {
  body: ArrayBuffer;
  contentType: string;
  status: number;
}

export async function getObject(config: S3Config, key: string): Promise<GetObjectResult> {
  const target = buildTarget(config, key);
  const payloadHash = await sha256Hex("");
  const amz = amzDate(new Date());
  const { authorization } = await buildSignatureAsync(config, target, "GET", payloadHash, amz);

  const headers: Record<string, string> = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz.full,
    authorization,
  };

  const res = await fetch(target.url, { method: "GET", headers });
  const buffer = await res.arrayBuffer();
  return {
    body: buffer,
    contentType: res.headers.get("content-type") || "application/octet-stream",
    status: res.status,
  };
}

export async function getPresignedUrl(
  config: S3Config,
  key: string,
  method: "GET" | "PUT" = "GET",
  expiresSeconds = 900
): Promise<string> {
  const target = buildTarget(config, key);
  const region = target.region;
  const amz = amzDate(new Date());
  const payloadHash = "UNSIGNED-PAYLOAD";

  const credential = `${config.accessKeyId}/${amz.short}/${region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amz.full,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  if (method === "PUT") {
    query["X-Amz-Content-Sha256"] = payloadHash;
  }

  // Canonical request uses UNSIGNED-PAYLOAD for presigned URLs.
  const canonicalHeaders = `host:${target.host}\n`;
  const signedHeaders = "host";
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
  const canonicalRequest = [
    method,
    target.canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${amz.short}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz.full,
    scope,
    await sha256HexAsync(canonicalRequest),
  ].join("\n");

  const signature = await signV4(config, region, amz.short, stringToSign);

  query["X-Amz-Signature"] = signature;
  const finalQuery = Object.keys(query)
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");

  return `${target.url}?${finalQuery}`;
}

// Async wrapper around buildSignature so callers can await the hashing.
async function buildSignatureAsync(
  config: S3Config,
  target: Target,
  method: string,
  payloadHash: string,
  amz: { full: string; short: string },
  extraHeaders: Record<string, string> = {}
): Promise<{ authorization: string; signedHeaders: string }> {
  const region = target.region;
  const headers: Record<string, string> = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz.full,
    ...extraHeaders,
  };

  const headerKeys = Object.keys(headers).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${headers[k].trim()}\n`).join("");
  const signedHeaders = headerKeys.join(";");

  const canonicalRequest = [
    method,
    target.canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${amz.short}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz.full,
    scope,
    await sha256HexAsync(canonicalRequest),
  ].join("\n");

  const signature = await signV4(config, region, amz.short, stringToSign);
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
  };
}

export function getS3Config(bindings: Record<string, any>): S3Config | null {
  const bucket = bindings.S3_BUCKET || "uploads";
  const accessKeyId = bindings.S3_ACCESS_KEY_ID;
  const secretAccessKey = bindings.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region: bindings.S3_REGION || "auto",
    accessKeyId,
    secretAccessKey,
    endpoint: bindings.S3_ENDPOINT,
    pathStyle: !!bindings.S3_ENDPOINT,
  };
}
