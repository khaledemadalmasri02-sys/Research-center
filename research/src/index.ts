import { Hono } from "hono";
import PostalMime from "postal-mime";
import { ensureSchema } from "./lib/db-bootstrap";
import { consentApp } from "./routes/consent";
import { deidentifyApp } from "./routes/deidentify";
import { recordVersionsApp } from "./routes/recordVersions";
import { recordVerifyApp } from "./routes/recordVerify";
import { codingApp } from "./routes/coding";
import { cohortApp } from "./routes/cohort";
import { validationApp } from "./routes/validation";
import { dicomApp } from "./routes/dicom";
import { exportApp } from "./routes/export";
import { studiesApp } from "./routes/studies";
import { mlApp } from "./routes/ml";
import { reportsApp } from "./routes/reports";
import { gdprApp } from "./routes/gdpr";
import { unsubscribeApp } from "./routes/unsubscribe";
import { ingestApp } from "./routes/ingest";
import { searchApp } from "./routes/search";
import { issueCsrfToken } from "./lib/security";
import type { AppBindings, AppVariables, AppContext } from "./lib/env";

// This Worker now acts as a thin edge layer for research-center.fit:
//   - static SPA assets are served by Cloudflare Assets (run_worker_first=/api/*)
//   - every /api/* request is reverse-proxied to the Postgres-backed api-server
//     (exposed locally via a cloudflared tunnel). This makes the FULL feature
//     set (records, signup, users, admin, feedback, patients) available at the
//     domain, sourced from the api-server rather than D1.
const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({ strict: false });

// Inject a self-referential, per-host canonical <link> into every HTML document
// so both research-center.fit and www.research-center.fit are independently
// indexable by Google (no cross-host redirect / no duplicate-content penalty).
const CANONICAL_HOSTS = new Set([
  "research-center.fit",
  "www.research-center.fit",
]);

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();

  const assets = c.env.ASSETS;
  if (!assets) return next();

  const res = await assets.fetch(c.req.url);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return res;

  const url = new URL(c.req.url);
  if (!CANONICAL_HOSTS.has(url.host)) return res;

  let body = await res.text();
  const canonical = `${url.origin}${url.pathname}`;
  if (!body.includes('rel="canonical"')) {
    body = body.replace("</head>", `  <link rel="canonical" href="${canonical}" />\n</head>`);
  }

  // Host-aware WebSite structured data so Google associates the site with the
  // "research center" / "research" topics (the hyphenated domain already reads
  // as the phrase, and this reinforces it for both hosts).
  if (!body.includes('type="application/ld+json"')) {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Research Center",
      url: url.origin + "/",
      description:
        "Research Center for patient research: secure radiology patient data collection, medical image storage, and AI prediction tracking.",
      sameAs: [
        "https://research-center.fit/",
        "https://www.research-center.fit/",
      ],
    };
    const script = `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n`;
    body = body.replace("</head>", `${script}</head>`);
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(body, { status: res.status, headers });
});


// directly from D1 so they work even when API_BACKEND_URL is not configured.
// Schema is bootstrapped idempotently on first request.
app.use("/api/*", async (c, next) => {
  try {
    await ensureSchema(c.env.DB);
  } catch {
    /* ignore bootstrap failures; handlers will surface DB errors */
  }
  await next();
});

app.route("/api/consent", consentApp);
app.route("/api/deidentify", deidentifyApp);
app.route("/api/record-versions", recordVersionsApp);
app.route("/api/record-verify", recordVerifyApp);
app.route("/api/codings", codingApp);
app.route("/api/cohort", cohortApp);
app.route("/api/validation", validationApp);
app.route("/api/dicom", dicomApp);
app.route("/api/export", exportApp);
app.route("/api/studies", studiesApp);
app.route("/api/ml", mlApp);
app.route("/api/reports", reportsApp);
app.route("/api/gdpr", gdprApp);
app.route("/api/ingest", ingestApp);
app.route("/api/search", searchApp);
app.route("/api/unsubscribe", unsubscribeApp);
// /api/saved-views is handled by the Postgres-backed api-server (proxied below),
// so it shares the same session as the rest of the records feature.

