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
import { issueCsrfToken, csrfGuard } from "./lib/security";
import type { AppBindings, AppVariables, AppContext } from "./lib/env";

// This Worker now acts as a thin edge layer for research-center.fit:
//   - static SPA assets are served by Cloudflare Assets (run_worker_first=/api/*)
//   - every /api/* request is either handled by the D1-backed clinical route
//     modules mounted below, or reverse-proxied to the Postgres-backed
//     api-server (exposed locally via a cloudflared tunnel). This makes the
//     FULL feature set (records, signup, users, admin, feedback, patients)
//     available at the domain, sourced from the api-server rather than D1.
const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({ strict: false });

// Inject a self-referential, per-host canonical <link> into every HTML document
// so both research-center.fit and www.research-center.fit are independently
// indexable by Google (no cross-host redirect / no duplicate-content penalty).
const CANONICAL_HOSTS = new Set([
  "research-center.fit",
  "www.research-center.fit",
]);

// ===========================================================================
// KNOWN ISSUE — D1 / Postgres SPLIT BRAIN. Read before touching clinical routes.
// ===========================================================================
// This Worker mounts two independent stores behind one `/api/*` prefix:
//
//   * The D1 (SQLite) clinical/compliance routes below — consent, coding,
//     cohort, deidentify, dicom, gdpr, ml, validation, ingest, search,
//     studies, export, reports, unsubscribe — read and write D1 tables such as
//     `patients`, `dicom_images`, `consents`, `records`, `pseudonyms`.
//   * Everything else under `/api/*` is proxied to the Express api-server,
//     which is backed by POSTGRES.
//
// `artifacts/research-data/src/pages/*` create patients and records through the
// proxy, so they land in Postgres. NOTHING in the product ever writes the D1
// `patients` table. In production that table is therefore EMPTY, and every D1
// clinical route is reading rows that do not exist.
//
// Consequences an operator must expect:
//   * List endpoints silently return `[]`; "0 patients" is an artefact of the
//     split brain, not a fact about the data.
//   * `/api/deidentify/export` now returns 409 rather than a 0-row CSV, so a
//     de-identification run cannot be filed as a successful (empty) one.
//   * `/api/gdpr/erasure/:id` clears D1, calls the api-server's
//     `DELETE /api/gdpr/erasure/:id` (added 2026-10, in
//     `artifacts/api-server/src/routes/gdpr.ts`) to clear the live Postgres
//     PHI, and deletes the patient's S3/R2 objects. It compares deleted counts
//     against pre-SELECT counts per store and returns `ok:false` + HTTP 500 +
//     a `pending_erasure` marker if ANY store is short, so a partial erasure can
//     never be filed as a complete one. It requires `ERASURE_SECRET` (falling
//     back to `INBOUND_EMAIL_SECRET`) on both sides; if that is unset the route
//     fails closed with 503 rather than silently under-erasing.
//   * `/api/cohort/*` returns 0 rows; an export of them is an empty CSV.
//
// THE FIX IS A DATA-LAYER MIGRATION, NOT A ROUTE CHANGE: either dual-write
// `patients` (and friends) into D1, or move these route modules to Postgres.
// It is deliberately NOT performed here — it needs a migration plan, a backfill
// and a rollback path. Until then, treat every D1 clinical response as
// unverified and prefer the proxied Postgres API for anything user-facing.
// ===========================================================================

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


// D1 schema bootstrap, run once per cold isolate (memoised inside
// lib/db-bootstrap.ts). Errors are LOGGED, not swallowed: the previous
// `catch { /* ignore */ }` made a failed bootstrap invisible while every
// downstream handler failed with an opaque "no such table".
//
// RECOMMENDED FOLLOW-UP (data-layer migration, deliberately not done here):
// the bootstrap issues ~69 sequential D1 statements (~14 kB of SQL) on every
// cold isolate. Move them into versioned `wrangler d1 migrations apply`
// migrations and replace this with a single `PRAGMA user_version` guard.
app.use("/api/*", async (c, next) => {
  try {
    await ensureSchema(c.env.DB);
  } catch (err) {
    console.error("[db-bootstrap] ensureSchema failed:", err);
  }
  await next();
});

