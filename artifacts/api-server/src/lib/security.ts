import bcrypt from "bcryptjs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "crypto";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

// ---- OTP hashing ------------------------------------------------------------
// A 6-digit OTP is ~20 bits of entropy, lives for 10 minutes, and is tried at
// most 5 times. Running a full cost-12 bcryptjs (pure-JS, synchronous on the
// event loop) over it blocked the whole process for hundreds of ms per OTP
// and bought nothing: a KDF exists to slow brute force of *low*-entropy
// secrets, and this value is both high-entropy and rate-limited.
//
// We store `sha256$<salt>$<mac>` where:
//   - salt is 16 random bytes generated per OTP (stored in the hash string so
//     no schema change / extra column is needed),
//   - mac is HMAC-SHA256(salt + code) keyed with a server-side secret, so a
//     leaked database dump alone cannot be brute-forced offline.
//
// Passwords keep using bcrypt — only OTPs use this. The
// constant-time-compare-against-DUMMY_HASH anti-enumeration trick in
// routes/auth.ts is unchanged.
const OTP_HASH_SCHEME = "sha256";

/**
 * Server-side key for OTP HMACs. Defaults to SESSION_SECRET (already
 * mandatory in production — app.ts refuses to boot without it) and can be
 * overridden with OTP_HASH_SECRET so the two lifecycles can be rotated
 * independently.
 */
function otpHashKey(): string {
  return (
    process.env.OTP_HASH_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-secret-change-me"
  );
}

/**
 * The shared `sha256$<salt>$<HMAC>` construction, factored out so the OTP, the
 * password-reset token and the MFA recovery codes all use byte-identical
 * encoding with independent keys.
 *
 * `saltedHmac(value, key)` -> `"sha256$<16 random bytes hex>$<HMAC-SHA256(key,
 * "<salt>:<value>") hex>"`. `verifySaltedHmac` is its constant-time inverse and
 * fails closed on anything that is not one of ours (e.g. a legacy bcrypt hash).
 */
function saltedHmac(value: string, key: string): string {
  const salt = randomBytes(16).toString("hex");
  const mac = createHmac("sha256", key).update(`${salt}:${value}`).digest("hex");
  return `${OTP_HASH_SCHEME}$${salt}$${mac}`;
}

function verifySaltedHmac(value: string, stored: string, key: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== OTP_HASH_SCHEME) {
    // Not one of ours (e.g. a legacy bcrypt hash from before the fix).
    // Fail closed rather than treating it as a match.
    return false;
  }
  const [, salt, expected] = parts as [string, string, string];
  const actual = createHmac("sha256", key).update(`${salt}:${value}`).digest("hex");
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Hash an OTP for storage in `users.otp_code_hash` / `signup_requests.otp_code_hash`. */
export function hashOtp(code: string): string {
  return saltedHmac(code, otpHashKey());
}

/** Constant-time verification of an OTP against a stored `hashOtp` value. */
export function verifyOtp(code: string, stored: string): boolean {
  return verifySaltedHmac(code, stored, otpHashKey());
}

// ---- Password-reset tokens --------------------------------------------------
// Same construction as the OTP (a per-value random salt plus an HMAC under a
// server-side key, so a leaked dump alone is not enough to check a guess), with
// its OWN key so the reset-token lifecycle can be rotated independently of the
// OTP one.
//
// Two hashes are stored per token (see schema/users.ts):
//   * `token_hash`   — the salted HMAC above. Never leaves the server.
//   * `lookup_hash`  — plain SHA-256, used ONLY to find the row for an incoming
//                      token, exactly like `hashLoginToken` does for
//                      login_challenges. It is not a KDF and is not expected to
//                      resist offline guessing; the token is 256 bits of CSPRNG
//                      output, so there is nothing to guess, and the row is
//                      useless without also matching `token_hash`.
export function generateResetToken(): string {
  // 32 bytes = 256 bits, hex-encoded. Never Math.random().
  return randomBytes(32).toString("hex");
}

function resetTokenHashKey(): string {
  return (
    process.env.RESET_TOKEN_HASH_SECRET ||
    process.env.OTP_HASH_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-secret-change-me"
  );
}

