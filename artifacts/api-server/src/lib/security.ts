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