// CSRF double-submit enforcement for the Worker's own D1-backed clinical routes.
//
// `csrfGuard` was DEFINED in lib/security.ts but never imported or registered,
// so no D1 mutation was protected at this layer. It is registered per mount
// below, immediately before each D1 sub-app.
//
// Deliberately NOT applied to the proxied `/api/*` catch-all: those routes are
// authenticated by the api-server's own `connect.sid` session, and requiring the
// Worker's separate `csrf` cookie there broke login (see the proxy comment).
// Proxied traffic is protected by the CANONICAL_HOSTS allow-list in
// proxyToBackend plus the api-server's own same-origin guard.
//
// `csrfGuard` skips GET/HEAD/OPTIONS and Bearer-token requests. That means NO
// state-changing endpoint may be a GET — see the deidentify/export note.
const D1_ROUTE_MOUNTS: Array<[string, typeof consentApp]> = [
  ["/api/consent", consentApp],
  ["/api/deidentify", deidentifyApp],
  ["/api/record-versions", recordVersionsApp],
  ["/api/record-verify", recordVerifyApp],
  ["/api/codings", codingApp],
  ["/api/cohort", cohortApp],
  ["/api/validation", validationApp],
  ["/api/dicom", dicomApp],
  ["/api/export", exportApp],
  ["/api/studies", studiesApp],
  ["/api/ml", mlApp],
  ["/api/reports", reportsApp],
  ["/api/gdpr", gdprApp],
  ["/api/ingest", ingestApp],
  ["/api/search", searchApp],
  ["/api/unsubscribe", unsubscribeApp],
];

// See the KNOWN ISSUE block above: these D1 tables are empty in production.
for (const [prefix, subApp] of D1_ROUTE_MOUNTS) {
  // Both the bare prefix and the wildcard, so a request to `/api/consent`
  // itself is covered as well as `/api/consent/versions`.
  app.use(prefix, csrfGuard);
  app.use(`${prefix}/*`, csrfGuard);
  app.route(prefix, subApp);
}
// /api/saved-views is handled by the Postgres-backed api-server (proxied below),
// so it shares the same session as the rest of the records feature.

// CSRF token issuance for session-cookie clients (double-submit pattern).
app.get("/api/csrf", (c: AppContext) => {
  const token = issueCsrfToken(c);
  return c.json({ csrfToken: token });
});

// Proxy to the Postgres-backed api-server.
//
// CSRF for proxied requests is enforced in TWO places now:
//
//  1. HERE (defence in depth). The browser->Worker hop is the only hop a
//     cross-site attacker controls, so the request is checked against
//     CANONICAL_HOSTS before it is forwarded.
//  2. AT THE API-SERVER, which has its own same-origin guard
//     (artifacts/api-server/src/app.ts:140-158) comparing the forwarded
//     `Origin` against its ALLOWED_ORIGINS / request host.
//
// Previously this function did `headers.set("origin", base)`, OVERWRITING the
// client's Origin with the Worker's own backend URL. That made the api-server's
// guard unconditionally pass, for every host, always: any site on the internet
// could POST /api/* through this Worker with a logged-in victim's cookies.
// The overwrite is removed — the client's Origin is now passed through
// untouched, and deleted entirely when absent (a same-origin navigation from an
// older browser that omits Origin still works, and the api-server treats a
// missing Origin as same-origin).
async function proxyToBackend(c: AppContext): Promise<Response> {
  const base = (c.env.API_BACKEND_URL || "").replace(/\/+$/, "");
  if (!base) {
    return c.json({ error: "API_BACKEND_URL is not configured" }, 500);
  }

  const url = new URL(c.req.url);

  // Defence-in-depth origin allow-list. Only reject a request that CARRIES an
  // Origin; an absent Origin means a same-origin form post / curl / server-side
  // call and is left alone (the api-server applies the same rule).
  const clientOrigin = c.req.header("origin");
  if (clientOrigin) {
    let originHost = "";
    try {
      originHost = new URL(clientOrigin).host;
    } catch {
      return c.json({ error: "Cross-origin request forbidden" }, 403);
    }
    if (!CANONICAL_HOSTS.has(originHost)) {
      return c.json({ error: "Cross-origin request forbidden" }, 403);
    }
  }

  const target = `${base}${url.pathname}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  // Preserve the client's Origin so the api-server's guard can actually
  // evaluate it. Never synthesise one.
  if (clientOrigin) headers.set("origin", clientOrigin);
  else headers.delete("origin");
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
// cookie). The Worker does NOT apply its own `csrf` double-submit cookie here:
// it is a different cookie from the api-server's session, and requiring it broke
// login. CSRF for these routes is enforced by (a) the CANONICAL_HOSTS allow-list
// in proxyToBackend and (b) the api-server's own same-origin guard, which now
// sees the real client Origin because we no longer overwrite it.
app.all("/api/*", async (c: AppContext) => {
  return proxyToBackend(c);
});

// Non-API requests are served by Static Assets (SPA). Because of
// run_worker_first = ["/api/*"], this handler is only reached for a non-API
// path that the assets layer did not satisfy; surface a 404.
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
