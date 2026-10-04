import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { clientIp } from "./security";
import { writeAudit } from "./audit";

/**
 * The identity fields a session carries. Kept in one place so every login
 * path (password, OTP, OAuth, admin self-role change) writes exactly the
 * same set.
 */
export interface SessionIdentity {
  id: number;
  username: string;
  role: string;
  canAdminAccess: boolean;
}

/** Parse a positive-duration env var (ms). Unset/garbage -> fallback. */
function msEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Session lifetimes, enforced SERVER-SIDE (see `checkSession`).
 *
 * Before this the only bound was the cookie's `maxAge` of 7 days: a stolen
 * `rc_sid` was usable for a week, on a platform holding radiology PHI, with no
 * re-authentication anywhere. Two independent bounds now apply:
 *
 *   IDLE      30 min  — any authenticated request slides the window. A session
 *                        left open on an unattended workstation in a reading
 *                        room dies on its own.
 *   ABSOLUTE  12 h    — sliding the idle window can never extend a session past
 *                        this. Without it a script that pings the API every
 *                        29 minutes holds a session open forever.
 *
 * Both are env-overridable so an operator can tighten them per deployment:
 *
 *   SESSION_IDLE_TIMEOUT_MS       [1800000]
 *   SESSION_ABSOLUTE_TIMEOUT_MS   [43200000]
 */
export const SESSION_IDLE_TIMEOUT_MS = msEnv("SESSION_IDLE_TIMEOUT_MS", 30 * 60 * 1000);
export const SESSION_ABSOLUTE_TIMEOUT_MS = msEnv("SESSION_ABSOLUTE_TIMEOUT_MS", 12 * 60 * 60 * 1000);

/**
 * Default freshness window for `requireRecentReauth`. Ten minutes is long
 * enough to walk from a page to a "confirm it's you" dialog and short enough
 * that a walk-away-from-the-keyboard attacker cannot reuse it.
 *
 *   REAUTH_MAX_AGE_MS [600000]
 */
export const REAUTH_MAX_AGE_MS = msEnv("REAUTH_MAX_AGE_MS", 10 * 60 * 1000);

/**
 * Cookie lifetime. Deliberately the IDLE window, not the 7 days it used to be:
 * a cookie that outlives the server-side bound is just a stale credential in the
 * browser, and it is what makes a shared workstation look logged-in.
 *
 * `rolling: true` (see app.ts) re-issues it with a fresh Max-Age on every
 * authenticated response, so it always mirrors the sliding idle window.
 */
export function sessionCookieMaxAgeMs(): number {
  return SESSION_IDLE_TIMEOUT_MS;
}

export type SessionExpiryReason = "idle" | "absolute";

export interface SessionCheckOk {
  ok: true;
  /** Absolute expiry of the session, ms epoch. */
  absoluteExpiresAt: number;
  /** When the idle window runs out if nothing else happens, ms epoch. */
  idleExpiresAt: number;
  /** min(absolute, idle) — what the client should show as "expires". */
  expiresAt: number;
}

export interface SessionCheckExpired {
  ok: false;
  reason: SessionExpiryReason;
  retryAfterSec: number;
}

export type SessionCheck = SessionCheckOk | SessionCheckExpired;

/**
 * Establish an authenticated session, rotating the session id first.
 *
 * Session fixation: `SESSION_COOKIE_DOMAIN` is `.research-center.fit` in
 * production, so ANY sibling subdomain can plant a `rc_sid` cookie in the
 * parent domain. If we merely flipped `authenticated = true` on the incoming
 * session (as all three login paths used to do), an attacker who fixed a
 * known sid — e.g. by visiting a page on a sibling subdomain — would own the
 * victim's session the moment they logged in. `regenerate()` destroys the
 * old session row and issues a brand-new sid, so the value the attacker
 * planted is never promoted to an authenticated session.
 *
 * It is also the right thing on a *privilege change* (admin editing their own
 * role): the session id changes so a session captured before the change can
 * never be replayed as the higher-privileged session.
 *
 * Note on ordering: `express-session` + `connect-pg-simple` needs the store
 * to exist before `regenerate()` can be called. That is the case here —
 * `app.ts` installs `app.use(session({ store: new PgSession(...) }))` before
 * mounting the router, so by the time any route handler runs the store is
 * initialised. Callers must also be inside a request handled after the
 * session middleware (i.e. from a route, not at import time).
 *
 * The session also starts its clock (`createdAt` / `lastActivityAt`) and records
 * the client it came from, so `/auth/me` and `/sessions` can report an absolute
 * expiry and a device label without another table.
 */
export async function establishSession(req: Request, user: SessionIdentity): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  const now = Date.now();
  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role as "admin" | "editor" | "viewer" | "user";
  req.session.canAdminAccess = user.canAdminAccess;
  // `regenerate()` produces a fresh session object, so these are initialised
  // rather than inherited. `reauthenticatedAt` is deliberately NOT set here:
  // logging in is not a step-up re-authentication, so a brand-new session still
  // has to pass `requireRecentReauth` before it can do anything destructive.
  req.session.createdAt = now;
  req.session.lastActivityAt = now;
  req.session.ip = clientIp(req);
  const ua = req.headers?.["user-agent"];
  req.session.userAgent = typeof ua === "string" ? ua.slice(0, 512) : null;
}

/**
 * Check the session against the idle and absolute bounds and slide the idle
 * window forward when it passes.
 *
 * Returns `ok: true` without applying an absolute bound when the session has no
 * `createdAt`: those are either the synthetic stateless Bearer-token sessions
 * built in lib/apiToken.ts (no server-side record exists to expire — their
 * lifetime is `api_tokens.revoked_at`) or a row written before this hardening
 * shipped, where only the idle window can be honoured.
 */
