import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { timingSafeEqual } from "crypto";
import { requireAuth } from "./auth";
import { requireRecentReauth, revokeOtherSessions, SESSION_ABSOLUTE_TIMEOUT_MS, SESSION_IDLE_TIMEOUT_MS } from "../lib/session";
import { sessionRef, sessionRefMatches } from "../lib/security";
import type { AuthCode } from "./auth";
import { writeAudit } from "../lib/audit";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

const SESSION_CODES = {
  SESSION_REVOKED: "AUTH_SESSION_REVOKED",
  // Invented for this feature and reported back to the frontend contract: the
  // server refuses to act on "the session you are using right now" for the
  // revoke-by-reference route. Nothing in the agreed list described it without
  // also meaning something else.
  SESSION_CURRENT: "AUTH_SESSION_CURRENT",
  FIELD_REQUIRED: "AUTH_FIELD_REQUIRED",
} as const;

function fail(res: Response, status: number, error: string, code: AuthCode): void {
  res.status(status).json({ error, code });
}

const RefParams = z.object({
  ref: z.string().min(1).max(256),
});

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface StoredSession {
  sid: string;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: number | string | null;
  lastActivityAt: number | string | null;
  expire: number | string | Date;
}

/**
 * Coarse, non-identifying device label for the session list.
 *
 * Deliberately NOT a full UA parse (no device fingerprinting, no UA-derived
 * identity): the goal is only to let a user recognise "my phone" and "the
 * workstation in the reading room" in a list they are about to revoke.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown client";
  const os = /Windows NT/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "unknown OS";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "unknown browser";
  return `${browser} on ${os}`;
}

function toMs(value: number | string | Date | null | undefined): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

router.get("/sessions", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId ?? 0;
  const { rows } = await pool.query<StoredSession>(
    `SELECT "sid",
            "sess"->>'username'      AS "username",
            "sess"->>'ip'            AS "ip",
            "sess"->>'userAgent'     AS "userAgent",
            "sess"->>'createdAt'     AS "createdAt",
            "sess"->>'lastActivityAt' AS "lastActivityAt",
            "expire"                 AS "expire"
       FROM "session" WHERE "sess"->>'userId' = $1 ORDER BY "expire" DESC`,
    [String(userId)],
  );

  const currentSid = (req as Request & { sessionID: string }).sessionID;
  const now = Date.now();

  const sessions = rows.map((r) => {
    const isCurrent = r.sid === currentSid;
    // For the current row prefer the in-memory value: express-session persists
    // it at the END of this response, so the stored copy is one request stale.
    const createdAt = toMs(r.createdAt) ?? (toMs(r.expire) ?? now) - SESSION_ABSOLUTE_TIMEOUT_MS;
    const lastActivityAt = isCurrent
      ? (toMs(req.session.lastActivityAt) ?? createdAt)
      : (toMs(r.lastActivityAt) ?? createdAt);
    const absoluteExpiresAt = createdAt + SESSION_ABSOLUTE_TIMEOUT_MS;
    const idleExpiresAt = lastActivityAt + SESSION_IDLE_TIMEOUT_MS;
    return {
      // NOT the session id. A truncated keyed hash of it: enough to address this
      // row in DELETE /sessions/:ref, useless as a credential.
      ref: sessionRef(r.sid),
      username: r.username,
      current: isCurrent,
      device: describeUserAgent(r.userAgent),
      userAgent: r.userAgent,
      ip: r.ip,
      createdAt: new Date(createdAt).toISOString(),
      lastActivityAt: new Date(lastActivityAt).toISOString(),
      absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
      idleExpiresAt: new Date(idleExpiresAt).toISOString(),
      expiresAt: new Date(Math.min(absoluteExpiresAt, idleExpiresAt)).toISOString(),
    };
  });

  res.json({ sessions });
});

/**
 * DELETE /sessions/:ref — revoke one other device.
 *
 * Ownership is enforced STRUCTURALLY: the candidate set is queried with
 * `sess->>'userId' = $1`, so a caller can only ever address their own sessions —
 * there is no id-shaped input that reaches another user's row. The extra
 * `AND "sess"->>'userId' = $2` on the DELETE keeps it enforced on the write
 * path too, so a race that moved the row cannot be used to escape it.
 *
 * A `ref` that matches nothing answers 404 AUTH_SESSION_REVOKED whether it was
 * never real, already revoked, or belongs to somebody else: distinguishing those
 * would be an enumeration oracle for session references.
 */
router.delete(
  "/sessions/:ref",
  requireAuth,
  validate({ params: RefParams }),
  async (req: Request, res: Response) => {
    const { ref } = req.validated!.params as z.infer<typeof RefParams>;
    const userId = req.session.userId ?? 0;
    const currentSid = (req as Request & { sessionID: string }).sessionID;

    if (sessionRefMatches(currentSid, ref) || safeEqual(currentSid, ref)) {
      fail(res, 400, "Cannot revoke the current session.", SESSION_CODES.SESSION_CURRENT);
      return;
    }

    const { rows } = await pool.query<{ sid: string }>(
      `SELECT "sid" FROM "session" WHERE "sess"->>'userId' = $1`,
      [String(userId)],
    );
    // Backwards compatibility for the existing SPA, which still passes the raw
    // sid it was given before `ref` existed. It is not usable as a credential
    // (the SPA never receives a sid any more) and it is still owner-scoped.
    const target = rows.find((r) => sessionRefMatches(r.sid, ref) || safeEqual(r.sid, ref));
    if (!target) {
      fail(res, 404, "Session not found.", SESSION_CODES.SESSION_REVOKED);
      return;
    }

    await pool.query(`DELETE FROM "session" WHERE "sid" = $1 AND "sess"->>'userId' = $2`, [
      target.sid,
      String(userId),
    ]);

    await writeAudit({
      userId,
      action: "auth.session.revoked",
      entity: "session",
      detail: { ref },
      ip: typeof req.ip === "string" ? req.ip : undefined,
    });

    res.json({ ok: true, ref });
  },
);

/**
 * POST /sessions/revoke-others — "sign out everywhere else".
 *
 * Requires a recent password re-authentication: revoking every other session is
 * how a user responds to a suspected compromise, so it must not itself be
 * triggerable by whoever compromised them.
 */
router.post("/sessions/revoke-others", requireAuth, requireRecentReauth(), async (req: Request, res: Response) => {
  const userId = req.session.userId ?? 0;
  const currentSid = (req as Request & { sessionID: string }).sessionID;
  const revoked = await revokeOtherSessions(userId, currentSid);
  await writeAudit({
    userId,
    action: "auth.sessions.revoke_others",
    detail: { revoked },
    ip: typeof req.ip === "string" ? req.ip : undefined,
  });
  res.json({ ok: true, revoked });
});

/**
 * DELETE /sessions — legacy alias of the above, kept because the SPA already
 * calls it. Same re-auth requirement, so the two cannot diverge in strength.
 */
router.delete("/sessions", requireAuth, requireRecentReauth(), async (req: Request, res: Response) => {
  const userId = req.session.userId ?? 0;
  const currentSid = (req as Request & { sessionID: string }).sessionID;
  const revoked = await revokeOtherSessions(userId, currentSid);
  await writeAudit({
    userId,
    action: "auth.sessions.revoke_others",
    detail: { revoked, via: "DELETE /sessions" },
    ip: typeof req.ip === "string" ? req.ip : undefined,
  });
  res.json({ ok: true, revoked });
});

export default router;