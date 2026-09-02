import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, usersTable, signupRequestsTable, pool } from "@workspace/db";
import { hashPassword, hashLoginToken, verifyPassword, isValidPassword, rateLimit, clientIp } from "../lib/security";
import { writeAudit } from "../lib/audit";
import { sendEmail } from "../lib/email";

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
const LOGIN_OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete 2FA

const router: IRouter = Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const LOGIN_RATE_LIMIT = 10; // per IP per 15 min
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

// Valid-format bcrypt hash used only to equalize timing when no user exists.
const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYh2dQHP8DjL0eW";

function isLocked(user: { lockedUntil: Date | null } | undefined): boolean {
  if (!user?.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}

function publicUser(u: { id: number; username: string; role: string; canAdminAccess: boolean; status: string }) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    canAdminAccess: u.canAdminAccess,
    status: u.status,
  };
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const limit = rateLimit(`login:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);

  // Always run a hash comparison to reduce timing oracle, but reject when no user.
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH);

  if (!user || !valid) {
    if (user && !isLocked(user)) {
      const attempts = user.failedAttempts + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        await db.update(usersTable).set({ failedAttempts: attempts, lockedUntil }).where(eq(usersTable.id, user.id));
      } else {
        await db.update(usersTable).set({ failedAttempts: attempts }).where(eq(usersTable.id, user.id));
      }
    }
    res.status(401).json({ error: "Invalid credentials." });
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.failure", detail: { username }, ip: clientIp(req) });
    return;
  }

  if (isLocked(user)) {
    await writeAudit({ userId: user?.id ?? null, action: "auth.login.locked", detail: { username }, ip: clientIp(req) });
    res.status(429).json({ error: "Account is temporarily locked. Try again later." });
    return;
  }

  if (user.status === "pending") {
    res.status(403).json({ error: "Your account is pending admin approval." });
    return;
  }
  if (user.status === "suspended") {
    res.status(403).json({ error: "This account has been suspended." });
    return;
  }

  // Successful password check: reset lockout counters.
  await db.update(usersTable).set({ failedAttempts: 0, lockedUntil: null }).where(eq(usersTable.id, user.id));

  // If the account has no email on file we cannot do 2FA — fall back to a
  // password-only session (legacy accounts). Otherwise issue a short-lived
  // login challenge and email a code; the session is only created after the
  // code is verified at /api/auth/login/otp/verify.
  if (!user.email) {
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role as "admin" | "user";
    req.session.canAdminAccess = user.canAdminAccess;
    await writeAudit({ userId: user.id, action: "auth.login.success", ip: clientIp(req) });
    res.json({ ok: true, username: user.username, role: user.role, canAdminAccess: user.canAdminAccess });
    return;
  }

  const loginToken = randomBytes(32).toString("hex");
  const challengeHash = hashLoginToken(loginToken);
  await pool.query(
    `INSERT INTO "login_challenges" ("token_hash", "user_id", "expires_at") VALUES ($1, $2, $3)`,
    [challengeHash, user.id, new Date(Date.now() + LOGIN_OTP_TTL_MS)],
  );

  // Fire-and-forget the email; the code is generated inside sendLoginOtp.
  const code = String(Math.floor(10 ** (OTP_LENGTH - 1) + Math.random() * (10 ** OTP_LENGTH - 10 ** (OTP_LENGTH - 1))));
  const codeHash = await hashPassword(code);
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
  }).catch(() => {});

  await writeAudit({ userId: user.id, action: "auth.login.otp.sent", ip: clientIp(req) });

  res.json({
    ok: true,
    otpRequired: true,
    loginToken,
    emailMasked: maskEmail(user.email),
    username: user.username,
  });
});

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

// Sign-up application: creates a PENDING request reviewed by an admin.
router.post("/auth/signup", async (req: Request, res: Response) => {
  const limit = rateLimit(`signup:${clientIp(req)}`, 10, LOGIN_RATE_WINDOW_MS);
  if (!limit.success) {
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
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
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }
  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }
  const pwCheck = isValidPassword(password);
  if (!pwCheck.ok) {
    res.status(400).json({ error: pwCheck.reason });
    return;
  }

  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existingUser) {
    res.status(409).json({ error: "An account or request with that username already exists." });
    return;
  }
  const [existingRequest] = await db
    .select({ id: signupRequestsTable.id, status: signupRequestsTable.status })
    .from(signupRequestsTable)
    .where(eq(signupRequestsTable.username, username))
    .limit(1);
  if (existingRequest) {
    res.status(409).json({ error: "An account or request with that username already exists." });
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
      res.status(409).json({ error: "An account or request with that username already exists." });
      return;
    }
    throw e;
  }

  await writeAudit({ action: "auth.signup.request", detail: { username }, ip: clientIp(req) });

  res.status(201).json({ ok: true, status: "unverified", message: "Sign-up received. We sent a verification code to your email — enter it to continue." });
});

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_WINDOW_MS = 30 * 1000; // client-enforced cooldown, also throttled here
const OTP_MAX_ATTEMPTS = 5;

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
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  const { username, email } = req.body as { username?: string; email?: string };
  if (!username || !email) {
    res.status(400).json({ error: "Username and email are required." });
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

  const code = String(Math.floor(10 ** (OTP_LENGTH - 1) + Math.random() * (10 ** OTP_LENGTH - 10 ** (OTP_LENGTH - 1))));
  const codeHash = await hashPassword(code);
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
  });

  await writeAudit({
    action: "auth.signup.otp.send",
    detail: { username },
    ip: clientIp(req),
  });

  res.status(200).json({ ok: true, sent, emailMasked: maskEmail(email) });
});

// Verify the code. On success the request's email is marked verified.
router.post("/auth/signup/otp/verify", async (req: Request, res: Response) => {
  const { username, email, code } = req.body as { username?: string; email?: string; code?: string };
  if (!username || !email || !code) {
    res.status(400).json({ error: "Username, email and code are required." });
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
    res.status(400).json({ error: "Verification failed." });
    return;
  }
  if (request.emailVerified) {
    res.status(200).json({ ok: true, verified: true });
    return;
  }
  if (!request.otpCodeHash || !request.otpExpiresAt || new Date(request.otpExpiresAt) < new Date()) {
    res.status(400).json({ error: "Code expired. Request a new one." });
    return;
  }
  if ((request.otpAttempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many attempts. Request a new code." });
    return;
  }

  const matches = await verifyPassword(code, request.otpCodeHash);
  if (!matches) {
    await pool.query(`UPDATE "signup_requests" SET "otp_attempts" = "otp_attempts" + 1 WHERE "id" = $1`, [
      request.id,
    ]);
    res.status(400).json({ error: "Incorrect code. Try again." });
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
    res.status(429).json({ error: `Too many attempts. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  const { username, loginToken } = req.body as { username?: string; loginToken?: string };
  if (!username || !loginToken) {
    res.status(400).json({ error: "Username and login token are required." });
    return;
  }

  const { rows: chalRows } = await pool.query<{ userId: number; expiresAt: string; consumedAt: string | null }>(
    `SELECT "user_id" AS "userId", "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt"
     FROM "login_challenges" WHERE "token_hash" = $1 LIMIT 1`,
    [hashLoginToken(loginToken)],
  );
  const challenge = chalRows[0];
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt) < new Date()) {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user || !user.email) {
    res.status(400).json({ error: "No email on file for this account." });
    return;
  }

  const code = String(Math.floor(10 ** (OTP_LENGTH - 1) + Math.random() * (10 ** OTP_LENGTH - 10 ** (OTP_LENGTH - 1))));
  const codeHash = await hashPassword(code);
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
  }).catch(() => false);

  await writeAudit({ userId: user.id, action: "auth.login.otp.resend", ip: clientIp(req) });

  res.status(200).json({ ok: true, sent, emailMasked: maskEmail(user.email) });
});