export function checkSession(req: Request, now: number = Date.now()): SessionCheck {
  const createdAt = req.session?.createdAt;
  const lastActivityAt =
    typeof req.session?.lastActivityAt === "number" ? req.session.lastActivityAt : now;

  if (typeof createdAt === "number") {
    const absoluteExpiresAt = createdAt + SESSION_ABSOLUTE_TIMEOUT_MS;
    if (now >= absoluteExpiresAt) {
      return { ok: false, reason: "absolute", retryAfterSec: 1 };
    }
    const idleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS;
    if (now > idleExpiresAt) {
      return { ok: false, reason: "idle", retryAfterSec: 1 };
    }
    // Slide the idle window. Writing to the session marks it modified, which is
    // what makes express-session persist it (and, with `rolling: true`,
    // re-issue the cookie).
    req.session.lastActivityAt = now;
    return {
      ok: true,
      absoluteExpiresAt,
      idleExpiresAt,
      expiresAt: Math.min(absoluteExpiresAt, idleExpiresAt),
    };
  }

  const idleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS;
  if (now > idleExpiresAt) {
    return { ok: false, reason: "idle", retryAfterSec: 1 };
  }
  return {
    ok: true,
    absoluteExpiresAt: now + SESSION_IDLE_TIMEOUT_MS,
    idleExpiresAt,
    expiresAt: idleExpiresAt,
  };
}

/** Expiry of the current session for display, without sliding the idle window. */
export function sessionExpiry(
  req: Request,
  now: number = Date.now(),
): { absoluteExpiresAt: number; idleExpiresAt: number; expiresAt: number } {
  const createdAt =
    typeof req.session?.createdAt === "number" ? req.session.createdAt : now;
  const lastActivityAt =
    typeof req.session?.lastActivityAt === "number" ? req.session.lastActivityAt : now;
  const absoluteExpiresAt = createdAt + SESSION_ABSOLUTE_TIMEOUT_MS;
  const idleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS;
  return { absoluteExpiresAt, idleExpiresAt, expiresAt: Math.min(absoluteExpiresAt, idleExpiresAt) };
}

/** Record a successful re-authentication (password re-entry) on this session. */
export function markReauthenticated(req: Request, now: number = Date.now()): number {
  req.session.reauthenticatedAt = now;
  return now;
}

export function isReauthenticated(req: Request, maxAgeMs: number, now: number = Date.now()): boolean {
  const at = req.session?.reauthenticatedAt;
  if (typeof at !== "number") return false;
  return now - at <= maxAgeMs;
}

/**
 * Guard: the session must be within its idle/absolute bounds.
 *
 * Applied inside `requireAuth` so every authenticated route inherits it. The
 * stale row is destroyed rather than merely refused: leaving it behind means the
 * next request pays for the lookup again, and anything that only checks that a
 * cookie exists would keep seeing a "logged in" browser.
 */
export function requireActiveSession(req: Request, res: Response, next: NextFunction): void {
  const check = checkSession(req);
  if (check.ok) {
    next();
    return;
  }
  const message =
    check.reason === "absolute"
      ? "Session expired. Please log in again."
      : "Session timed out due to inactivity. Please log in again.";
  res.status(401).json({ error: message, code: "AUTH_SESSION_EXPIRED" });
  void writeSessionAudit(req, "auth.session.expired", { reason: check.reason });
  req.session.destroy(() => undefined);
}

/**
 * Guard factory: require a password re-entry within `maxAgeMs`.
 *
 * Used by the destructive operations reachable from the auth routes (password
 * change, MFA enrol/disable/regenerate, revoking other sessions). A session
 * established hours ago — or hijacked and left open — must not be able to strip
 * MFA or rotate the password without proving the password again.
 *
 * Deliberately NOT satisfied by a successful login: `establishSession` leaves
 * `reauthenticatedAt` unset so "I just logged in" is never the same claim as
 * "I just typed my password into a confirmation dialog".
 */
export function requireRecentReauth(maxAgeMs: number = REAUTH_MAX_AGE_MS) {
  return function guard(req: Request, res: Response, next: NextFunction): void {
    if (!isReauthenticated(req, maxAgeMs)) {
      res.status(403).json({
        error: "Please confirm your password to continue.",
        code: "AUTH_REAUTH_REQUIRED",
      });
      return;
    }
    next();
  };
}

function writeSessionAudit(req: Request, action: string, detail: unknown): Promise<void> {
  return writeAudit({
    userId: req.session?.userId ?? null,
    action,
    detail,
    ip: clientIp(req),
  }).catch(() => undefined);
}

/**
 * Revoke every session belonging to `userId` except `exceptSid`.
 * Returns the number of rows deleted.
 */
export async function revokeOtherSessions(
  userId: number,
  exceptSid: string | undefined,
): Promise<number> {
  const res = await pool.query(
    `DELETE FROM "session" WHERE "sess"->>'userId' = $1 AND ($2::text IS NULL OR "sid" <> $2)`,
    [String(userId), exceptSid ?? null],
  );
  return res.rowCount ?? 0;
}

/**
 * Revoke EVERY session belonging to `userId`, including the caller's own.
 * Used by password reset and password change: a credential change must not
 * leave an already-authenticated device logged in.
 */
export async function revokeAllSessions(userId: number): Promise<number> {
  const res = await pool.query(`DELETE FROM "session" WHERE "sess"->>'userId' = $1`, [
    String(userId),
  ]);
  return res.rowCount ?? 0;
}