export function hashResetToken(token: string): string {
  return saltedHmac(token, resetTokenHashKey());
}

/** Deterministic row-lookup hash for a reset token (see above). */
export function resetTokenLookupHash(token: string): string {
  return createHash("sha256").update(`reset:${token}`).digest("hex");
}

export function verifyResetToken(token: string, stored: string): boolean {
  return verifySaltedHmac(token, stored, resetTokenHashKey());
}

// ---- Base32 (RFC 4648) ------------------------------------------------------
// Needed for TOTP: RFC 6238 secrets are distributed as base32 and authenticator
// apps parse the `otpauth://` URI's `secret=` parameter as base32. Alphabet and
// padding follow the RFC; the encoding is hand-rolled because no dependency may
// be added.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---- TOTP (RFC 6238 / RFC 4226) ---------------------------------------------
// HMAC-SHA1, 30-second step, 6 digits, +/-1 step tolerance. Implemented with
// `node:crypto` only: `otplib`/`speakeasy` may not be added, and the algorithm is
// small enough that a dependency would be a net loss (it is also the only
// authentication primitive in this codebase with no second implementation to
// cross-check against, so the tests below pin RFC 6238's published vectors).
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
/**
 * +/-1 step of tolerance. This absorbs clock skew between the server and a
 * phone; it also means one code is valid across up to three consecutive steps,
 * which is why the accepted step is CLAIMED atomically in the database before
 * the session is granted (see `totp_last_used_step`) — otherwise the same code
 * could be replayed for another 30-90 seconds.
 */
export const TOTP_WINDOW = 1;

/** 160-bit secret, base32-encoded, as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code for one specific counter value. */
export function totpCodeAtStep(
  secretBase32: string,
  step: number,
  digits: number = TOTP_DIGITS,
): string | null {
  const key = base32Decode(secretBase32);
  if (!key || key.length === 0 || !Number.isInteger(step) || step < 0) return null;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  // RFC 4226 §5.3 dynamic truncation.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export interface TotpVerifyResult {
  ok: boolean;
  /** The counter value whose code matched. Claim it to stop a replay. */
  step: number | null;
}

export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { window?: number; atMs?: number; digits?: number; periodSec?: number } = {},
): TotpVerifyResult {
  const digits = opts.digits ?? TOTP_DIGITS;
  const periodSec = opts.periodSec ?? TOTP_PERIOD_SEC;
  const window = opts.window ?? TOTP_WINDOW;
  if (!/^\d+$/.test(code) || code.length !== digits) return { ok: false, step: null };
  const nowMs = opts.atMs ?? Date.now();
  const current = Math.floor(nowMs / 1000 / periodSec);
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;
    if (totpCodeAtStep(secretBase32, step, digits) === code) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: null };
}

// ---- Encryption at rest for the TOTP shared secret --------------------------
// The codebase has no KMS/HSM, so the secret is sealed with AES-256-GCM under an
// application-level key from `MFA_ENCRYPTION_KEY`.
//
// LIMITATION (documented deliberately, not an oversight): this is symmetric
// application-level encryption, so anyone who can read BOTH the env var and the
// database can recover a TOTP secret. It protects the database dump / backup
// exfiltration case, which is the realistic one for a Postgres `text` column. A
// real KMS (envelope encryption with a per-user DEK) is the only way to get
// past an application-key compromise too, and there is no KMS here.
//
// When `MFA_ENCRYPTION_KEY` is unset the key is derived from `SESSION_SECRET`
// with scrypt so dev and tests work; that is strictly weaker because rotating
// `SESSION_SECRET` then also invalidates every enrolled TOTP secret. Set
// `MFA_ENCRYPTION_KEY` in production.
const MFA_SECRET_CIPHER_VERSION = "v1";
let cachedMfaKey: { source: string; key: Buffer } | null = null;

