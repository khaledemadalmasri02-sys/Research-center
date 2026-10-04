import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getClientIp, timingSafeEqual } from "../lib/security";

export const unsubscribeApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// ---------------------------------------------------------------------------
// UNSUBSCRIBE — WHAT WAS WRONG
// ---------------------------------------------------------------------------
// `POST /api/unsubscribe` had no authentication, no rate limit and no proof of
// ownership: it accepted a bare `email` and wrote a suppression row. Because
// `category` also accepted "all", and the api-server's `sendEmail` consults this
// table before every send (artifacts/api-server/src/lib/unsubscribeGuard.ts),
// anyone who knew or guessed a clinician's email address could silently
// suppress that clinician's **login OTP** — i.e. suppress their 2FA.
//
// Fixes here:
//   * Every mutation requires a per-address HMAC token minted into the email
//     link. Possession of the token is the proof that the requester controls the
//     mailbox (RFC 8058 §3.1 one-click posts the same signed URL).
//   * Constant-time comparison of that token.
//   * Per-IP rate limit (KV), so a leaked token cannot be brute-forced or used
//     to enumerate addresses.
//   * `GET /status` FAILS CLOSED: no configured token => 403, instead of
//     returning per-category suppression state for any address to anyone.
//   * Security-relevant categories can never be suppressed, by `"all"` or by
//     direct request.
//
// ---------------------------------------------------------------------------
// CATEGORY POLICY
// ---------------------------------------------------------------------------
// CAN-SPAM §4(4) requires an unsubscribe mechanism for commercial mail, but it
// does not override the security obligations created by a separate service: a
// login OTP is a **transactional/security** message required to complete
// authentication, and the platform's own privacy notice promises that "account
// notifications related to your login and security may still be sent". Letting
// an unsubscribe suppress it converts a GDPR/GDPR-art-25 data-subject control
// into a denial-of-service on another person's authentication.
//
// SECURITY_CATEGORIES is therefore a hard denylist: an unsubscribe for one of
// these is refused with 400 and NOTHING is written. Note the api-server uses
// `login-otp` for the 2FA code (routes/auth.ts), so suppressing it means a
// clinician cannot complete login.
export const SECURITY_CATEGORIES: ReadonlySet<string> = new Set([
  "login-otp",
  "signup-otp",
  "password-reset",
  "account-security",
  "account-security-notice",
  "security-notice",
  "transactional",
]);

// Tiny self-contained HTML helper so we don't add a templating dep just for this.
function renderPage(args: {
  title: string;
  heading: string;
  message: string;
  cta?: { href: string; label: string };
}): string {
  const cta = args.cta
    ? `<p style="margin:24px 0 0"><a href="${args.cta.href}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${args.cta.label}</a></p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${args.title}</title>
<meta name="robots" content="noindex,nofollow">
<style>html,body{margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:#fafafa;color:#111}main{max-width:560px;margin:48px auto;padding:32px;background:#fff;border:1px solid #eee;border-radius:10px}h1{margin:0 0 8px;font-size:22px;line-height:1.3}p{margin:8px 0 0;color:#444;line-height:1.5}</style>
</head>
<body>
<main>
<h1>${args.heading}</h1>
<p>${args.message}</p>
${cta}
</main>
</body>
</html>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Marketing / engagement categories a data subject may opt out of. `"all"` is
// accepted as a request for everything in THIS set — never the security set.
const VALID_CATEGORIES = new Set([
  "all",
  "admin-notification",
  "newsletter",
  "product-update",
  "research-update",
]);

// Rate limit: 10 suppression writes per IP per 10 minutes.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_S = 600;

function unsubscribeSecret(c: AppContext): string | null {
  const raw =
    (c.env as unknown as Record<string, any>).UNSUBSCRIBE_TOKEN ??
    c.env.INBOUND_EMAIL_SECRET ??
    c.env.SESSION_SECRET;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

// Mint the per-address token that appears in every unsubscribe link. Exported so
// the api-server's mailer can produce links; the Worker is the verifier, so the
// secret must be identical on both sides.
export async function mintUnsubscribeToken(
  secret: string,
  email: string,
  category: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const msg = `${email.toLowerCase()}|${category}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))
  );
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function verifyUnsubscribeToken(
  c: AppContext,
  email: string,
  category: string,
  presented: string | null | undefined
): Promise<{ ok: boolean; reason: string }> {
  const secret = unsubscribeSecret(c);
  if (!secret) {
    // Fail closed. Without a secret every request would be unverifiable, and an
    // unverifiable unsubscribe is just "suppress anyone by email".
    return {
      ok: false,
      reason:
        "Unsubscribe token verification is not configured; refusing to " +
        "process an unverified unsubscribe.",
    };
  }
  if (!presented) {
    return { ok: false, reason: "Missing unsubscribe token." };
  }
  const expected = await mintUnsubscribeToken(secret, email, category);
  if (!timingSafeEqual(expected, presented.trim().toLowerCase())) {
    return { ok: false, reason: "Invalid unsubscribe token." };
  }
  return { ok: true, reason: "" };
}

