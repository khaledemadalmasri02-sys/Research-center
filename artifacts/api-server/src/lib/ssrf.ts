import dns from "node:dns";
import { isIP } from "node:net";

// ---- Private / internal address detection (SSRF defense) -------------------

function ipToLong(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let long = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    long = long * 256 + n;
  }
  return long >>> 0;
}

function inRange(ipLong: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const baseLong = ipToLong(base);
  if (baseLong === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

// IPv4 + IPv6 private/loopback/link-local ranges that must never be fetched.
const PRIVATE_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  if (ip.startsWith("::")) return true; // treat all IPv6 as internal unless explicitly allowed
  if (isIP(ip) !== 4) return false;
  const long = ipToLong(ip);
  if (long === null) return false;
  return PRIVATE_CIDRS.some((c) => inRange(long, c));
}

// Resolves the hostname and blocks any resulting private/internal address.
// Fails closed: resolution errors are treated as blocked.
export async function isBlockedHost(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    return addresses.some((a) => isPrivateIp(a.address));
  } catch {
    return true;
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  maxBytes?: number;
  // Only responses whose Content-Type starts with one of these are accepted.
  allowedContentTypes?: string[];
  // Extra hostnames that are explicitly forbidden (e.g. internal hostnames).
  blockedHostnames?: string[];
}

/**
 * fetch() hardened against SSRF:
 *  - only http/https
 *  - hostname must not resolve to a private/internal address
 *  - redirects are disabled (a redirect could pivot to an internal address)
 *  - optional content-type and response-size limits
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }
  if (opts.blockedHostnames?.includes(parsed.hostname)) {
    throw new Error("Blocked host");
  }
  if (await isBlockedHost(parsed.hostname)) {
    throw new Error("Blocked host");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: controller.signal,
    });

    // Block redirect-based SSRF pivots.
    if (res.status >= 300 && res.status < 400) {
      throw new Error("Redirects are not allowed");
    }
    if (!res.ok) {
      throw new Error(`Upstream responded ${res.status}`);
    }

    const len = Number(res.headers.get("content-length") ?? 0);
    if (opts.maxBytes && len > opts.maxBytes) {
      throw new Error("Response too large");
    }

    if (opts.allowedContentTypes?.length) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!opts.allowedContentTypes.some((p) => ct.startsWith(p))) {
        throw new Error(`Unsupported content type: ${ct}`);
      }
    }

    return res;
  } finally {
    clearTimeout(timer);
  }
}
