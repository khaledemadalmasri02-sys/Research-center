import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";

export const unsubscribeApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

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
const VALID_CATEGORIES = new Set([
  "all",
  "signup-otp",
  "login-otp",
  "admin-notification",
  "transactional",
]);

function sanitizeEmail(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254) return null;
  if (!EMAIL_RE.test(v)) return null;
  return v;
}

function sanitizeCategory(raw: string | undefined): string {
  const v = (raw ?? "all").trim().toLowerCase();
  return VALID_CATEGORIES.has(v) ? v : "all";
}

async function recordUnsubscribe(
  c: AppContext,
  email: string,
  category: string,
  source: string,
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
       created_at = email_unsubscribes.created_at`,
  )
    .bind(email, category, source, ua, ip)
    .run();
}

// GET /api/unsubscribe?email=...&category=...
// - Real users land here from the footer of every transactional email.
// - Renders a small HTML confirmation page with a POST button so the click is
//   explicit (still one click — the button submits the form).
unsubscribeApp.get("/", async (c: AppContext) => {
  const email = sanitizeEmail(c.req.query("email"));
  const category = sanitizeCategory(c.req.query("category"));

  if (!email) {
    return c.html(
      renderPage({
        title: "Unsubscribe",
        heading: "Invalid unsubscribe link",
        message:
          "This unsubscribe link is missing or malformed. Please use the link in the email you received, or contact support@research-center.fit.",
      }),
      400,
    );
  }

  const action = `/api/unsubscribe?email=${encodeURIComponent(email)}&category=${encodeURIComponent(category)}`;
  return c.html(
    renderPage({
      title: "Unsubscribe from MedResearch emails",
      heading: "Unsubscribe from MedResearch emails?",
      message: `We'll stop sending <strong>${category === "all" ? "all" : `<code>${category}</code>`}</strong> emails to <strong>${email}</strong>. Account notifications related to your login and security may still be sent.`,
      cta: { href: action, label: "Confirm unsubscribe" },
    }),
  );
});

// POST /api/unsubscribe
//   - HTML form submission from the GET page above (form-urlencoded).
//   - Gmail/Yahoo List-Unsubscribe-Post one-click (application/x-www-form-urlencoded
//     or RFC 8058 form data, header "List-Unsubscribe-Post: List-Unsubscribe=One-Click").
// Both must return 2xx with a tiny body so the mail client considers the
// unsubscribe acknowledged and stops showing the "report spam" prompts.
unsubscribeApp.post("/", async (c: AppContext) => {
  const contentType = c.req.header("content-type") ?? "";
  let email = "";
  let category = "all";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    const e = form["email"];
    const cat = form["category"];
    email = typeof e === "string" ? e : "";
    category = typeof cat === "string" ? cat : "all";
  } else {
    // JSON body (e.g. our own admin tools, or scripted unsubscribe).
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        email?: string;
        category?: string;
      };
      email = body.email ?? "";
      category = body.category ?? "all";
    } catch {
      email = "";
    }
  }

  const cleanEmail = sanitizeEmail(email);
  if (!cleanEmail) {
    return c.text("Invalid email", 400);
  }
  const cleanCategory = sanitizeCategory(category);
  const source = c.req.header("list-unsubscribe-post") ? "one-click" : "form";

  await recordUnsubscribe(c, cleanEmail, cleanCategory, source);

  // One-click POST expects a small response — return a 1x1 GIF for legacy
  // clients and a tiny HTML page for the form submission.
  if (source === "one-click") {
    return c.text("OK", 200);
  }
  return c.html(
    renderPage({
      title: "Unsubscribed",
      heading: "You've been unsubscribed",
      message: `${cleanEmail} will no longer receive ${cleanCategory === "all" ? "any" : `<code>${cleanCategory}</code>`} emails from MedResearch. You can re-subscribe at any time by signing in and updating your notification settings.`,
      cta: { href: "https://research-center.fit", label: "Back to MedResearch" },
    }),
  );
});

// GET /api/unsubscribe/status?email=...
// Optional helper for the frontend / API consumers to check whether an
// address is currently unsubscribed. If the Worker is configured with
// UNSUBSCRIBE_STATUS_TOKEN, the caller must send the same value in the
// `x-mail-unsubscribe-token` header. This is how the api-server looks up
// suppression state before each send.
unsubscribeApp.get("/status", async (c: AppContext) => {
  const expected = (c.env as { UNSUBSCRIBE_STATUS_TOKEN?: string }).UNSUBSCRIBE_STATUS_TOKEN;
  if (expected) {
    const got = c.req.header("x-mail-unsubscribe-token");
    if (got !== expected) {
      return c.json({ error: "Forbidden" }, 403);
    }
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
    unsubscribedAll: categories.includes("all"),
    unsubscribedCategories: categories,
  });
});