async function rateLimited(c: AppContext): Promise<boolean> {
  try {
    const ip = getClientIp(c);
    const key = `ratelimit:unsub:${ip}`;
    const kv = c.env.SESSIONS as unknown as {
      get(k: string): Promise<string | null>;
      put(k: string, v: string, o?: unknown): Promise<void>;
    };
    const raw = await kv.get(key);
    const n = raw ? parseInt(raw, 10) || 0 : 0;
    if (n >= RATE_LIMIT_MAX) return true;
    await kv.put(key, String(n + 1), { expirationTtl: RATE_LIMIT_WINDOW_S });
    return false;
  } catch {
    // Fail OPEN on rate limiting: an outage in KV must not silently stop every
    // legitimate unsubscribe in the world (a CAN-SPAM exposure). The HMAC
    // token is the primary control; this is only a volume brake.
    return false;
  }
}

function sanitizeEmail(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254) return null;
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

// Resolve the requested category to the CONCRETE set of categories it may
// suppress. This is where "all" stops meaning "everything": it expands only to
// the non-security categories, so `category=all` can never silence a login OTP.
export function resolveSuppressionScope(
  requested: string
): { scope: string[]; refusedSecurity: boolean } {
  const v = (requested ?? "all").trim().toLowerCase();
  if (v === "all") {
    return {
      scope: [...VALID_CATEGORIES].filter((c) => c !== "all"),
      refusedSecurity: true,
    };
  }
  if (SECURITY_CATEGORIES.has(v)) {
    return { scope: [], refusedSecurity: true };
  }
  if (!VALID_CATEGORIES.has(v)) {
    return {
      scope: [...VALID_CATEGORIES].filter((c) => c !== "all"),
      refusedSecurity: true,
    };
  }
  return { scope: [v], refusedSecurity: false };
}

async function recordUnsubscribe(
  c: AppContext,
  email: string,
  category: string,
  source: string
): Promise<void> {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const ua = c.req.header("user-agent") ?? null;
  // Use ON CONFLICT to make repeated clicks idempotent (and so the unique
  // index on (email, category) is respected without a prior SELECT).
  await c.env.DB.prepare(
    `INSERT INTO email_unsubscribes (email, category, source, user_agent, ip)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email, category) DO UPDATE SET
       source = excluded.source,
       user_agent = excluded.user_agent,
       ip = excluded.ip,
       created_at = email_unsubscribes.created_at`
  )
    .bind(email, category, source, ua, ip)
    .run();
}

// GET /api/unsubscribe?email=...&category=...&token=...
// Renders the confirmation page. The signed token must be present even to VIEW
// the page: without it we would be reflecting attacker-supplied input back into
// HTML, and a link with no token could never be submitted successfully anyway.
unsubscribeApp.get("/", async (c: AppContext) => {
  const email = sanitizeEmail(c.req.query("email"));
  const category = (c.req.query("category") || "all").trim().toLowerCase();
  const token = c.req.query("token");

  if (!email) {
    return c.html(
      renderPage({
        title: "Unsubscribe",
        heading: "Invalid unsubscribe link",
        message:
          "This unsubscribe link is missing or malformed. Please use the link in the email you received, or contact support@research-center.fit.",
      }),
      400
    );
  }

  const verdict = await verifyUnsubscribeToken(c, email, category, token);
  if (!verdict.ok) {
    return c.html(
      renderPage({
        title: "Unsubscribe",
        heading: "This unsubscribe link is not valid",
        message: verdict.reason,
      }),
      400
    );
  }

  const { scope } = resolveSuppressionScope(category);
  const refusedSecurity = SECURITY_CATEGORIES.has(category) || category === "all";
  const action = `/api/unsubscribe?email=${encodeURIComponent(email)}&category=${encodeURIComponent(
    category
  )}&token=${encodeURIComponent(String(token))}`;
  const scopeLabel = scope.length ? scope.join(", ") : "nothing";
  return c.html(
    renderPage({
      title: "Unsubscribe from MedResearch emails",
      heading: "Unsubscribe from MedResearch emails?",
      message: `We'll stop sending <strong>${scopeLabel}</strong> emails to <strong>${email}</strong>.${
        refusedSecurity
          ? " Login, password-reset and account-security emails are always sent and cannot be suppressed."
          : ""
      }`,
      cta: { href: action, label: "Confirm unsubscribe" },
    }),
  );
});

