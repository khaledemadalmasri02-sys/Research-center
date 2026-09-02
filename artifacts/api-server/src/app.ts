import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const PgSession = connectPgSimple(session);

const app: Express = express();

// Trust the upstream reverse proxy so secure session cookies work behind it.
app.set("trust proxy", 1);
// Don't advertise the framework.
app.disable("x-powered-by");

// ---- Allowed origins (CORS + CSRF) -----------------------------------------
// CORS policy is enforced at the api-server, but most production traffic flows
// through the Cloudflare Worker which rewrites the upstream `Origin` header to
// the api-server's own base URL before forwarding (see
// research/src/index.ts:proxyToBackend). That means the api-server's CORS
// check fires only for direct browser→api-server traffic (local dev, health
// checks from non-browser clients). It is still meaningful to lock down by
// default — a misconfigured local proxy or a malicious origin that has
// resolved the api-server's origin must not be able to issue credentialed
// cross-site requests.
//
// Modes (resolved in priority order):
//   1. ALLOWED_ORIGINS — comma-separated allowlist. Enables strict mode.
//   2. SECURE_CORS=allow-any — explicit escape hatch for cloud-IDE dev URLs
//      that change every preview. Do not use in production.
//   3. NODE_ENV=production — refuse to start unless (1) or (2) is set. Fails
//      closed. Production must be explicit.
//   4. NODE_ENV=development — permissive dev allowlist covering the SPA on
//      3003/3004 and 127.0.0.1. Strict mode is still ON so the Origin-guard
//      below rejects writes from anything else.
const env = process.env.NODE_ENV;
const rawAllowed = process.env.ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const secureCors = process.env.SECURE_CORS;

if (env === "production" && !rawAllowed?.length && secureCors !== "allow-any") {
  throw new Error(
    "Refusing to start: production requires ALLOWED_ORIGINS or SECURE_CORS=allow-any. " +
      "Set ALLOWED_ORIGINS to a comma-separated list of allowed origins.",
  );
}

const allowAny = secureCors === "allow-any";
const strictCors = allowAny || !!rawAllowed?.length;
const allowedOrigins =
  rawAllowed ??
  (allowAny
    ? null
    : [
        "http://localhost:3000",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3003",
        "http://127.0.0.1:3004",
      ]);

// ---- Security headers (helmet-free, dependency-light) ----------------------
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  // API-only policy: nothing can frame or load this origin as a subresource.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
});

// ---- CORS ----------------------------------------------------------------
// Strict mode is now ON by default — see the policy block above. The escape
// hatch is `SECURE_CORS=allow-any` (or `ALLOWED_ORIGINS=*` is rejected because
// it would defeat the purpose; use the explicit env name).
app.use(
  cors({
    origin: allowAny
      ? true
      : (origin, cb) => {
          // Same-origin / non-browser (curl, server-to-server) — no Origin header.
          if (!origin) return cb(null, true);
          if (allowedOrigins && allowedOrigins.includes(origin)) return cb(null, true);
          return cb(null, false);
        },
    credentials: true,
  }),
);

// ---- CSRF-style guard: block cross-origin state-changing requests ---------
// Always enforced (not gated on strictCors) so that any future regression of
// the CORS allowlist still blocks cross-origin writes. Safe methods and
// same-origin writes pass.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin / non-browser
  if (allowAny) return next();
  if (allowedOrigins && allowedOrigins.includes(origin)) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    /* fall through to deny */
  }
  res.status(403).json({ error: "Cross-origin request forbidden" });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
// ---- Body parsers (P1.3) ----------------------------------------------------
// The previous default of 50 MB JSON was a DoS amplification vector: an
// unauthenticated client could pin a worker by uploading 50 MB of JSON
// and force the server to allocate buffers. 1 MB is the right size for
// the api-server's actual JSON payloads (most API responses are well
// under 100 KB; the analysis endpoints do their own multer upload which
// is rate-limited separately).
//
// Large payloads have their own dedicated paths:
// - /api/storage/uploads/request-url  →  presigned URL, no body
// - /api/storage/upload-file          →  multer (configured in storage.ts)
// - /api/analysis/datasets            →  multer (configured in analysis.ts)
// - /api/tour-config                  →  express.raw (80 MB, see route)
//
// Allow override via env for one-off debug cases. Bumping this without
// also raising the per-IP rate limit on /api/storage/* would re-open the
// DoS vector; if you need to raise this in production, also raise the
// upload rate limit.
const jsonBodyLimit = process.env.JSON_BODY_LIMIT ?? "1mb";
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}

// ---- Session cookie hardening (P1.7) ---------------------------------------
// `SameSite=Lax` is the new default. The api-server now only ever sees
// same-origin requests (the Cloudflare Worker rewrites `Origin` to the
// api-server's own base URL before forwarding, see
// research/src/index.ts:proxyToBackend), so we no longer need `SameSite=None`
// for the cross-origin SPA case. `Lax` keeps the cookie attached on
// top-level navigations and on same-site requests, which is what we
// want for a session — and what stops a malicious site from triggering
// a state-changing request with the cookie attached.
//
// Admin deployments can opt into `SameSite=Strict` via
// SESSION_COOKIE_SAMESITE to defend against the subdomain phishing
// case (admin opens a malicious page on a sibling subdomain). The
// `__Host-` cookie-name prefix is not used here because the cookie
// needs to share between apex and `www.` (the Worker serves both as
// canonical), and the `__Host-` prefix forbids the `Domain` attribute
// that sharing requires. We rely on SameSite + the Origin guard
// (above) + Secure for protection.
const sessionSameSite = ((): "lax" | "strict" | "none" => {
  const v = (process.env.SESSION_COOKIE_SAMESITE ?? "lax").toLowerCase();
  if (v === "strict" || v === "none") return v;
  return "lax";
})();
const isProduction = process.env.NODE_ENV === "production";

app.use(
  session({
    // Renamed away from the default `connect.sid` to drop stale cookies left
    // behind by earlier deployments/secrets. Old `connect.sid` cookies can
    // coexist with a new one (different name scope) and shadow a valid session
    // when the browser sends both; a fresh name gives every client a single,
    // clean session cookie.
    name: "rc_sid",
    store: new PgSession({
      pool,
      createTableIfMissing: false, // table is created at startup in index.ts
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Secure whenever the request is HTTPS. We trust the `X-Forwarded-Proto`
      // header because the Worker sets it; the upstream proxy is
      // Cloudflare. For local dev, http://localhost still works.
      secure: isProduction || process.env.FORCE_SECURE_COOKIE === "true",
      sameSite: sessionSameSite,
      // Share the session across the apex and www hosts (the Worker serves
      // both as canonical), so a login on one works on the other.
      domain:
        process.env.SESSION_COOKIE_DOMAIN ||
        (isProduction ? ".research-center.fit" : undefined),
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

export default app;
