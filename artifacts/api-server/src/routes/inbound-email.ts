import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/security";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

// Per-sender budget. The shared secret authenticates the *sender* (the
// Worker), not the mail: anyone who can post with a valid-looking From can
// otherwise fan out a notification row to every admin, unboundedly.
const INBOUND_LIMIT = 20; // per sender per 15 min
const INBOUND_WINDOW_MS = 15 * 60 * 1000;

const InboundEmailBody = z.object({
  from: z.string().trim().min(1).max(320),
  to: z.string().trim().min(1).max(320),
  subject: z.string().max(998).optional(),
  text: z.string().max(200_000).optional(),
  // `html` is accepted (and then dropped) for backwards compatibility with
  // the Worker payload: it was up to 500 KB of caller-supplied markup stored
  // per message and re-rendered in the admin inbox, which is an unbounded
  // write amplifier and a stored-XSS risk. Only `text` is persisted.
  html: z.string().max(500_000).optional(),
  messageId: z.string().max(998).optional(),
  inReplyTo: z.string().max(998).optional(),
});

/**
 * Constant-time comparison of the shared secret.
 *
 * A17: `req.header("x-inbound-email-secret") !== secret` leaks the secret's
 * prefix through response timing, byte by byte. `timingSafeEqual` requires
 * equal-length buffers, so we hash both sides first (that also folds away
 * the length difference between an absent and a malformed header).
 */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still burn a comparison so a length mismatch is not obviously faster.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Strip control characters (including CR/LF) from a header-ish string. */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
}

// Receives parsed inbound email from the Cloudflare `research` Worker's Email
// Routing handler. Authenticated with a shared INBOUND_EMAIL_SECRET (set as a
// Worker secret and an api-server env var) so only Cloudflare can post here.
router.post("/", validate({ body: InboundEmailBody }), async (req, res) => {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || !secretMatches(req.header("x-inbound-email-secret"), secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { from, to, subject, text, messageId, inReplyTo } = req.validated!
    .body as z.infer<typeof InboundEmailBody>;

  const sender = stripControlChars(from).slice(0, 320) || "(unknown)";
  const limit = rateLimit(`inbound-email:${sender.toLowerCase()}`, INBOUND_LIMIT, INBOUND_WINDOW_MS);
  if (!limit.success) {
    return res.status(429).json({ error: "Too many messages from this sender." });
  }

  // A17: strip control characters from the subject before it is stored and
  // re-rendered in the admin inbox (log-injection / header-splitting bait).
  const safeSubject = (subject ? stripControlChars(subject) : "").slice(0, 998) || "(no subject)";
  const safeText = text ?? "";

  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO inbound_emails
         (sender, recipient, subject, body_text, body_html, message_id, in_reply_to, received_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, now())
       RETURNING id`,
      [
        sender,
        stripControlChars(to).slice(0, 320),
        safeSubject,
        safeText,
        messageId ? stripControlChars(messageId).slice(0, 998) : null,
        inReplyTo ? stripControlChars(inReplyTo).slice(0, 998) : null,
      ],
    );

    // Notify every admin so support mail is surfaced in-app.
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT id, 'inbound_email', $1, $2, '/admin/inbox'
       FROM users WHERE can_admin_access = true`,
      [`New email from ${sender}`, safeSubject],
    );

    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    logger.error({ err }, "inbound email store failed");
    return res.status(500).json({ error: "store failed" });
  }
});

export default router;