// POST /api/unsubscribe
//   - HTML link confirmation from the GET page above (query params).
//   - Gmail/Yahoo List-Unsubscribe-Post one-click (RFC 8058), which POSTs the
//     same signed URL.
// Both must return 2xx with a tiny body so the mail client considers the
// unsubscribe acknowledged and stops showing the "report spam" prompts.
unsubscribeApp.post("/", async (c: AppContext) => {
  if (await rateLimited(c)) {
    return c.text("Too many unsubscribe requests. Try again later.", 429);
  }

  let email = "";
  let category = "all";
  let token: string | undefined;

  if (
    c.req.header("content-type")?.includes("application/x-www-form-urlencoded") ||
    c.req.header("content-type")?.includes("multipart/form-data")
  ) {
    const form = await c.req.parseBody();
    email = typeof form["email"] === "string" ? (form["email"] as string) : "";
    category = typeof form["category"] === "string" ? (form["category"] as string) : "all";
    token = typeof form["token"] === "string" ? (form["token"] as string) : undefined;
  } else {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        email?: string;
        category?: string;
        token?: string;
      };
      email = body.email ?? "";
      category = body.category ?? "all";
      token = body.token;
    } catch {
      email = "";
    }
  }

  const cleanEmail = sanitizeEmail(email);
  if (!cleanEmail) {
    return c.text("Invalid email", 400);
  }
  const cleanCategory = (category || "all").trim().toLowerCase();

  const verdict = await verifyUnsubscribeToken(c, cleanEmail, cleanCategory, token);
  if (!verdict.ok) {
    return c.text(verdict.reason, 400);
  }

  const { scope } = resolveSuppressionScope(cleanCategory);
  if (scope.length === 0) {
    // A security-relevant category requested DIRECTLY: refuse, write nothing.
    // (`category=all` is not refused — it resolves to the concrete non-security
    // categories above, so it simply cannot silence security mail.)
    return c.text(
      `Refusing to suppress "${cleanCategory}": login, password-reset and ` +
        `account-security mail is mandatory and cannot be unsubscribed ` +
        `(CAN-SPAM 4(4) does not override authentication obligations).`,
      400
    );
  }

  const source = c.req.header("list-unsubscribe-post") ? "one-click" : "form";

  // Write one row per resolved category so the api-server's suppression check
  // (exact category match, plus an `all` row) sees a concrete entry.
  for (const cat of scope) {
    await recordUnsubscribe(c, cleanEmail, cat, source);
  }

  // One-click POST expects a small response — return "OK" for legacy clients
  // and a tiny HTML page for the form submission.
  if (source === "one-click") {
    return c.text("OK", 200);
  }
  return c.html(
    renderPage({
      title: "Unsubscribed",
      heading: "You've been unsubscribed",
      message: `${cleanEmail} will no longer receive <code>${scope.join(
        "</code>, <code>"
      )}</code> emails from MedResearch. Login, password-reset and account-security emails are still sent${
        SECURITY_CATEGORIES.has(cleanCategory)
          ? " (that category cannot be suppressed)"
          : ""
      }. You can re-subscribe at any time by signing in and updating your notification settings.`,
      cta: { href: "https://research-center.fit", label: "Back to MedResearch" },
    }),
  );
});

// GET /api/unsubscribe/status?email=...
// Used by the api-server before each send. FAILS CLOSED: if no shared token is
// configured the route returns 403 rather than disclosing an arbitrary
// address's suppression state to anyone who asks.
//
// (The api-server's unsubscribeGuard is fail-open on a *network* error, so it
// will keep sending mail rather than crash; failing closed here prevents
// disclosure without breaking mail delivery.)
unsubscribeApp.get("/status", async (c: AppContext) => {
  const expected =
    (c.env as unknown as Record<string, any>).UNSUBSCRIBE_STATUS_TOKEN ??
    unsubscribeSecret(c);
  if (!expected) {
    return c.json(
      {
        error:
          "Suppression lookup is not configured (UNSUBSCRIBE_STATUS_TOKEN / " +
          "UNSUBSCRIBE_TOKEN unset).",
      },
      403
    );
  }
  const got = c.req.header("x-mail-unsubscribe-token");
  if (!got || !timingSafeEqual(String(expected), got)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const email = sanitizeEmail(c.req.query("email"));
  if (!email) return c.json({ error: "Invalid email" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT category, created_at FROM email_unsubscribes WHERE email = ?`,
  )
    .bind(email)
    .all<{ category: string; created_at: string }>();

  const categories = (rows.results || []).map((r) => r.category);
  return c.json({
    email,
    // `unsubscribedAll` must NEVER be derived from a stored "all" row: "all" is
    // no longer a writable category. Compute it from the concrete rows so a
    // client that checks this flag cannot be made to suppress security mail.
    unsubscribedAll: false,
    unsubscribedCategories: categories,
    securityCategoriesSuppressible: false,
  });
});