// CSRF token issuance for session-cookie clients (double-submit pattern).
app.get("/api/csrf", (c: AppContext) => {
  const token = issueCsrfToken(c);
  return c.json({ csrfToken: token });
});

// Proxy to the Postgres-backed api-server. CSRF-protected for session-cookie
// clients; Bearer/API-token requests are exempt (see csrfGuard).
async function proxyToBackend(c: AppContext): Promise<Response> {
  const base = (c.env.API_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    return c.json({ error: "API_BACKEND_URL is not configured" }, 500);
  }

  const url = new URL(c.req.url);
  const target = `${base}${url.pathname}${url.search}`;

  // The Worker is a reverse proxy to the api-server. Present the backend's own
  // origin (not the front-end's, e.g. https://www.research-center.fit) so the
  // api-server's same-origin / allowed-origin CSRF guard accepts requests from
  // any front-end hostname without enumerating each in ALLOWED_ORIGINS.
  const headers = new Headers(c.req.raw.headers);
  headers.set("origin", base);
  const init: RequestInit = {
    method: c.req.method,
    headers,
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = c.req.raw.body;
  }
  const req = new Request(target, init);
  const cookie = c.req.header("cookie");
  if (cookie) req.headers.set("cookie", cookie);
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) req.headers.set("X-Forwarded-For", cfIp);

  // The browser→Worker leg is always HTTPS (Cloudflare terminates TLS); the
  // Worker→api-server leg is the internal/private hop. Tell the api-server the
  // original request was secure so it issues the `Secure` session cookie —
  // express-session drops Set-Cookie when X-Forwarded-Proto isn't https (with
  // `trust proxy` enabled), which otherwise silently breaks login.
  req.headers.set("X-Forwarded-Proto", "https");
  const host = c.req.header("host");
  if (host) req.headers.set("X-Forwarded-Host", host);

  const res = await fetch(req);
  return res;
}

// Proxy to the Postgres-backed api-server. These routes are owned by the
// api-server, which is the session authority (it issues the `connect.sid`
// cookie). CSRF is therefore enforced at the api-server, not here — applying the
// Worker's separate CSRF cookie to these proxied requests only broke auth. The
// Worker's own D1-backed routes above remain the Worker's responsibility.
app.all("/api/*", async (c: AppContext) => {
  return proxyToBackend(c);
});

// Non-API requests are served by Static Assets (SPA). Because of
// run_worker_first = ["/api/*"], this handler is only reached for unmatched
// API routes; in that case we surface a 404.
app.all("*", async (c: AppContext) => {
  const assets = c.env.ASSETS;
  if (assets) {
    const res = await assets.fetch(c.req.url);
    if (res) return res;
  }
  return new Response("Not Found", { status: 404 });
});

// ---- Inbound email (Cloudflare Email Routing) ------------------------------
// Receives messages addressed to the domain (e.g. support@research-center.fit),
// parses them, and forwards them to the Postgres-backed api-server which stores
// them and notifies admins. Requires an Email Routing rule that targets this
// Worker, plus the INBOUND_EMAIL_SECRET Worker secret matching the api-server's
// INBOUND_EMAIL_SECRET env var.
async function handleEmail(
  message: ForwardableEmailMessage,
  env: AppBindings,
): Promise<void> {
  const backend = (env.API_BACKEND_URL || "").replace(/\/+$/, "");
  if (!backend) {
    message.setReject("Backend not configured");
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);

  const res = await fetch(`${backend}/api/inbound-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-inbound-email-secret": env.INBOUND_EMAIL_SECRET ?? "",
    },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.html ?? null,
      messageId: message.headers.get("message-id") ?? null,
      inReplyTo: message.headers.get("in-reply-to") ?? null,
    }),
  });

  if (!res.ok) {
    // Backend storage failed — bounce so the sender knows delivery didn't happen.
    message.setReject(`Backend rejected inbound email (HTTP ${res.status})`);
  }
}

export default {
  fetch: (request: Request, env: AppBindings, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  email: handleEmail,
} satisfies ExportedHandler<AppBindings>;
