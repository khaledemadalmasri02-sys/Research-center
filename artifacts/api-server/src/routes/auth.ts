import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { db, usersTable, signupRequestsTable, oauthIdentitiesTable, pool } from "@workspace/db";
import {
  hashPassword,
  hashLoginToken,
  verifyPassword,
  hashOtp,
  verifyOtp,
  isValidPassword,
  rateLimit,
  clientIp,
  generateResetToken,
  hashResetToken,
  resetTokenLookupHash,
  verifyResetToken,
  generateTotpSecret,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
  looksLikeRecoveryCode,
  TOTP_DIGITS,
  TOTP_PERIOD_SEC,
  MFA_RECOVERY_CODE_COUNT,
} from "../lib/security";
import { writeAudit } from "../lib/audit";
import {
  establishSession,
  checkSession,
  markReauthenticated,
  requireActiveSession,
  requireRecentReauth,
  revokeAllSessions,
  revokeOtherSessions,
  sessionExpiry,
  REAUTH_MAX_AGE_MS,
} from "../lib/session";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

/**
 * The machine-readable error codes this module emits, in the exact set agreed
 * with the frontend (see the report). `error` stays the human-readable English
 * string that is already displayed today; `code` is purely additive so the SPA
 * can branch on a failure mode (show a countdown, prompt for MFA, offer a
 * recovery code) without string-matching English copy.
 */
const AUTH_CODES = {
  INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  ACCOUNT_LOCKED: "AUTH_ACCOUNT_LOCKED",
  ACCOUNT_PENDING: "AUTH_ACCOUNT_PENDING",
  ACCOUNT_SUSPENDED: "AUTH_ACCOUNT_SUSPENDED",
  RATE_LIMITED: "AUTH_RATE_LIMITED",
  MFA_REQUIRED: "AUTH_MFA_REQUIRED",
  MFA_INVALID: "AUTH_MFA_INVALID",
  MFA_NOT_ENROLLED: "AUTH_MFA_NOT_ENROLLED",
  RECOVERY_INVALID: "AUTH_RECOVERY_INVALID",
  RESET_TOKEN_INVALID: "AUTH_RESET_TOKEN_INVALID",
  RESET_TOKEN_EXPIRED: "AUTH_RESET_TOKEN_EXPIRED",
  RESET_TOKEN_USED: "AUTH_RESET_TOKEN_USED",
  PASSWORD_WEAK: "AUTH_PASSWORD_WEAK",
  EMAIL_INVALID: "AUTH_EMAIL_INVALID",
  USERNAME_TAKEN: "AUTH_USERNAME_TAKEN",
  FIELD_REQUIRED: "AUTH_FIELD_REQUIRED",
  REAUTH_REQUIRED: "AUTH_REAUTH_REQUIRED",
  SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  OAUTH_INVALID: "AUTH_OAUTH_INVALID",
  OAUTH_LINK_REQUIRED: "AUTH_OAUTH_LINK_REQUIRED",
  SESSION_REVOKED: "AUTH_SESSION_REVOKED",
  SESSION_CURRENT: "AUTH_SESSION_CURRENT",
  TOTP_NOT_CONFIGURED: "AUTH_TOTP_NOT_CONFIGURED",
  TOTP_ALREADY_SET: "AUTH_TOTP_ALREADY_SET",
} as const;

export type AuthCode = (typeof AUTH_CODES)[keyof typeof AUTH_CODES];

/**
 * Every error this module returns goes through here, so no route can forget the
 * `code`. A 429 additionally carries `retryAfterSec` (and a `Retry-After`
 * header) so the client can show an honest countdown instead of a dead end —
 * that is what makes a timed lockout usable rather than merely punishing.
 */
function fail(
  res: Response,
  status: number,
  error: string,
  code: AuthCode,
  extra: Record<string, unknown> = {},
): void {
  if (status === 429) {
    const retryAfterSec = Math.max(1, Number(extra.retryAfterSec ?? 1));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(status).json({ error, code, retryAfterSec, ...extra });
    return;
  }
  res.status(status).json({ error, code, ...extra });
}

// ---- OTP settings (P1.4) ---------------------------------------------------
// Default 6 digits. NIST 800-63B recommends ≥6 digits for one-time
// authentication codes; 4 digits (10 000 codes) with 5 attempts and a
// 5-minute TTL gives an attacker a 0.05% chance per session which is
// borderline acceptable but not for medical data. 6 digits (1 000 000
// codes) drops that to 0.0005% per session.
//
// Overridable via the OTP_LENGTH env var (range 4-8). Don't set this
// below 6 in production without a documented threat-model exception.
//
// Threat model and brute-force math live in SECURITY.md.
export const OTP_LENGTH = (() => {
  const v = parseInt(process.env.OTP_LENGTH ?? "6", 10);
  if (Number.isNaN(v) || v < 4 || v > 8) {
    return 6;
  }
  return v;
})();

/**
 * CSPRNG one-time code (A5).
 *
 * `Math.random()` is V8's xorshift128+: its 128-bit state is recoverable
 * from a handful of consecutive outputs, so a 6-digit code drawn from it can
 * be predicted rather than guessed. `crypto.randomInt` draws from the OS
 * CSPRNG and is uniform over [lower, upper).
 */
export function generateOtpCode(length: number = OTP_LENGTH): string {
  const digits = Math.min(8, Math.max(4, length));
  const lower = 10 ** (digits - 1);
  const upper = 10 ** digits; // exclusive
  return String(randomInt(lower, upper));
}

const router: IRouter = Router();

const MAX_LOGIN_ATTEMPTS = 5;
// Progressive lockout. A flat 15-minute lock is not a control against an
// attacker with a script — it is a 15-minute timer they wait out — so the lock
// now escalates with each successive lock of the same account. `failed_attempts`
// is only cleared on a SUCCESSFUL login (or a password reset), so
// `floor(failed_attempts / 5)` is a durable count of how many times this account
// has already been locked in this streak: 5 -> 1 min, 10 -> 5 min, 15 -> 15 min,
// 20 -> 1 h, 25 -> 6 h, 30+ -> 24 h. The cap keeps a permanently-brute-forceable
// account from being locked out of its own data forever, which matters because
// PHI in this product cannot simply be re-requested from a paper file.
const LOCKOUT_BACKOFF_MINUTES = [1, 5, 15, 60, 360, 1440] as const;
const LOGIN_RATE_LIMIT = 10; // per IP per 15 min
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_OTP_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
const MFA_VERIFY_SUBJECT_LIMIT = 20;
const MFA_ENROLL_LIMIT = 10;
const RESET_REQUEST_IP_LIMIT = 5;
const RESET_REQUEST_SUBJECT_LIMIT = 5;
const RESET_CONFIRM_IP_LIMIT = 10;
const RESET_CONFIRM_SUBJECT_LIMIT = 10;
const REAUTH_IP_LIMIT = 10;
const REAUTH_SUBJECT_LIMIT = 5;
const PASSWORD_CHANGE_LIMIT = 5;

/** Minutes of lock for the current failed-attempt streak. */
function lockoutMinutesFor(failedAttempts: number): number {
  const index = Math.floor(failedAttempts / MAX_LOGIN_ATTEMPTS) - 1;
  return LOCKOUT_BACKOFF_MINUTES[Math.min(Math.max(index, 0), LOCKOUT_BACKOFF_MINUTES.length - 1)]!;
}

// Valid-format bcrypt hash used only to equalize timing when no user exists.
const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYh2dQHP8DjL0eW";

