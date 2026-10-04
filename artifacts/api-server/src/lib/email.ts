interface EmailAttachment {
  // Base64-encoded content
  content: string;
  filename: string;
  type: string;
  disposition?: "attachment" | "inline";
  contentId?: string;
}

import { createHmac } from "node:crypto";
import { checkUnsubscribed } from "./unsubscribeGuard";

export interface EmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  /** Optional category used to build a sensible default List-Unsubscribe URL. */
  category?: string;
}

const DEFAULT_FROM = "noreply@research-center.fit";
const DEFAULT_REPLY_TO = "support@research-center.fit";
const DEFAULT_FROM_NAME = "Research Center";
const UNSUBSCRIBE_BASE = process.env.MAIL_UNSUBSCRIBE_URL ?? "https://research-center.fit/unsubscribe";

/**
 * Shared secret for unsubscribe links. Must be identical on both sides:
 * `research/src/routes/unsubscribe.ts` verifies with `UNSUBSCRIBE_TOKEN`,
 * falling back to `INBOUND_EMAIL_SECRET` then `SESSION_SECRET`. The Worker
 * FAILS CLOSED (403) when it has no token configured, so a link minted
 * without a matching secret is permanently unusable.
 */
function unsubscribeSecret(): string | null {
  const raw =
    process.env.UNSUBSCRIBE_TOKEN ??
    process.env.INBOUND_EMAIL_SECRET ??
    process.env.SESSION_SECRET;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/**
 * Per-address HMAC that proves the mail owner controls the address.
 * Must match `mintUnsubscribeToken` in research/src/routes/unsubscribe.ts
 * byte for byte: HMAC-SHA256(secret, `<lowercased email>|<category>`) hex,
 * truncated to 32 chars.
 */
export function mintUnsubscribeToken(email: string, category: string): string | null {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`${email.toLowerCase()}|${category}`)
    .digest("hex")
    .slice(0, 32);
}

function resolveFrom(input: EmailInput): { address: string; name: string } {
  const address = input.from ?? process.env.SMTP_FROM ?? process.env.MAIL_FROM ?? DEFAULT_FROM;
  const name = process.env.MAIL_FROM_NAME ?? DEFAULT_FROM_NAME;
  return { address, name };
}

function resolveReplyTo(input: EmailInput): string | undefined {
  return input.replyTo ?? process.env.MAIL_REPLY_TO ?? DEFAULT_REPLY_TO;
}

export function buildUnsubscribeUrl(recipient: string, category?: string): string {
  // The Worker normalises before verifying: email is trimmed + lowercased
  // (and rejected if it is not an address) and a missing category becomes
  // "all". Mint over the SAME normalised values or every link is rejected.
  const email = recipient.trim().toLowerCase();
  const normalizedCategory = (category || "all").trim().toLowerCase();
  // Without the token the Worker rejects the request (it verifies the HMAC on
  // both GET and POST), so an untokened link is a dead link.
  const token = mintUnsubscribeToken(email, normalizedCategory);
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
  const categoryParam =
    normalizedCategory === "all" ? "" : `&category=${encodeURIComponent(normalizedCategory)}`;
  return `${UNSUBSCRIBE_BASE}?email=${encodeURIComponent(email)}${categoryParam}${tokenParam}`;
}

function buildHeaders(input: EmailInput): Record<string, string> {
  const recipient = Array.isArray(input.to) ? input.to[0] : input.to;
  const unsubUrl = buildUnsubscribeUrl(recipient ?? "", input.category);
  return {
    "List-Unsubscribe": `<${unsubUrl}>, <mailto:${DEFAULT_REPLY_TO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Precedence": "bulk",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
    ...(input.headers ?? {}),
  };
}

// Sends an email. Prefers Cloudflare Email Sending (REST API) when configured,
// falls back to SMTP when SMTP_HOST is set, and is a no-op otherwise so the app
// runs without email in dev. The `from` address must use a domain onboarded to
// Cloudflare Email Sending (see `wrangler email sending enable`).
export async function sendEmail(input: EmailInput): Promise<boolean> {
  // Respect prior unsubscribes. The guard is fail-open: if the Worker is
  // unreachable or no lookup URL is configured, the send proceeds. We do this
  // before the CF/SMTP branches so both send paths are guarded uniformly.
  const allowed = await checkUnsubscribed({ to: input.to, category: input.category });
  if (!allowed) return false;

  if (process.env.CF_EMAIL_TOKEN) {
    return sendViaCloudflare(input);
  }

  const host = process.env.SMTP_HOST;
  if (!host) return false;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  const from = resolveFrom(input);
  await transporter.sendMail({
    from: `"${from.name}" <${from.address}>`,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: resolveReplyTo(input),
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: buildHeaders(input),
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.type,
      disposition: a.disposition ?? "attachment",
      cid: a.contentId,
    })),
  });
  return true;
}

async function sendViaCloudflare(input: EmailInput): Promise<boolean> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_EMAIL_TOKEN;
  if (!accountId) {
    throw new Error("CF_ACCOUNT_ID is required for Cloudflare Email Sending");
  }

  const from = resolveFrom(input);
  const body: Record<string, unknown> = {
    to: input.to,
    from: { address: from.address, name: from.name },
    subject: input.subject,
    text: input.text,
  };
  if (input.html) body.html = input.html;
  const replyTo = resolveReplyTo(input);
  if (replyTo) body.reply_to = replyTo;
  if (input.cc) body.cc = input.cc;
  if (input.bcc) body.bcc = input.bcc;
  if (input.attachments?.length) body.attachments = input.attachments;
  body.headers = buildHeaders(input);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const data = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: { code: number; message: string }[];
  } | null;

  if (!res.ok || !data?.success) {
    const detail = data?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare email send failed: ${detail}`);
  }
  return true;
}