function mfaEncryptionKey(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY?.trim();
  const source = configured || `fallback:${process.env.SESSION_SECRET ?? "dev-secret-change-me"}`;
  if (cachedMfaKey && cachedMfaKey.source === source) return cachedMfaKey.key;

  let key: Buffer;
  if (configured) {
    if (/^[0-9a-f]{64}$/i.test(configured)) {
      key = Buffer.from(configured, "hex");
    } else {
      const decoded = Buffer.from(configured, "base64");
      key = decoded.length === 32 ? decoded : scryptSync(configured, "mfa-secret-v1", 32);
    }
    if (key.length !== 32) key = scryptSync(configured, "mfa-secret-v1", 32);
  } else {
    key = scryptSync(source.slice("fallback:".length), "mfa-secret-v1", 32);
  }
  cachedMfaKey = { source, key };
  return key;
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    MFA_SECRET_CIPHER_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/** Returns null on any tamper/truncation — never throws at the call site. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== MFA_SECRET_CIPHER_VERSION) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      mfaEncryptionKey(),
      Buffer.from(parts[1]!, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ---- MFA recovery codes -----------------------------------------------------
// 8 single-use codes, shown exactly once at enrolment/regeneration and stored
// only as `sha256$<salt>$<HMAC>` (same construction as the OTP). They are the
// only way back into an account whose phone is lost, so they must survive a
// database dump being useless on its own.
//
// Alphabet omits I, O, 0 and 1 so the codes survive being read aloud or copied
// off a printout.
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MFA_RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_GROUPS = 2;
const RECOVERY_CODE_GROUP_LEN = 5;

export function generateRecoveryCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LEN; i++) {
    chars.push(RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]!);
  }
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_CODE_GROUPS; g++) {
    groups.push(chars.slice(g * RECOVERY_CODE_GROUP_LEN, (g + 1) * RECOVERY_CODE_GROUP_LEN).join(""));
  }
  return groups.join("-");
}

/**
 * Canonical form of a recovery code: uppercase, separators removed. This is
 * what gets hashed, so "abcde-fghij", "ABCDE FGHIJ" and "ABCDEFGHIJ" are the
 * same code and a typo in the separator does not lock a user out.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return saltedHmac(normalizeRecoveryCode(code), otpHashKey());
}

export function verifyRecoveryCode(code: string, stored: string): boolean {
  return verifySaltedHmac(normalizeRecoveryCode(code), stored, otpHashKey());
}

/** True when the input looks like a recovery code rather than a TOTP code. */
export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LEN;
}

// ---- Opaque session reference ------------------------------------------------
// `GET /sessions` must let a user act on "this device" without handing back the
// session id, which IS the bearer credential for that session (`rc_sid` is
// signed by express-session, but the sid itself is what the store is keyed on
// and what `DELETE /sessions/:sid` accepted).
//
// So a session is addressed by a truncated HMAC of its sid under a server-side
// key: non-reversible (the key is not in the database), not usable as a cookie,
// and cheap to recompute server-side. 16 hex chars = 64 bits, far more than
// enough to distinguish a handful of sessions and impossible to brute-force
// without the key.
function sessionRefKey(): string {
  return (
    process.env.SESSION_REF_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-secret-change-me"
  );
}

export function sessionRef(sid: string): string {
  return createHmac("sha256", sessionRefKey())
    .update(`session-ref:${sid}`)
    .digest("hex")
    .slice(0, 16);
}

