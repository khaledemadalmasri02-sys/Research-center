import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Receives parsed inbound email from the Cloudflare `research` Worker's Email
// Routing handler. Authenticated with a shared INBOUND_EMAIL_SECRET (set as a
// Worker secret and an api-server env var) so only Cloudflare can post here.
router.post("/", async (req, res) => {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || req.header("x-inbound-email-secret") !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const body = req.body ?? {};
  const { from, to, subject, text, html, messageId, inReplyTo } = body as {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    messageId?: string;
    inReplyTo?: string;
  };

  if (!from || !to) {
    return res.status(400).json({ error: "missing from/to" });
  }

  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO inbound_emails
         (sender, recipient, subject, body_text, body_html, message_id, in_reply_to, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id`,
      [
        from,
        to,
        subject ?? "(no subject)",
        text ?? "",
        html ?? null,
        messageId ?? null,
        inReplyTo ?? null,
      ],
    );

    // Notify every admin so support mail is surfaced in-app.
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT id, 'inbound_email', $1, $2, '/admin/inbox'
       FROM users WHERE can_admin_access = true`,
      [`New email from ${from}`, subject ?? "(no subject)"],
    );

    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    logger.error({ err }, "inbound email store failed");
    return res.status(500).json({ error: "store failed" });
  }
});

export default router;
