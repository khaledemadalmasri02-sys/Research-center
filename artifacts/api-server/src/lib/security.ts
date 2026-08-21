import bcrypt from "bcryptjs";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function isValidPassword(pw: string): { ok: boolean; reason?: string } {
  if (!pw || pw.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters." };
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return { ok: false, reason: "Password must include both letters and numbers." };
  }
  return { ok: true };
}

// Lightweight in-memory sliding-window rate limiter (per key, e.g. IP or username).
const buckets = new Map<string, { count: number; resetAt: number }>();

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