/** Constant-time comparison of a supplied ref against the ref for `sid`. */
export function sessionRefMatches(sid: string, ref: string): boolean {
  const expected = Buffer.from(sessionRef(sid), "utf8");
  const actual = Buffer.from(ref, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
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
 * Client IP for rate-limiting and lockouts.
 *
 * `X-Forwarded-For` is attacker-controlled unless the immediate peer is a
 * proxy we control. This server is also directly reachable at
 * api.research-center.fit, so trusting XFF unconditionally let anyone reset
 * every per-IP budget (login 10/15min, signup, OTP send, presign 60/15min,
 * upload 30/15min) by sending a fresh header. We therefore only honour XFF
 * when `req.socket.remoteAddress` is inside `TRUSTED_PROXY_CIDRS`
 * (comma-separated CIDRs / bare IPs); otherwise the socket address wins.
 *
 * Example for the Cloudflare-fronted deployment:
 *   TRUSTED_PROXY_CIDRS=173.245.48.0/20,103.21.244.0/22,2400:cb00::/32
 *
 * Leave it unset (the default) to ignore XFF completely — correct for direct
 * exposure, and fail-closed if the proxy ranges are ever missing.
 *
 * The `test-client` fallback keeps supertest's 127.0.0.1 socket address from
 * collapsing every test request into one shared bucket.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const peer = req.socket?.remoteAddress;
  if (isTrustedProxy(peer)) {
    const xff = req.headers["x-forwarded-for"];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (typeof first === "string" && first.trim()) {
      const candidate = first.split(",")[0]!.trim();
      if (isValidIp(candidate)) return candidate;
    }
  }
  if (peer && peer !== "127.0.0.1" && peer !== "::1") return normalizeIp(peer);
  if (req.ip && req.ip !== "127.0.0.1" && req.ip !== "::1") return normalizeIp(req.ip);
  return "test-client";
}

/** Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4) to its IPv4 form. */
function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1]! : ip;
}

function isValidIp(ip: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.includes(":");
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Expand an IPv6 literal (including `::` compression) to 16 bytes, or null. */
function ipv6ToBytes(ip: string): Buffer | null {
  let addr = ip.trim();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  if (!addr.includes(":")) return null;

  const doubleColon = addr.indexOf("::");
  let head: string[];
  let tail: string[];
  if (doubleColon === -1) {
    head = addr.split(":");
    tail = [];
    if (head.length !== 8) return null;
  } else {
    if (addr.indexOf("::", doubleColon + 1) !== -1) return null;
    head = addr.slice(0, doubleColon).split(":").filter(Boolean);
    tail = addr.slice(doubleColon + 2).split(":").filter(Boolean);
    if (head.length + tail.length > 7) return null;
  }

  const groups: number[] = [];
  const push = (part: string): boolean => {
    if (part === "") return true;
    if (part.includes(".")) {
      const v4 = ipv4ToInt(part);
      if (v4 === null) return false;
      groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return false;
    groups.push(Number.parseInt(part, 16));
    return true;
  };

  for (const part of head) if (!push(part)) return null;
  const zeros = 8 - (head.length + tail.length);
  if (doubleColon !== -1) for (let i = 0; i < zeros; i++) groups.push(0);
  for (const part of tail) if (!push(part)) return null;
  if (groups.length !== 8) return null;

  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(g, i * 2));
  return out;
}

/**
 * CIDR match for IPv4 and IPv6. Intentionally minimal and dependency-free:
 * it only has to answer "is the immediate peer one of our proxies", and it
 * fails closed on anything it cannot parse.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const base = (slash === -1 ? cidr : cidr.slice(0, slash)).trim();
  const bitsStr = slash === -1 ? null : cidr.slice(slash + 1).trim();
  const bits = bitsStr === null ? null : Number.parseInt(bitsStr, 10);

  if (base.includes(":")) {
    if (bits !== null && (!Number.isInteger(bits) || bits < 0 || bits > 128)) return false;
    const prefix = bits ?? 128;
    const ipBytes = ipv6ToBytes(ip);
    const baseBytes = ipv6ToBytes(base);
    if (!ipBytes || !baseBytes) return false;
    return buffersSharePrefix(ipBytes, baseBytes, Math.ceil(prefix / 8));
  }

  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (bits !== null && (!Number.isInteger(bits) || bits < 0 || bits > 32)) return false;
  const prefix = bits ?? 32;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True when the first `byteCount` bytes of both buffers are identical. */
function buffersSharePrefix(a: Buffer, b: Buffer, byteCount: number): boolean {
  if (byteCount <= 0) return true;
  return a.subarray(0, byteCount).equals(b.subarray(0, byteCount));
}

function trustedProxyCidrs(): string[] {
  return (process.env.TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function isTrustedProxy(peer: string | undefined): boolean {
  if (!peer) return false;
  const cidrs = trustedProxyCidrs();
  if (cidrs.length === 0) return false;
  const normalized = normalizeIp(peer);
  return cidrs.some((c) => ipInCidr(normalized, c));
}