/** Verifies the login 2FA code and, on success, establishes the session. */
router.post("/auth/login/otp/verify", async (req: Request, res: Response) => {
  const { username, loginToken, code } = req.body as {
    username?: string;
    loginToken?: string;
    code?: string;
  };
  if (!username || !loginToken || !code) {
    res.status(400).json({ error: "Username, login token and code are required." });
    return;
  }

  const { rows: chalRows } = await pool.query<{ userId: number; expiresAt: string; consumedAt: string | null }>(
    `SELECT "user_id" AS "userId", "expires_at" AS "expiresAt", "consumed_at" AS "consumedAt"
     FROM "login_challenges" WHERE "token_hash" = $1 LIMIT 1`,
    [hashLoginToken(loginToken)],
  );
  const challenge = chalRows[0];
  if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt) < new Date()) {
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challenge.userId)).limit(1);
  if (!user) {
    res.status(400).json({ error: "Verification failed." });
    return;
  }
  if (!user.otpCodeHash || !user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
    res.status(400).json({ error: "Code expired. Request a new one." });
    return;
  }
  if ((user.otpAttempts ?? 0) >= LOGIN_OTP_MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many attempts. Request a new code." });
    return;
  }

  const matches = await verifyPassword(code, user.otpCodeHash);
  if (!matches) {
    await pool.query(`UPDATE "users" SET "otp_attempts" = "otp_attempts" + 1 WHERE "id" = $1`, [user.id]);
    res.status(400).json({ error: "Incorrect code. Try again." });
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

  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role as "admin" | "user";
  req.session.canAdminAccess = user.canAdminAccess;

  await writeAudit({ userId: user.id, action: "auth.login.success", ip: clientIp(req) });

  res.json({ ok: true, username: user.username, role: user.role, canAdminAccess: user.canAdminAccess });
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
    if (req.session.authenticated && req.session.username) {
      const [u] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, req.session.userId ?? 0))
        .limit(1);
      // Authoritative from the DB row (not just the session) so an admin flag
      // set/changed after login is reflected immediately, and so a session
      // that lost the field still reports the correct access level.
      const canAdminAccess = u?.canAdminAccess ?? req.session.canAdminAccess ?? false;
      req.session.canAdminAccess = canAdminAccess;
      res.json({
        authenticated: true,
        id: req.session.userId ?? u?.id ?? null,
        username: req.session.username,
        fullName: u?.fullName ?? null,
        email: u?.email ?? null,
        role: req.session.role ?? "user",
        canAdminAccess,
        status: u?.status ?? "active",
      });
    } else {
      res.status(401).json({ authenticated: false });
    }
  });

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

export default router;
