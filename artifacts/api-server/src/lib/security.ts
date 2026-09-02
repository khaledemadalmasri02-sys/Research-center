import bcrypt from "bcryptjs";
import { createHash } from "crypto";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// Deterministic hash for login-challenge tokens. The token is 256 bits of
// randomness (randomBytes(32).toString("hex")), so it doesn't need bcrypt's
// password-stretching — but it MUST be deterministic because we look the
// challenge up by this hash. bcrypt is non-deterministic (random salt per
// call), which previously made the login_challenges lookup unreachable and
// broke login 2FA.
export function hashLoginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidPassword(pw: string): { ok: boolean; reason?: string } {
  if (!pw || pw.length < 12) {
    return { ok: false, reason: "Password must be at least 12 characters." };
  }
  if (
    !/[a-z]/.test(pw) ||
    !/[A-Z]/.test(pw) ||
    !/[0-9]/.test(pw) ||
    !/[^A-Za-z0-9]/.test(pw)
  ) {
    return {
      ok: false,
      reason: "Password must include lowercase, uppercase, a number, and a symbol.",
    };
  }
  return { ok: true };
}

// Lightweight in-memory sliding-window rate limiter (per key, e.g. IP or username).
const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodically evict expired buckets so the Map cannot grow without bound.
const rateLimitPrune = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
  // Safety net against memory exhaustion from many distinct keys.
  if (buckets.size > 100_000) buckets.clear();
}, 60_000);
rateLimitPrune.unref?.();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { success: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return { success: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  return { success: true, retryAfterSec: 0 };
}

/** Test-only: clear the in-memory rate-limit buckets. */
export function __resetRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort client IP for rate-limiting. Honours `X-Forwarded-For` (the
 * Worker sets it on every proxied request), falls back to the socket
 * address, and treats the placeholder `127.0.0.1` returned by supertest
 * as `test-client` so a per-IP bucket in tests doesn't accidentally span
 * every request.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    return xff.split(",")[0]!.trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(",")[0]!.trim();
  }
  const sock = req.socket?.remoteAddress;
  if (sock && sock !== "127.0.0.1" && sock !== "::1") return sock;
  if (req.ip && req.ip !== "127.0.0.1" && req.ip !== "::1") return req.ip;
  return "test-client";
}