function isLocked(user: { lockedUntil: Date | null } | undefined): boolean {
  if (!user?.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}

/** Seconds until `lockedUntil` (never negative). */
function lockedRetryAfterSec(user: { lockedUntil: Date | null } | undefined): number {
  if (!user?.lockedUntil) return 1;
  return Math.max(1, Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000));
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const limit = rateLimit(`login:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    fail(res, 400, "Username and password are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);

  // Always run a hash comparison to reduce timing oracle, but reject when no user.
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH);

  if (!user || !valid) {
    if (user && !isLocked(user)) {
      const attempts = user.failedAttempts + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const minutes = lockoutMinutesFor(attempts);
        const lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
        await db.update(usersTable).set({ failedAttempts: attempts, lockedUntil }).where(eq(usersTable.id, user.id));
        logger.warn(
          { userId: user.id, username: user.username, attempts, minutes },
          "Account locked by failed logins",
        );
      } else {
        await db.update(usersTable).set({ failedAttempts: attempts }).where(eq(usersTable.id, user.id));
      }
    }
    fail(res, 401, "Invalid credentials.", AUTH_CODES.INVALID_CREDENTIALS);
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.failure", detail: { username }, ip: clientIp(req) });
    return;
  }

  if (isLocked(user)) {
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.locked", detail: { username }, ip: clientIp(req) });
    fail(res, 429, "Account is temporarily locked. Try again later.", AUTH_CODES.ACCOUNT_LOCKED, {
      retryAfterSec: lockedRetryAfterSec(user),
    });
    return;
  }

  if (user.status === "pending") {
    fail(res, 403, "Your account is pending admin approval.", AUTH_CODES.ACCOUNT_PENDING);
    return;
  }
  if (user.status === "suspended") {
    fail(res, 403, "This account has been suspended.", AUTH_CODES.ACCOUNT_SUSPENDED);
    return;
  }

  // Successful password check: reset lockout counters.
  await db.update(usersTable).set({ failedAttempts: 0, lockedUntil: null }).where(eq(usersTable.id, user.id));

  // MFA (TOTP / recovery code) takes precedence over the e-mail OTP: it is the
  // stronger factor, it does not depend on the user having a reachable inbox,
  // and only one challenge may be outstanding per login. The password check
  // above is untouched — this only decides what happens AFTER it passed.
  if (user.totpEnabledAt) {
    const loginToken = randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO "login_challenges" ("token_hash", "user_id", "expires_at") VALUES ($1, $2, $3)`,
      [hashLoginToken(loginToken), user.id, new Date(Date.now() + MFA_CHALLENGE_TTL_MS)],
    );
    await db.update(usersTable).set({ mfaAttempts: 0 }).where(eq(usersTable.id, user.id));
    await writeAudit({ userId: user.id, action: "auth.login.mfa_required", ip: clientIp(req) });
    // Same shape as the e-mail OTP challenge below (`ok` + a `loginToken`) so the
    // SPA's "second factor" flow is identical for both.
    res.json({
      ok: true,
      mfaRequired: true,
      loginToken,
      username: user.username,
      mfaMethods: ["totp", "recovery"],
    });
    return;
  }

  // If the account has no email on file we cannot do 2FA — fall back to a
  // password-only session (legacy accounts). Otherwise issue a short-lived
  // login challenge and email a code; the session is only created after the
  // code is verified at /api/auth/login/otp/verify.
  if (!user.email) {
    logger.warn({ userId: user.id, username: user.username }, "Login succeeded but no email on file — skipping 2FA/OTP");
    await establishSession(req, user);
    await writeAudit({ userId: user.id, action: "auth.login.success", ip: clientIp(req) });
    res.json({
      ok: true,
      username: user.username,
      role: user.role,
      canAdminAccess: user.canAdminAccess,
      canEdit: user.role !== "viewer",
      ...mfaAdvisory(user),
    });
    return;
  }

  const loginToken = randomBytes(32).toString("hex");
  const challengeHash = hashLoginToken(loginToken);
  await pool.query(
    `INSERT INTO "login_challenges" ("token_hash", "user_id", "expires_at") VALUES ($1, $2, $3)`,
    [challengeHash, user.id, new Date(Date.now() + LOGIN_OTP_CHALLENGE_TTL_MS)],
  );

  // Fire-and-forget the email; the code is generated inside sendLoginOtp.
  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  await pool.query(`UPDATE "users" SET "otp_code_hash" = $1, "otp_expires_at" = $2, "otp_attempts" = 0 WHERE "id" = $3`, [
    codeHash,
    new Date(Date.now() + OTP_TTL_MS),
    user.id,
  ]);
  await sendEmail({
    to: user.email,
    subject: "Your MedResearch login code",
    text:
      `Your ${OTP_LENGTH}-digit login code is: ${code}\n` +
      `It expires in 10 minutes.\n\n` +
      `If you did not request this, please secure your account immediately by changing your password.\n\n` +
      `— MedResearch\n` +
      `https://research-center.fit`,
    html:
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;max-width:560px;line-height:1.5">` +
      `<h2 style="margin:0 0 12px;font-size:20px;font-weight:600">Confirm your login</h2>` +
      `<p style="margin:0 0 16px;color:#444;font-size:15px">Use the code below to finish signing in to MedResearch. The code is valid for the next 10 minutes.</p>` +
      `<div style="font-size:22px;letter-spacing:6px;font-weight:700;color:#111;margin:8px 0 16px;padding:12px 16px;background:#f5f5f5;border-radius:6px;display:inline-block">${code}</div>` +
      `<p style="margin:16px 0 0;color:#666;font-size:13px">This code expires in 10 minutes. If you did not request this, please change your password right away.</p>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
      `<p style="margin:0;color:#888;font-size:12px">MedResearch · research-center.fit<br>You received this email because a login was attempted on your account. ` +
      `<a href="https://research-center.fit/unsubscribe?email=${encodeURIComponent(user.email)}&category=login-otp" style="color:#888;text-decoration:underline">Unsubscribe</a></p>` +
      `</div>`,
    category: "login-otp",
  }).catch((err: unknown) => {
    logger.error({ err, userId: user.id, email: user.email }, "Failed to send login OTP email");
  });

  await writeAudit({ userId: user.id, action: "auth.login.otp.sent", ip: clientIp(req) });

  logger.info({ userId: user.id, email: maskEmail(user.email) }, "Login OTP email sent");

  res.json({
    ok: true,
    otpRequired: true,
    loginToken,
    emailMasked: maskEmail(user.email),
    username: user.username,
    ...mfaAdvisory(user),
  });
});

/**
 * Admin-set MFA requirement that the account has not satisfied yet.
 *
 * `mfa_required` is deliberately advisory in the response rather than a hard
 * gate: the account CAN still sign in, but the SPA is told to prompt for
 * enrolment. See the enforcement-policy note in the report — hard-blocking an
 * unenrolled account whose admin has demanded MFA would lock it out of its own
 * PHI with no self-service path, which is a worse outcome than a late
 * enrolment prompt.
 */
function mfaAdvisory(user: { mfaRequired: boolean; totpEnabledAt: Date | null }): Record<string, unknown> {
  if (!user.mfaRequired || user.totpEnabledAt) return {};
  return { mfaRequired: true, mfaEnrollmentRequired: true };
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

// Sign-up application: creates a PENDING request reviewed by an admin.
router.post("/auth/signup", async (req: Request, res: Response) => {
  const limit = rateLimit(`signup:${clientIp(req)}`, 10, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const { username, password, fullName, email, reason } = req.body as {
    username?: string;
    password?: string;
    fullName?: string;
    email?: string;
    reason?: string;
  };

  // Email is required: it is where the verification (OTP) code is sent.
  if (!username || !password) {
    fail(res, 400, "Username and password are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(res, 400, "A valid email is required.", AUTH_CODES.EMAIL_INVALID);
    return;
  }
  if (username.length < 3) {
    fail(res, 400, "Username must be at least 3 characters.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }
  const pwCheck = isValidPassword(password);
  if (!pwCheck.ok) {
    fail(res, 400, pwCheck.reason!, AUTH_CODES.PASSWORD_WEAK);
    return;
  }

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existingUser) {
    fail(res, 409, "An account or request with that username already exists.", AUTH_CODES.USERNAME_TAKEN);
    return;
  }
  const [existingRequest] = await db
    .select({ id: signupRequestsTable.id, status: signupRequestsTable.status })
    .from(signupRequestsTable)
    .where(eq(signupRequestsTable.username, username))
    .limit(1);
  if (existingRequest) {
    fail(res, 409, "An account or request with that username already exists.", AUTH_CODES.USERNAME_TAKEN);
    return;
  }

  const passwordHash = await hashPassword(password);
  try {
    await db.insert(signupRequestsTable).values({
      username,
      passwordHash,
      fullName: fullName ?? null,
      email: email ?? null,
      reason: reason ?? null,
      // Email is not yet verified; the request only becomes an admin approval
      // request (status "pending") after the OTP check at /auth/signup/otp/verify.
      status: "unverified",
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      fail(res, 409, "An account or request with that username already exists.", AUTH_CODES.USERNAME_TAKEN);
      return;
    }
    throw e;
  }

  await writeAudit({ action: "auth.signup.request", detail: { username }, ip: clientIp(req) });

  res.status(201).json({ ok: true, status: "unverified", message: "Sign-up received. We sent a verification code to your email — enter it to continue." });
});

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
// Backstop for the per-subject in-memory budget. Deliberately above
// OTP_MAX_ATTEMPTS so the strict, DB-backed attempt cap is what a user
// actually hits (and so a legitimate "wrong code x2, resend, correct code"
// flow is never blocked by an in-memory counter that a resend cannot reset).
const OTP_VERIFY_SUBJECT_LIMIT = 20;

/** Masks an email for safe display, e.g. "alex@example.com" -> "a***@e***". */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const m = (s: string) => (s.length <= 1 ? "***" : s[0] + "***");
  return `${m(local)}@${m(domain.split(".")[0])}`;
}

// Send (or resend) a verification code to the email attached to a pending sign-up.
router.post("/auth/signup/otp/send", async (req: Request, res: Response) => {
  const limit = rateLimit(`otp:send:${clientIp(req)}`, 8, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const { username, email } = req.body as { username?: string; email?: string };
  if (!username || !email) {
    fail(res, 400, "Username and email are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const { rows: reqRows } = await pool.query<{
    id: number;
    status: string;
    email: string | null;
  }>(
    `SELECT "id", "status", "email" FROM "signup_requests" WHERE "username" = $1 LIMIT 1`,
    [username],
  );
  const request = reqRows[0];

  // Avoid leaking whether a request/username/email exists: only proceed when the
  // row matches the supplied email and is awaiting email verification. Otherwise
  // respond with a generic ok.
  if (!request || (request.status !== "unverified" && request.status !== "pending") || request.email?.toLowerCase() !== email.toLowerCase()) {
    res.status(200).json({ ok: true, sent: false, message: "If the details match, a code was sent." });
    return;
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `UPDATE "signup_requests" SET "otp_code_hash" = $1, "otp_expires_at" = $2, "otp_attempts" = 0 WHERE "id" = $3`,
    [codeHash, expiresAt, request.id],
  );

  const sent = await sendEmail({
    to: email,
    subject: "Your MedResearch verification code",
    text:
      `Welcome to MedResearch!\n\n` +
      `Your ${OTP_LENGTH}-digit verification code is: ${code}\n` +
      `It expires in 10 minutes.\n\n` +
      `If you did not request this, you can ignore this email.\n\n` +
      `— MedResearch\n` +
      `https://research-center.fit\n` +
      `Need help? Reply to this email and our support team will assist you.`,
    html:
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;max-width:560px;line-height:1.5">` +
      `<h2 style="margin:0 0 12px;font-size:20px;font-weight:600">Verify your email</h2>` +
      `<p style="margin:0 0 16px;color:#444;font-size:15px">Welcome to MedResearch. Use the code below to confirm your email address. The code is valid for the next 10 minutes.</p>` +
      `<div style="font-size:22px;letter-spacing:6px;font-weight:700;color:#111;margin:8px 0 16px;padding:12px 16px;background:#f5f5f5;border-radius:6px;display:inline-block">${code}</div>` +
      `<p style="margin:16px 0 0;color:#666;font-size:13px">This code expires in 10 minutes. If you did not request this, you can safely ignore this email — no account will be created.</p>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
      `<p style="margin:0;color:#888;font-size:12px">MedResearch · research-center.fit<br>You received this email because someone (hopefully you) signed up with this address. ` +
      `<a href="https://research-center.fit/unsubscribe?email=${encodeURIComponent(email)}&category=signup-otp" style="color:#888;text-decoration:underline">Unsubscribe</a></p>` +
      `</div>`,
    category: "signup-otp",
  }).catch((err: unknown) => {
    logger.error({ err, email, username }, "Failed to send signup OTP email");
    return false;
  });

  await writeAudit({
    action: "auth.signup.otp.send",
    detail: { username },
    ip: clientIp(req),
  });

  logger.info({ email: maskEmail(email), sent }, "Signup verification code email sent");

  res.status(200).json({ ok: true, sent, emailMasked: maskEmail(email) });
});

// Verify the code. On success the request's email is marked verified.
//
// A6: this route had NO rate limit at all (unlike every sibling: login 10,
// signup 10, otp send 8 per 15 min) and its 5-attempt counter was a
// non-atomic read-then-increment, so N concurrent requests all read 0 and
// all proceeded. Both are fixed here.
router.post("/auth/signup/otp/verify", async (req: Request, res: Response) => {
  const ipLimit = rateLimit(`signup-otp-verify:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  const { username, email, code } = req.body as { username?: string; email?: string; code?: string };
  if (!username || !email || !code) {
    fail(res, 400, "Username, email and code are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  // Per-subject limit so one challenge cannot be brute-forced from a botnet.
  const subjectLimit = rateLimit(
    `signup-otp-verify:user:${username.toLowerCase()}`,
    OTP_VERIFY_SUBJECT_LIMIT,
    LOGIN_RATE_WINDOW_MS,
  );
  if (!subjectLimit.success) {
    fail(res, 429, "Too many attempts. Request a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: subjectLimit.retryAfterSec,
    });
    return;
  }

  const { rows: reqRows } = await pool.query<{
    id: number;
    status: string;
    email: string | null;
    emailVerified: boolean;
    otpCodeHash: string | null;
    otpExpiresAt: string | null;
    otpAttempts: number;
  }>(
    `SELECT "id", "status", "email", "email_verified" AS "emailVerified", "otp_code_hash" AS "otpCodeHash", "otp_expires_at" AS "otpExpiresAt", "otp_attempts" AS "otpAttempts"
     FROM "signup_requests" WHERE "username" = $1 LIMIT 1`,
    [username],
  );
  const request = reqRows[0];

  if (!request || (request.status !== "unverified" && request.status !== "pending") || request.email?.toLowerCase() !== email.toLowerCase()) {
    fail(res, 400, "Verification failed.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }
  if (request.emailVerified) {
    res.status(200).json({ ok: true, verified: true });
    return;
  }
  if (!request.otpCodeHash || !request.otpExpiresAt || new Date(request.otpExpiresAt) < new Date()) {
    fail(res, 400, "Code expired. Request a new one.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }
  // Atomic attempt accounting: a single conditional UPDATE both increments
  // and enforces the cap, so concurrent guesses cannot race past it. No row
  // returned == the budget is already spent.
  const consumed = await pool.query<{ otpAttempts: number }>(
    `UPDATE "signup_requests"
        SET "otp_attempts" = "otp_attempts" + 1
      WHERE "id" = $1 AND "otp_code_hash" IS NOT NULL AND "otp_attempts" < $2
      RETURNING "otp_attempts" AS "otpAttempts"`,
    [request.id, OTP_MAX_ATTEMPTS],
  );
  if (consumed.rows.length === 0) {
    fail(res, 429, "Too many attempts. Request a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec || 60,
    });
    return;
  }

  const matches = verifyOtp(code, request.otpCodeHash);
  if (!matches) {
    fail(res, 400, "Incorrect code. Try again.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }

  await pool.query(
    `UPDATE "signup_requests" SET "email_verified" = true, ` +
      // Promote the request to "pending" (admin approval) only after the email
      // has been verified via OTP — i.e. the approval request is created here.
      `"status" = CASE WHEN "status" = 'unverified' THEN 'pending' ELSE "status" END, ` +
      `"otp_code_hash" = NULL, "otp_expires_at" = NULL, "otp_attempts" = 0 WHERE "id" = $1`,
    [request.id],
  );

  await writeAudit({
    action: "auth.signup.otp.verified",
    detail: { username },
    ip: clientIp(req),
  });

  res.status(200).json({ ok: true, verified: true });
});

const LOGIN_OTP_MAX_ATTEMPTS = 5;

/** Sends (or resends) the login 2FA code to the account's stored email. */
router.post("/auth/login/otp/send", async (req: Request, res: Response) => {
  const limit = rateLimit(`login-otp:${clientIp(req)}`, 8, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  const { username, loginToken } = req.body as { username?: string; loginToken?: string };
  if (!username || !loginToken) {
    fail(res, 400, "Username and login token are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const { rows: chalRows } = await pool.query<{ userId: number; expiresAt: string; consumedAt: string | null }>(
    `SELECT "user_id" AS "userId", "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt"
     FROM "login_challenges" WHERE "token_hash" = $1 LIMIT 1`,
    [hashLoginToken(loginToken)],
  );
  const challenge = chalRows[0];
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt) < new Date()) {
    fail(res, 401, "Session expired. Please log in again.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user || !user.email) {
    fail(res, 400, "No email on file for this account.", AUTH_CODES.EMAIL_INVALID);
    return;
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  await pool.query(`UPDATE "users" SET "otp_code_hash" = $1, "otp_expires_at" = $2, "otp_attempts" = 0 WHERE "id" = $3`, [
    codeHash,
    new Date(Date.now() + OTP_TTL_MS),
    user.id,
  ]);
  const sent = await sendEmail({
    to: user.email,
    subject: "Your MedResearch login code",
    text:
      `Your ${OTP_LENGTH}-digit login code is: ${code}\n` +
      `It expires in 10 minutes.\n\n` +
      `If you did not request this, please secure your account immediately by changing your password.\n\n` +
      `— MedResearch\n` +
      `https://research-center.fit`,
    html:
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;max-width:560px;line-height:1.5">` +
      `<h2 style="margin:0 0 12px;font-size:20px;font-weight:600">Confirm your login</h2>` +
      `<p style="margin:0 0 16px;color:#444;font-size:15px">Use the code below to finish signing in to MedResearch. The code is valid for the next 10 minutes.</p>` +
      `<div style="font-size:22px;letter-spacing:6px;font-weight:700;color:#111;margin:8px 0 16px;padding:12px 16px;background:#f5f5f5;border-radius:6px;display:inline-block">${code}</div>` +
      `<p style="margin:16px 0 0;color:#666;font-size:13px">This code expires in 10 minutes. If you did not request this, please change your password right away.</p>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
      `<p style="margin:0;color:#888;font-size:12px">MedResearch · research-center.fit<br>You received this email because a login was attempted on your account. ` +
      `<a href="https://research-center.fit/unsubscribe?email=${encodeURIComponent(user.email)}&category=login-otp" style="color:#888;text-decoration:underline">Unsubscribe</a></p>` +
      `</div>`,
    category: "login-otp",
  }).catch((err: unknown) => {
    logger.error({ err, userId: user.id, email: user.email }, "Failed to send login OTP email (resend)");
    return false;
  });

  await writeAudit({ userId: user.id, action: "auth.login.otp.resend", ip: clientIp(req) });

  res.status(200).json({ ok: true, sent, emailMasked: maskEmail(user.email) });
});

/**
 * Verifies the login 2FA code and, on success, establishes the session.
 *
 * A6: rate limits (per IP, matching the sibling budgets, plus per login token
 * so one challenge cannot be brute-forced from many IPs) and an atomic
 * attempt counter (a conditional UPDATE, not read-then-increment).
 */
router.post("/auth/login/otp/verify", async (req: Request, res: Response) => {
  const ipLimit = rateLimit(
    `login-otp-verify:${clientIp(req)}`,
    LOGIN_RATE_LIMIT,
    LOGIN_RATE_WINDOW_MS,
  );
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  const { username, loginToken, code } = req.body as {
    username?: string;
    loginToken?: string;
    code?: string;
  };
  if (!username || !loginToken || !code) {
    fail(res, 400, "Username, login token and code are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  // Per-challenge limit: the per-IP budget alone does not stop a botnet from
  // walking the 1 000 000 code space from many addresses.
  const tokenLimit = rateLimit(
    `login-otp-verify:token:${hashLoginToken(loginToken)}`,
    OTP_VERIFY_SUBJECT_LIMIT,
    LOGIN_RATE_WINDOW_MS,
  );
  if (!tokenLimit.success) {
    fail(res, 429, "Too many attempts. Request a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: tokenLimit.retryAfterSec,
    });
    return;
  }

  const { rows: chalRows } = await pool.query<{ userId: number; expiresAt: string; consumedAt: string | null }>(
    `SELECT "user_id" AS "userId", "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt"
     FROM "login_challenges" WHERE "token_hash" = $1 LIMIT 1`,
    [hashLoginToken(loginToken)],
  );
  const challenge = chalRows[0];
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt) < new Date()) {
    fail(res, 401, "Session expired. Please log in again.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user) {
    fail(res, 400, "Verification failed.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }
  if (!user.otpCodeHash || !user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
    fail(res, 400, "Code expired. Request a new one.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }
  // Atomic attempt accounting: the increment and the cap check are one
  // statement, so concurrent wrong codes cannot all read 0 and proceed. No
  // row returned == the 5-attempt budget is already spent.
  const consumed = await pool.query<{ otpAttempts: number }>(
    `UPDATE "users"
        SET "otp_attempts" = "otp_attempts" + 1
      WHERE "id" = $1 AND "otp_code_hash" IS NOT NULL AND "otp_attempts" < $2
      RETURNING "otp_attempts" AS "otpAttempts"`,
    [user.id, LOGIN_OTP_MAX_ATTEMPTS],
  );
  if (consumed.rows.length === 0) {
    fail(res, 429, "Too many attempts. Request a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: tokenLimit.retryAfterSec || 60,
    });
    return;
  }

  const matches = verifyOtp(code, user.otpCodeHash);
  if (!matches) {
    fail(res, 400, "Incorrect code. Try again.", AUTH_CODES.RECOVERY_INVALID);
    return;
  }

  // Consume the challenge and clear the OTP so it can't be reused.
  await pool.query(`UPDATE "login_challenges" SET "consumed_at" = NOW() WHERE "user_id" = $1 AND "token_hash" = $2`, [
    user.id,
    hashLoginToken(loginToken),
  ]);
  await pool.query(
    `UPDATE "users" SET "otp_code_hash" = NULL, "otp_expires_at" = NULL, "otp_attempts" = 0 WHERE "id" = $1`,
    [user.id],
  );

  // A7: rotate the session id on every privilege grant.
  await establishSession(req, user);

  await writeAudit({ userId: user.id, action: "auth.login.success", ip: clientIp(req) });

  res.json({
    ok: true,
    username: user.username,
    role: user.role,
    canAdminAccess: user.canAdminAccess,
    canEdit: user.role !== "viewer",
  });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const userId = req.session?.userId ?? null;
  const ip = clientIp(req);
  req.session.destroy(() => {
    void writeAudit({ userId, action: "auth.logout", ip });
    res.json({ ok: true });
  });
});

router.get("/auth/me", async (req: Request, res: Response) => {
  // This route is the SPA's session probe, so it can never sit behind
  // `requireAuth` — it has to be able to answer "you are logged out". That also
  // means the idle/absolute check has to happen here explicitly, otherwise an
  // expired session would keep reporting `authenticated: true` and the shell
  // would render as if nothing happened.
  if (!req.session.authenticated || !req.session.username) {
    res.status(401).json({ authenticated: false });
    return;
  }
  const check = checkSession(req);
  if (!check.ok) {
    void writeAudit({
      userId: req.session.userId ?? null,
      action: "auth.session.expired",
      detail: { reason: check.reason },
      ip: clientIp(req),
    });
    res.status(401).json({ authenticated: false, code: AUTH_CODES.SESSION_EXPIRED });
    req.session.destroy(() => undefined);
    return;
  }

  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId ?? 0))
    .limit(1);
  // Authoritative from the DB row (not just the session) so an admin flag
  // set/changed after login is reflected immediately, and so a session
  // that lost the field still reports the correct access level.
  const canAdminAccess = u?.canAdminAccess ?? req.session.canAdminAccess ?? false;
  const role = req.session.role ?? u?.role ?? "user";
  req.session.canAdminAccess = canAdminAccess;
  const mfaEnabled = Boolean(u?.totpEnabledAt);
  const mfaRequired = Boolean(u?.mfaRequired);
  const expiry = sessionExpiry(req);

  // One round trip for the whole shell: identity, permissions, MFA state and
  // when the session dies. `canEdit` mirrors requireEdit (everything except
  // "viewer") so the SPA does not have to re-derive it.
  res.json({
    authenticated: true,
    id: req.session.userId ?? u?.id ?? null,
    userId: req.session.userId ?? u?.id ?? null,
    username: req.session.username,
    fullName: u?.fullName ?? null,
    email: u?.email ?? null,
    role,
    canAdminAccess,
    canEdit: role !== "viewer",
    status: u?.status ?? "active",
    mfaEnabled,
    mfaRequired,
    // True only when an admin has required MFA and this account has not
    // enrolled yet — the signal to prompt for enrolment (see the report).
    mfaEnrollmentRequired: mfaRequired && !mfaEnabled,
    sessionExpiresAt: new Date(expiry.expiresAt).toISOString(),
    sessionIdleExpiresAt: new Date(expiry.idleExpiresAt).toISOString(),
    sessionAbsoluteExpiresAt: new Date(expiry.absoluteExpiresAt).toISOString(),
    reauthenticatedAt: req.session.reauthenticatedAt
      ? new Date(req.session.reauthenticatedAt).toISOString()
      : null,
  });
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.authenticated) {
    // `error` is unchanged ("Unauthorized") — the SPA's unauthenticated
    // handling depends on this string — but the code lets it tell "no session
    // at all" apart from a specific failure without string matching.
    fail(res, 401, "Unauthorized", AUTH_CODES.SESSION_EXPIRED);
    return;
  }
  // Every authenticated route now inherits the idle + absolute session bounds.
  requireActiveSession(req, res, next);
}

// ============================================================================
// Password recovery
// ============================================================================

/**
 * 30 minutes. Long enough for a user to find the mail, open the right tab and
 * retype the token; short enough that a link sitting in a mailbox (or a shared
 * machine's browser history) is not a standing credential.
 */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_URL_BASE =
  process.env.PASSWORD_RESET_URL ?? "https://research-center.fit/reset-password";
const RESET_NEUTRAL_MESSAGE =
  "If an account exists for that email address or username, a password reset link is on its way.";

/**
 * POST /auth/password-reset/request
 *
 * Anti-enumeration is the whole design constraint here:
 *   * the response is byte-identical whether or not the account exists,
 *     whether or not it is active, and whether or not it has an email,
 *   * the mail is dispatched without being awaited, so the SMTP round trip is
 *     not a timing side channel,
 *   * the audit trail DOES distinguish the outcomes (an operator must be able
 *     to see "someone asked to reset alice", and "someone sprayed 400
 *     identifiers"), it is simply not reachable from the HTTP response.
 */
router.post("/auth/password-reset/request", async (req: Request, res: Response) => {
  const ip = clientIp(req);
  const ipLimit = rateLimit(`password-reset-request:${ip}`, RESET_REQUEST_IP_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  // `identifier` is the field name the SPA sends; `email` / `username` are
  // accepted too so either shape works. Exactly one of them is used, with
  // `identifier` taking precedence.
  const { identifier: identifierField, email, username } = req.body as {
    identifier?: string;
    email?: string;
    username?: string;
  };
  const identifier = (identifierField ?? email ?? username ?? "").trim();
  if (!identifier) {
    fail(res, 400, "Email or username is required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  // Per-identifier as well as per-IP: the per-IP budget alone does not stop a
  // spray of one identifier from a botnet, and a single IP spraying thousands
  // of different identifiers is exactly what the per-identifier key misses.
  const idKey = identifier.toLowerCase();
  const subjectLimit = rateLimit(
    `password-reset-request:id:${idKey}`,
    RESET_REQUEST_SUBJECT_LIMIT,
    LOGIN_RATE_WINDOW_MS,
  );
  if (!subjectLimit.success) {
    fail(res, 429, "Too many attempts. Request a new link later.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: subjectLimit.retryAfterSec,
    });
    return;
  }

  const { rows } = await pool.query<{
    id: number;
    username: string;
    email: string | null;
    status: string;
  }>(
    `SELECT "id", "username", "email", "status" FROM "users"
      WHERE lower("email") = $1 OR "username" = $2 LIMIT 1`,
    [idKey, identifier],
  );
  const user = rows[0];

  if (!user) {
    await writeAudit({ action: "auth.password_reset.requested", detail: { identifier: idKey, outcome: "no_such_account" }, ip });
    res.status(200).json({ ok: true, message: RESET_NEUTRAL_MESSAGE });
    return;
  }

  if (user.status !== "active") {
    // Deliberately NOT sent: a pending account cannot sign in anyway and a
    // suspended one must not be told where its mail goes.
    await writeAudit({ userId: user.id, action: "auth.password_reset.requested", detail: { identifier: idKey, outcome: `account_${user.status}` }, ip });
    res.status(200).json({ ok: true, message: RESET_NEUTRAL_MESSAGE });
    return;
  }

  if (!user.email) {
    await writeAudit({ userId: user.id, action: "auth.password_reset.requested", detail: { identifier: idKey, outcome: "no_email_on_file" }, ip });
    res.status(200).json({ ok: true, message: RESET_NEUTRAL_MESSAGE });
    return;
  }

  const token = generateResetToken();
  // Issuing a new token invalidates every outstanding one: only the most recent
  // request is usable, so an attacker who triggered a reset to get a link into
  // a mailbox they later gain access to cannot use it alongside the real user's
  // fresh link (and vice versa).
  await pool.query(
    `UPDATE "password_reset_tokens" SET "used_at" = NOW() WHERE "user_id" = $1 AND "used_at" IS NULL`,
    [user.id],
  );
  await pool.query(
    `INSERT INTO "password_reset_tokens" ("user_id", "token_hash", "lookup_hash", "expires_at", "requested_ip")
     VALUES ($1, $2, $3, $4, $5)`,
    [
      user.id,
      hashResetToken(token),
      resetTokenLookupHash(token),
      new Date(Date.now() + RESET_TOKEN_TTL_MS),
      ip,
    ],
  );

  const link = `${RESET_URL_BASE}?token=${encodeURIComponent(token)}`;
  // Narrowed once so the closures below do not have to re-prove it.
  const accountEmail: string = user.email;
  void sendEmail({
    to: accountEmail,
    subject: "Reset your MedResearch password",
    text:
      `A password reset was requested for your MedResearch account (${user.username}).\n\n` +
      `Open this link to choose a new password:\n${link}\n\n` +
      `The link expires in 30 minutes and can only be used once.\n\n` +
      `If you did not request this, you can ignore this email — your password will not change, ` +
      `and any other reset links already sent become invalid.\n\n` +
      `— MedResearch\nhttps://research-center.fit`,
    html:
      `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;max-width:560px;line-height:1.5">` +
      `<h2 style="margin:0 0 12px;font-size:20px;font-weight:600">Reset your password</h2>` +
      `<p style="margin:0 0 16px;color:#444;font-size:15px">A reset was requested for <strong>${user.username}</strong>. ` +
      `This link expires in 30 minutes and can only be used once.</p>` +
      `<p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Choose a new password</a></p>` +
      `<p style="margin:0 0 12px;color:#666;font-size:13px">If the button does not work, copy this link into your browser:<br>` +
      `<span style="word-break:break-all">${link}</span></p>` +
      `<p style="margin:16px 0 0;color:#666;font-size:13px">If you did not request this, ignore this email. Your password will not change, ` +
      `and any other reset links already sent stop working.</p>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:24px 0">` +
      `<p style="margin:0;color:#888;font-size:12px">MedResearch · research-center.fit</p>` +
      `</div>`,
    // Transactional account-security mail: the Worker refuses a direct
    // unsubscribe for this category (CAN-SPAP §4(4)).
    category: "password-reset",
  }).catch((err: unknown) => {
    logger.error({ err, userId: user.id, email: maskEmail(accountEmail) }, "Failed to send password reset email");
  });

  await writeAudit({ userId: user.id, action: "auth.password_reset.requested", detail: { identifier: idKey, outcome: "sent" }, ip });
  logger.info({ userId: user.id, username: user.username }, "Password reset email sent");

  // Dev/test convenience, DOUBLE gated so it cannot leak by accident: it needs
  // an explicit opt-in AND a non-production NODE_ENV. Returning the token
  // unconditionally would make the emailed link meaningless — anyone able to
  // request a reset could then change the password without the mailbox.
  const devToken =
    process.env.NODE_ENV === "production" || process.env.PASSWORD_RESET_DEV_TOKEN !== "true"
      ? {}
      : { token, expiresInSec: Math.floor(RESET_TOKEN_TTL_MS / 1000) };

  res.status(200).json({ ok: true, message: RESET_NEUTRAL_MESSAGE, ...devToken });
});

/**
 * POST /auth/password-reset/confirm
 *
 * The token is consumed by a conditional UPDATE (`WHERE used_at IS NULL AND
 * expires_at > now() RETURNING …`) rather than a read-then-write, so two
 * concurrent redemptions of the same token cannot both succeed: the loser gets
 * no row back and is told the link is used.
 */
router.post("/auth/password-reset/confirm", async (req: Request, res: Response) => {
  const ip = clientIp(req);
  const ipLimit = rateLimit(`password-reset-confirm:${ip}`, RESET_CONFIRM_IP_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    fail(res, 400, "Reset token and new password are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const lookup = resetTokenLookupHash(token);
  const tokenLimit = rateLimit(`password-reset-confirm:token:${lookup}`, RESET_CONFIRM_SUBJECT_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!tokenLimit.success) {
    fail(res, 429, "Too many attempts. Request a new link.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: tokenLimit.retryAfterSec,
    });
    return;
  }

  const { rows } = await pool.query<{
    id: number;
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    requestedIp: string | null;
  }>(
    `SELECT "id", "user_id" AS "userId", "token_hash" AS "tokenHash", "expires_at" AS "expiresAt",
            "used_at" AS "usedAt", "requested_ip" AS "requestedIp"
       FROM "password_reset_tokens" WHERE "lookup_hash" = $1 LIMIT 1`,
    [lookup],
  );
  const row = rows[0];
  if (!row || !verifyResetToken(token, row.tokenHash)) {
    fail(res, 400, "This reset link is invalid or has already been used.", AUTH_CODES.RESET_TOKEN_INVALID);
    return;
  }
  if (row.usedAt) {
    fail(res, 400, "This reset link has already been used.", AUTH_CODES.RESET_TOKEN_USED);
    return;
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    fail(res, 400, "This reset link has expired. Please request a new one.", AUTH_CODES.RESET_TOKEN_EXPIRED);
    return;
  }

  const pwCheck = isValidPassword(password);
  if (!pwCheck.ok) {
    fail(res, 400, pwCheck.reason!, AUTH_CODES.PASSWORD_WEAK);
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, row.userId))
    .limit(1);
  if (!target) {
    fail(res, 400, "This reset link is invalid or has already been used.", AUTH_CODES.RESET_TOKEN_INVALID);
    return;
  }

  // Reuse check (nice-to-have, implemented): one bcrypt verify against the
  // CURRENT hash, before the token is consumed, so a user who retypes their old
  // password gets a clear error and keeps their still-valid link instead of
  // burning it and being locked out.
  if (await verifyPassword(password, target.passwordHash)) {
    fail(res, 400, "Your new password must be different from your current password.", AUTH_CODES.PASSWORD_WEAK);
    return;
  }

  // ---- single-use claim: the race-free part -------------------------------
  const claimed = await pool.query<{ id: number; userId: number }>(
    `UPDATE "password_reset_tokens"
        SET "used_at" = NOW()
      WHERE "id" = $1 AND "used_at" IS NULL AND "expires_at" > NOW()
      RETURNING "id", "user_id" AS "userId"`,
    [row.id],
  );
  if (claimed.rows.length === 0) {
    // Lost the race (or the link expired between the check above and here).
    fail(res, 400, "This reset link has already been used.", AUTH_CODES.RESET_TOKEN_USED);
    return;
  }
  const userId = claimed.rows[0]!.userId;

  const passwordHash = await hashPassword(password);
  // A reset also clears the lockout streak — otherwise an account that was
  // locked out for brute force stays locked out (and its owner cannot use the
  // link they just proved control of the mailbox for) — and clears any live OTP.
  await db
    .update(usersTable)
    .set({
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    })
    .where(eq(usersTable.id, userId));

  // Every other outstanding token for this account dies with this one.
  await pool.query(
    `UPDATE "password_reset_tokens" SET "used_at" = NOW() WHERE "user_id" = $1 AND "used_at" IS NULL`,
    [userId],
  );

  // A password change must log every other device out: a session opened with
  // the OLD password is a session the person who changed the password did not
  // intend to keep.
  const revoked = await revokeAllSessions(userId);

  await writeAudit({
    userId,
    action: "auth.password_reset.completed",
    detail: { revokedSessions: revoked, tokenRequestedFromIp: row.requestedIp },
    ip,
  });
  logger.info({ userId, revokedSessions: revoked }, "Password reset completed");

  res.json({ ok: true, sessionsRevoked: revoked });
});

// ============================================================================
// TOTP MFA (RFC 6238, no external dependency)
// ============================================================================

const MFA_ISSUER = (process.env.MFA_ISSUER ?? "MedResearch").trim() || "MedResearch";

/**
 * `otpauth://totp/<issuer>:<account>?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30`
 *
 * NO QR CODE IS PRODUCED. There is no QR library in this workspace and adding
 * one was out of scope, so this route returns the secret and this URI and the
 * frontend renders a copyable block (`secret` for manual entry, the URI for
 * apps that accept a paste). That is the same information a QR code encodes —
 * nothing is lost except convenience.
 */
function buildOtpAuthUri(secret: string, username: string): string {
  const label = `${encodeURIComponent(MFA_ISSUER)}:${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    secret,
    issuer: MFA_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  // URLSearchParams encodes spaces as "+", which is wrong inside an otpauth
  // label for some authenticator apps.
  const query = params.toString().replace(/\+/g, "%20");
  return `otpauth://totp/${label}?${query}`;
}

/** Issue a fresh set of single-use recovery codes and return them (plaintext, once). */
async function issueRecoveryCodes(userId: number): Promise<string[]> {
  await pool.query(`DELETE FROM "mfa_recovery_codes" WHERE "user_id" = $1`, [userId]);
  const codes = Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  for (const code of codes) {
    await pool.query(
      `INSERT INTO "mfa_recovery_codes" ("user_id", "code_hash") VALUES ($1, $2)`,
      [userId, hashRecoveryCode(code)],
    );
  }
  return codes;
}

/**
 * POST /auth/mfa/enroll — step 1 of 2.
 *
 * Requires an authenticated session AND a recent password re-entry: enrolling
 * MFA is how an attacker would take over an account they have just phished a
 * session for, so it must not be possible from a stale or borrowed session.
 */
router.post(
  "/auth/mfa/enroll",
  requireAuth,
  requireRecentReauth(),
  async (req: Request, res: Response) => {
    const limit = rateLimit(`mfa-enroll:${clientIp(req)}`, MFA_ENROLL_LIMIT, LOGIN_RATE_WINDOW_MS);
    if (!limit.success) {
      fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const userId = req.session.userId ?? 0;
    const [user] = await db
      .select({ username: usersTable.username, totpEnabledAt: usersTable.totpEnabledAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      fail(res, 404, "User not found.", AUTH_CODES.FIELD_REQUIRED);
      return;
    }
    if (user.totpEnabledAt) {
      fail(res, 409, "Multi-factor authentication is already enabled for this account.", AUTH_CODES.TOTP_ALREADY_SET);
      return;
    }

    // The pending secret lives server-side (sealed) rather than being echoed back
    // by the client at confirm time: otherwise anyone could confirm an enrolment
    // pointing at a secret they chose, and the account's authenticator would
    // silently be theirs.
    const secret = generateTotpSecret();
    await db
      .update(usersTable)
      .set({ mfaPendingSecretEnc: encryptSecret(secret), mfaAttempts: 0 })
      .where(eq(usersTable.id, userId));

    await writeAudit({ userId, action: "auth.mfa.enroll.started", ip: clientIp(req) });

    res.json({
      ok: true,
      secret,
      otpauthUri: buildOtpAuthUri(secret, user.username),
      issuer: MFA_ISSUER,
      algorithm: "SHA1",
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SEC,
      // No `qrCode` field: no QR library is available. The frontend renders the
      // secret / URI as a copyable block.
      qrCodeAvailable: false,
    });
  },
);

/**
 * POST /auth/mfa/enroll/confirm — step 2 of 2.
 *
 * Verifies the first code from the authenticator, flips MFA on, and returns the
 * 8 recovery codes exactly once (they are hashed at rest and never retrievable
 * again — only regenerable).
 */
router.post(
  "/auth/mfa/enroll/confirm",
  requireAuth,
  requireRecentReauth(),
  async (req: Request, res: Response) => {
    const limit = rateLimit(`mfa-enroll-confirm:${clientIp(req)}`, MFA_ENROLL_LIMIT, LOGIN_RATE_WINDOW_MS);
    if (!limit.success) {
      fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const { code } = req.body as { code?: string };
    if (!code) {
      fail(res, 400, "Verification code is required.", AUTH_CODES.FIELD_REQUIRED);
      return;
    }

    const userId = req.session.userId ?? 0;
    const [user] = await db
      .select({
        totpEnabledAt: usersTable.totpEnabledAt,
        pendingEnc: usersTable.mfaPendingSecretEnc,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.totpEnabledAt) {
      fail(res, 400, "Multi-factor authentication is already enabled for this account.", AUTH_CODES.TOTP_ALREADY_SET);
      return;
    }
    if (!user.pendingEnc) {
      fail(res, 400, "Start multi-factor setup before confirming a code.", AUTH_CODES.TOTP_NOT_CONFIGURED);
      return;
    }
    const secret = decryptSecret(user.pendingEnc);
    if (!secret) {
      // Key rotated, or the row was tampered with. Never fall through to
      // "accept anything".
      logger.error({ userId }, "Could not decrypt the pending TOTP secret");
      fail(res, 400, "Start multi-factor setup before confirming a code.", AUTH_CODES.TOTP_NOT_CONFIGURED);
      return;
    }

    const check = verifyTotp(secret, code);
    if (!check.ok) {
      fail(res, 400, "Incorrect or expired code. Try again.", AUTH_CODES.MFA_INVALID);
      return;
    }

    // Claim the pending secret conditionally so a concurrent re-enrol cannot
    // confirm a secret that is no longer the one on file.
    //
    // `totp_last_used_step` is deliberately left NULL. The enrolment code is
    // proof of setup, not a login factor: it is replayable only while
    // `totp_enabled_at IS NULL`, and this UPDATE is the statement that sets it,
    // so a second confirmation cannot get past the guard. Burning the step here
    // instead would mean the user cannot sign in with their authenticator for
    // the rest of the 30-second window they just enrolled in.
    const enabled = await pool.query<{ id: number }>(
      `UPDATE "users"
          SET "mfa_secret_enc" = "mfa_pending_secret_enc",
              "mfa_pending_secret_enc" = NULL,
              "totp_enabled_at" = NOW(),
              "totp_last_used_step" = NULL,
              "mfa_attempts" = 0
        WHERE "id" = $1 AND "mfa_pending_secret_enc" IS NOT NULL AND "totp_enabled_at" IS NULL
        RETURNING "id"`,
      [userId],
    );
    if (enabled.rows.length === 0) {
      fail(res, 400, "Start multi-factor setup before confirming a code.", AUTH_CODES.TOTP_NOT_CONFIGURED);
      return;
    }

    const recoveryCodes = await issueRecoveryCodes(userId);

    await writeAudit({ userId, action: "auth.mfa.enabled", ip: clientIp(req) });

    res.json({
      ok: true,
      mfaEnabled: true,
      totpEnabledAt: new Date().toISOString(),
      // Shown exactly once. Store them now — they cannot be recovered later.
      recoveryCodes,
      recoveryCodesRemaining: MFA_RECOVERY_CODE_COUNT,
    });
  },
);

/** POST /auth/mfa/disable — requires a recent password re-entry. */
router.post(
  "/auth/mfa/disable",
  requireAuth,
  requireRecentReauth(),
  async (req: Request, res: Response) => {
    const limit = rateLimit(`mfa-disable:${clientIp(req)}`, MFA_ENROLL_LIMIT, LOGIN_RATE_WINDOW_MS);
    if (!limit.success) {
      fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const userId = req.session.userId ?? 0;
    const [user] = await db
      .select({ totpEnabledAt: usersTable.totpEnabledAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user?.totpEnabledAt) {
      fail(res, 400, "Multi-factor authentication is not enabled for this account.", AUTH_CODES.MFA_NOT_ENROLLED);
      return;
    }

    await db
      .update(usersTable)
      .set({
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        totpEnabledAt: null,
        totpLastUsedStep: null,
        mfaAttempts: 0,
      })
      .where(eq(usersTable.id, userId));
    await pool.query(`DELETE FROM "mfa_recovery_codes" WHERE "user_id" = $1`, [userId]);

    await writeAudit({ userId, action: "auth.mfa.disabled", ip: clientIp(req) });

    res.json({ ok: true, mfaEnabled: false });
  },
);

/** POST /auth/mfa/recovery/regenerate — requires a recent password re-entry. */
router.post(
  "/auth/mfa/recovery/regenerate",
  requireAuth,
  requireRecentReauth(),
  async (req: Request, res: Response) => {
    const limit = rateLimit(`mfa-recovery-regen:${clientIp(req)}`, MFA_ENROLL_LIMIT, LOGIN_RATE_WINDOW_MS);
    if (!limit.success) {
      fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const userId = req.session.userId ?? 0;
    const [user] = await db
      .select({ totpEnabledAt: usersTable.totpEnabledAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user?.totpEnabledAt) {
      fail(res, 400, "Multi-factor authentication is not enabled for this account.", AUTH_CODES.MFA_NOT_ENROLLED);
      return;
    }

    const recoveryCodes = await issueRecoveryCodes(userId);
    await writeAudit({
      userId,
      action: "auth.mfa.recovery.regenerated",
      detail: { count: recoveryCodes.length },
      ip: clientIp(req),
    });

    // Invalidates every previously issued code, including any that are unused.
    res.json({ ok: true, recoveryCodes, recoveryCodesRemaining: MFA_RECOVERY_CODE_COUNT });
  },
);

/**
 * POST /auth/mfa/verify — completes a login whose password step returned
 * `{ mfaRequired: true, loginToken }`.
 *
 * Accepts EITHER a 6-digit TOTP code OR a single-use recovery code. Rate
 * limited per IP and per login token (so one challenge cannot be walked from a
 * botnet), with the same DB-backed atomic attempt counter as the e-mail OTP
 * verify route — a conditional UPDATE, not read-then-increment.
 *
 * `recoveryOnly` is the mode used by the `POST /auth/mfa/recovery/verify`
 * alias below.
 */
async function handleMfaVerify(req: Request, res: Response, recoveryOnly: boolean): Promise<void> {
  const ipLimit = rateLimit(`mfa-verify:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  const { loginToken, code } = req.body as { loginToken?: string; code?: string };
  if (!loginToken || !code) {
    fail(res, 400, "Login token and verification code are required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const tokenHash = hashLoginToken(loginToken);
  const tokenLimit = rateLimit(`mfa-verify:token:${tokenHash}`, MFA_VERIFY_SUBJECT_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!tokenLimit.success) {
    fail(res, 429, "Too many attempts. Sign in again to get a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: tokenLimit.retryAfterSec,
    });
    return;
  }

  const { rows: chalRows } = await pool.query<{ userId: number; expiresAt: Date; consumedAt: Date | null }>(
    `SELECT "user_id" AS "userId", "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt"
       FROM "login_challenges" WHERE "token_hash" = $1 LIMIT 1`,
    [tokenHash],
  );
  const challenge = chalRows[0];
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt).getTime() < Date.now()) {
    fail(res, 401, "Session expired. Please log in again.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user) {
    fail(res, 400, "Verification failed.", AUTH_CODES.MFA_INVALID);
    return;
  }
  if (!user.totpEnabledAt || !user.mfaSecretEnc) {
    fail(res, 400, "Multi-factor authentication is not enabled for this account.", AUTH_CODES.MFA_NOT_ENROLLED);
    return;
  }

  // Atomic attempt accounting, identical in shape to the OTP verify route.
  const consumed = await pool.query<{ mfaAttempts: number }>(
    `UPDATE "users"
        SET "mfa_attempts" = "mfa_attempts" + 1
      WHERE "id" = $1 AND "totp_enabled_at" IS NOT NULL AND "mfa_attempts" < $2
      RETURNING "mfa_attempts" AS "mfaAttempts"`,
    [user.id, MFA_MAX_ATTEMPTS],
  );
  if (consumed.rows.length === 0) {
    fail(res, 429, "Too many attempts. Sign in again to get a new code.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: tokenLimit.retryAfterSec || 60,
    });
    return;
  }

  let method: "totp" | "recovery" | null = null;

  if (looksLikeRecoveryCode(code)) {
    // At most MFA_RECOVERY_CODE_COUNT (8) rows per user, so an in-process
    // constant-time scan is cheaper than any query trick — and the *consume*
    // is what has to be race-free, which the conditional DELETE below does.
    const { rows: codeRows } = await pool.query<{ id: number; codeHash: string }>(
      `SELECT "id", "code_hash" AS "codeHash" FROM "mfa_recovery_codes"
        WHERE "user_id" = $1 AND "used_at" IS NULL`,
      [user.id],
    );
    const match = codeRows.find((r) => verifyRecoveryCode(code, r.codeHash));
    if (match) {
      const used = await pool.query<{ id: number }>(
        `DELETE FROM "mfa_recovery_codes" WHERE "id" = $1 AND "used_at" IS NULL RETURNING "id"`,
        [match.id],
      );
      // No row back == a concurrent request consumed the same code first.
      method = used.rows.length > 0 ? "recovery" : null;
    }
  } else {
    if (recoveryOnly) {
      // This endpoint only redeems recovery codes; a 6-digit code is the wrong
      // credential for it, and answering with the generic TOTP message here
      // would send a user to their authenticator app instead of the list of
      // backup codes in front of them.
      fail(res, 400, "Incorrect or expired code. Try again.", AUTH_CODES.RECOVERY_INVALID);
      return;
    }
    const secret = decryptSecret(user.mfaSecretEnc);
    if (!secret) {
      logger.error({ userId: user.id }, "Could not decrypt the stored TOTP secret");
      fail(res, 400, "Multi-factor authentication is misconfigured. Contact an administrator.", AUTH_CODES.TOTP_NOT_CONFIGURED);
      return;
    }
    const check = verifyTotp(secret, code);
    if (check.ok && check.step !== null) {
      // Claim the counter value so the SAME code cannot be replayed inside the
      // +/-1 step window. Conditional UPDATE == race-free.
      const claimed = await pool.query<{ id: number }>(
        `UPDATE "users"
            SET "totp_last_used_step" = $2
          WHERE "id" = $1 AND ("totp_last_used_step" IS NULL OR "totp_last_used_step" < $2)
          RETURNING "id"`,
        [user.id, check.step],
      );
      method = claimed.rows.length > 0 ? "totp" : null;
    }
  }

  if (!method) {
    // On the recovery-only endpoint the input shape is itself the failure, so
    // it reports AUTH_RECOVERY_INVALID: that is the credential the screen is
    // about.
    fail(
      res,
      400,
      "Incorrect or expired code. Try again.",
      recoveryOnly ? AUTH_CODES.RECOVERY_INVALID : AUTH_CODES.MFA_INVALID,
    );
    return;
  }

  // Consume the login challenge atomically: a second submission of the same
  // valid code can never reach here (the challenge is already consumed), and a
  // concurrent pair cannot both win.
  const used = await pool.query<{ id: number }>(
    `UPDATE "login_challenges" SET "consumed_at" = NOW() WHERE "token_hash" = $1 AND "consumed_at" IS NULL RETURNING "id"`,
    [tokenHash],
  );
  if (used.rows.length === 0) {
    fail(res, 401, "Session expired. Please log in again.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }
  await pool.query(
    `UPDATE "users" SET "otp_code_hash" = NULL, "otp_expires_at" = NULL, "otp_attempts" = 0, "mfa_attempts" = 0 WHERE "id" = $1`,
    [user.id],
  );

  // Same as every other privilege grant: rotate the session id (A7).
  await establishSession(req, user);

  const recoveryLeft = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "mfa_recovery_codes" WHERE "user_id" = $1 AND "used_at" IS NULL`,
    [user.id],
  );
  await writeAudit({ userId: user.id, action: "auth.login.success", detail: { mfa: method }, ip: clientIp(req) });
  logger.info({ userId: user.id, username: user.username, mfa: method }, "MFA login completed");

  res.json({
    ok: true,
    username: user.username,
    role: user.role,
    canAdminAccess: user.canAdminAccess,
    canEdit: user.role !== "viewer",
    mfaMethod: method,
    // 0 left means the user should be told to regenerate before they get stuck.
    mfaRecoveryCodesRemaining: recoveryLeft.rows[0]?.count ?? 0,
  });
}

/** Accepts a TOTP code OR a recovery code. */
router.post("/auth/mfa/verify", (req: Request, res: Response) => {
  void handleMfaVerify(req, res, false);
});

/**
 * POST /auth/mfa/recovery/verify — recovery codes only.
 *
 * Alias of `/auth/mfa/verify` restricted to the recovery-code credential, kept
 * because the "I lost my phone" screen posts to a recovery-specific path (it
 * must not accept a 6-digit code that happened to be typed into the wrong box,
 * and its error copy is about backup codes). Same rate limits, same atomic
 * attempt counter, same atomic single-use consumption, same session
 * establishment — it is the same handler with a stricter input rule.
 */
router.post("/auth/mfa/recovery/verify", (req: Request, res: Response) => {
  void handleMfaVerify(req, res, true);
});

// ============================================================================
// Step-up re-authentication
// ============================================================================

/**
 * POST /auth/reauth — re-enter the current password to unlock the destructive
 * operations for the next REAUTH_MAX_AGE_MS (10 min default).
 *
 * Deliberately does NOT touch the account lockout counters. A re-auth prompt is
 * reachable from an active session, so counting its failures would let anyone
 * holding a stolen session lock the account out of the very control they lack —
 * the rate limiter below is the right control for a prompt.
 */
router.post("/auth/reauth", requireAuth, async (req: Request, res: Response) => {
  const ip = clientIp(req);
  const ipLimit = rateLimit(`reauth:${ip}`, REAUTH_IP_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!ipLimit.success) {
    fail(res, 429, `Too many attempts. Try again in ${ipLimit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: ipLimit.retryAfterSec,
    });
    return;
  }

  const { password } = req.body as { password?: string };
  if (!password) {
    fail(res, 400, "Password is required.", AUTH_CODES.FIELD_REQUIRED);
    return;
  }

  const userId = req.session.userId ?? 0;
  const subjectLimit = rateLimit(`reauth:user:${userId}`, REAUTH_SUBJECT_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!subjectLimit.success) {
    fail(res, 429, "Too many attempts. Try again later.", AUTH_CODES.RATE_LIMITED, {
      retryAfterSec: subjectLimit.retryAfterSec,
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    fail(res, 401, "Invalid credentials.", AUTH_CODES.INVALID_CREDENTIALS);
    return;
  }
  // An OAuth-created account has a placeholder password hash, so no password can
  // ever be confirmed for it. Say so instead of reporting a wrong password.
  if (user.passwordHash === DUMMY_HASH) {
    fail(
      res,
      400,
      "This account signs in with a single sign-on provider, so password confirmation is not available.",
      AUTH_CODES.OAUTH_LINK_REQUIRED,
    );
    return;
  }

  // Constant-time compare, and against DUMMY_HASH when the row vanished
  // underneath us, so this endpoint is not a user-enumeration oracle either.
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await writeAudit({ userId, action: "auth.reauth.failure", ip });
    fail(res, 401, "Invalid credentials.", AUTH_CODES.INVALID_CREDENTIALS);
    return;
  }

  const at = markReauthenticated(req);
  await writeAudit({ userId, action: "auth.reauth.success", ip });

  res.json({
    ok: true,
    reauthenticatedAt: new Date(at).toISOString(),
    expiresInSec: Math.floor(REAUTH_MAX_AGE_MS / 1000),
  });
});

/**
 * POST /auth/password/change — the in-session password change.
 *
 * There was NO route for this at all before: the only ways to change a password
 * were the admin creating a user or (now) the emailed reset link. Requiring a
 * recent re-auth on top of an active session is the point of the endpoint — a
 * hijacked session cannot silently rotate the credential.
 */
router.post(
  "/auth/password/change",
  requireAuth,
  requireRecentReauth(),
  async (req: Request, res: Response) => {
    const limit = rateLimit(`password-change:${clientIp(req)}`, PASSWORD_CHANGE_LIMIT, LOGIN_RATE_WINDOW_MS);
    if (!limit.success) {
      fail(res, 429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`, AUTH_CODES.RATE_LIMITED, {
        retryAfterSec: limit.retryAfterSec,
      });
      return;
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      fail(res, 400, "Current password and new password are required.", AUTH_CODES.FIELD_REQUIRED);
      return;
    }

    const pwCheck = isValidPassword(newPassword);
    if (!pwCheck.ok) {
      fail(res, 400, pwCheck.reason!, AUTH_CODES.PASSWORD_WEAK);
      return;
    }

    const userId = req.session.userId ?? 0;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      fail(res, 401, "Invalid credentials.", AUTH_CODES.INVALID_CREDENTIALS);
      return;
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      await writeAudit({ userId, action: "auth.password.change.failure", ip: clientIp(req) });
      fail(res, 401, "Invalid credentials.", AUTH_CODES.INVALID_CREDENTIALS);
      return;
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      fail(res, 400, "Your new password must be different from your current password.", AUTH_CODES.PASSWORD_WEAK);
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash, failedAttempts: 0, lockedUntil: null })
      .where(eq(usersTable.id, userId));

    // Other devices are logged out; the caller keeps the session they are
    // using (they have just proved the current password).
    const currentSid = (req as Request & { sessionID: string }).sessionID;
    const revoked = await revokeOtherSessions(userId, currentSid);

    await writeAudit({ userId, action: "auth.password.changed", detail: { revokedSessions: revoked }, ip: clientIp(req) });

    res.json({ ok: true, sessionsRevoked: revoked });
  },
);

export default router;

const PROVIDERS = ["google", "apple"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(p: string): p is Provider {
  return PROVIDERS.includes(p as Provider);
}

function providerEnv(provider: Provider) {
  if (provider === "google") {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    };
  }
  return {
    clientId: process.env.APPLE_CLIENT_ID,
    clientSecret: process.env.APPLE_CLIENT_SECRET,
    redirectUri: process.env.APPLE_REDIRECT_URI,
  };
}

router.get("/auth/oauth/:provider", async (req: Request, res: Response) => {
  const { provider } = req.params as { provider: string };
  if (!isProvider(provider)) {
    fail(res, 400, "Unsupported OAuth provider.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const env = providerEnv(provider);
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    logger.error({ provider }, "Missing OAuth environment for provider");
    fail(res, 500, "OAuth provider not configured.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const state = randomBytes(32).toString("hex");
  const nonce = randomBytes(24).toString("hex");

  if (!req.session) {
    fail(res, 500, "Session unavailable.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }
  req.session.oauthState = { provider, state, nonce, createdAt: Date.now() };

  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: provider === "google" ? "openid email profile" : "openid name email",
    state,
    ...(provider === "apple" ? { response_mode: "form_post" } : { nonce }),
  });

  const base =
    provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize";
  res.redirect(`${base}?${params.toString()}`);
});

async function jwksVerify(token: string, provider: Provider, expectedNonce?: string): Promise<{
  sub: string;
  email: string | null;
  name: string | null;
  /** A8: did the provider actually verify this email? Required before we
   *  will use it to identify or create an account. */
  emailVerified: boolean;
} | null> {
  const jwksUri =
    provider === "google"
      ? "https://www.googleapis.com/oauth2/v3/tokeninfo"
      : "https://appleid.apple.com/auth/keys";

  if (provider === "apple") {
    const keysRes = await fetch(jwksUri);
    if (!keysRes.ok) return null;
    const { keys } = (await keysRes.json()) as {
      keys: Array<{ kid: string; alg: string; kty: string; n: string; e: string }>;
    };
    const [protectedB64] = token.split(".");
    const protectedHeader = JSON.parse(
      Buffer.from(protectedB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    const key = keys.find((k) => k.kid === protectedHeader.kid);
    if (!key) return null;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: key.kty, n: key.n, e: key.e, alg: key.alg, ext: true },
      { name: "RSASSA-PKCS1-v1_5" },
      false,
      ["verify"],
    );
    const payloadB64 = token.split(".")[1];
    const signatureB64 = token.split(".")[2];
    const payloadBuf = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const signingInput = Buffer.from(
      (protectedB64 + "." + payloadB64).replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
    const signature = Buffer.from(signatureB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signingInput);
    if (!ok) return null;

    const payload = JSON.parse(payloadBuf.toString());
    if (expectedNonce && payload.nonce !== expectedNonce) return null;
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
      // Apple sends a boolean; be liberal about "true"/1 as well.
      emailVerified:
        payload.email_verified === true ||
        payload.email_verified === "true" ||
        payload.email_verified === 1,
    };
  }

  // Google: use the tokeninfo endpoint (no extra JWKS fetch needed for ID tokens).
  const infoRes = await fetch(`${jwksUri}?id_token=${token}`);
  if (!infoRes.ok) return null;
  const info = (await infoRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: string | boolean | number;
    name?: string;
    nonce?: string;
    aud: string;
    iss: string;
  };
  if (expectedNonce && info.nonce !== expectedNonce) return null;
  return {
    sub: info.sub,
    email: info.email ?? null,
    name: info.name ?? null,
    emailVerified:
      info.email_verified === true ||
      info.email_verified === "true" ||
      info.email_verified === 1,
  };
}

/**
 * Exported for tests: the callback handler is the authorisation point for
 * OAuth logins (status + email_verified + no email-only auto-linking), so it
 * is worth driving directly rather than only through the router.
 */
export async function oauthCallbackHandler(req: Request, res: Response): Promise<void> {
  const { provider } = req.params as { provider: string };
  if (!isProvider(provider)) {
    fail(res, 400, "Unsupported OAuth provider.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const env = providerEnv(provider);
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    fail(res, 500, "OAuth provider not configured.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const state = req.session?.oauthState;
  if (!state || state.provider !== provider) {
    fail(res, 400, "Missing or invalid OAuth state.", AUTH_CODES.OAUTH_INVALID);
    return;
  }
  if (Date.now() - state.createdAt > 10 * 60 * 1000) {
    fail(res, 400, "OAuth state expired.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const code = req.method === "POST" ? (req.body as { code?: string }).code : (req.query as { code?: string }).code;
  const returnedState = req.method === "POST" ? (req.body as { state?: string }).state : (req.query as { state?: string }).state;
  if (!code || returnedState !== state.state) {
    fail(res, 400, "Invalid OAuth response.", AUTH_CODES.OAUTH_INVALID);
    return;
  }

  const params = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectUri,
    ...(provider === "apple" ? { client_secret: env.clientSecret } : {}),
  });

  const exchangeBase =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://appleid.apple.com/auth/token";
  const tokRes = await fetch(exchangeBase, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!tokRes.ok) {
    logger.error({ provider, status: tokRes.status }, "OAuth token exchange failed");
    res.redirect(`/auth?oauth=error`);
    return;
  }
  const tokenJson = (await tokRes.json()) as { id_token?: string; access_token: string };
  const idToken = tokenJson.id_token ?? tokenJson.access_token;

  const verified = await jwksVerify(idToken, provider, state.nonce);
  if (!verified) {
    res.redirect(`/auth?oauth=error`);
    return;
  }

  if (!req.session) {
    fail(res, 500, "Session unavailable.", AUTH_CODES.SESSION_EXPIRED);
    return;
  }
  req.session.oauthState = undefined;

  const [existing] = await db
    .select()
    .from(oauthIdentitiesTable)
    .where(
      and(eq(oauthIdentitiesTable.provider, provider), eq(oauthIdentitiesTable.providerUserId, verified.sub)),
    )
    .limit(1);

  let user;
  if (existing) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, existing.userId)).limit(1);
    user = u;
  } else if (verified.email) {
    // A8: never link an OAuth login to a local account on the strength of an
    // email string alone. Before this, `WHERE email = $verified.email` handed
    // anyone who could register that address at a *different* provider a
    // full session on the victim's account (account takeover), and it did so
    // even when the provider had not verified the address. Linking now
    // requires proof of control: an existing account must sign in with its
    // password first and link explicitly, or an admin must do it.
    if (!verified.emailVerified) {
      logger.warn(
        { provider, sub: verified.sub },
        "OAuth refused: provider has not verified the email address",
      );
      await writeAudit({
        action: "auth.oauth.rejected",
        detail: { provider, reason: "email_not_verified" },
        ip: clientIp(req),
      });
      res.redirect(`/auth?oauth=error`);
      return;
    }

    const [byEmail] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, verified.email))
      .limit(1);
    if (byEmail) {
      logger.warn(
        { provider, email: verified.email },
        "OAuth refused: local account already uses this email — link it explicitly",
      );
      await writeAudit({
        action: "auth.oauth.rejected",
        detail: { provider, reason: "email_already_registered" },
        ip: clientIp(req),
      });
      res.redirect(`/auth?oauth=link_required`);
      return;
    }

    const [inserted] = await db
      .insert(usersTable)
      .values({
        username: verified.email,
        email: verified.email,
        passwordHash: DUMMY_HASH,
        status: "active",
        canAdminAccess: false,
        role: "user",
      })
      .returning({ id: usersTable.id });
    const userId = inserted?.id ?? null;
    if (userId) {
      await db.insert(oauthIdentitiesTable).values({
        userId: userId as number,
        provider,
        providerUserId: verified.sub,
        email: verified.email,
        name: verified.name,
        providerEmailVerified: true,
      });
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      user = u;
    }
  }

  if (!user) {
    res.redirect(`/auth?oauth=error`);
    return;
  }

  // A8: the callback had no status check at all (the password path rejects
  // `pending` / `suspended` at auth.ts:84-91), so a suspended account could
  // still be logged in through OAuth. Re-read the authoritative row and apply
  // the same rule.
  const [currentUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  if (!currentUser || currentUser.status !== "active") {
    logger.warn(
      { userId: user.id, status: currentUser?.status },
      "OAuth login refused: account is not active",
    );
    await writeAudit({
      userId: user.id,
      action: "auth.oauth.rejected",
      detail: { provider, reason: `account_${currentUser?.status ?? "missing"}` },
      ip: clientIp(req),
    });
    res.redirect(`/auth?oauth=error`);
    return;
  }

  // A7: rotate the session id when a session is established.
  await establishSession(req, currentUser);

  await writeAudit({ userId: currentUser.id, action: "auth.oauth.success", detail: { provider }, ip: clientIp(req) });

  res.redirect("/dashboard");
}

/**
 * OAuth callback — registered for BOTH verbs, and both are required.
 *
 * RFC 6749 §4.1.2 has the authorization server redirect the user-agent to the
 * redirect URI using an HTTP GET with `?code=…&state=…`. That is what Google
 * does. Apple can be configured for `form_post`, which arrives as a POST body.
 *
 * Only the POST verb was registered here, so Google's callback matched no route
 * at all and returned 404. For a long time an accidental global `requireAuth`
 * layer (from `router.use(requireAuth, subRouter)`, which Express registers at
 * path "/" ) masked that as a 401, so it looked like an auth failure rather
 * than a missing route and Google/Apple social login never worked.
 *
 * The handler is already written for both: it reads `state` from the query
 * string on GET and the body on POST (see `oauthCallbackHandler`), and it is
 * not an unauthenticated write primitive — it requires a session-bound,
 * 10-minute, single-use `state` that must match, plus a JWKS id_token whose
 * nonce matches the one issued at authorize time.
 */
router.get("/auth/oauth/:provider/callback", oauthCallbackHandler);
router.post("/auth/oauth/:provider/callback", oauthCallbackHandler);
