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
// JSON bodies capped; large uploads should use streaming (multer) in future.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}

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
      secure: process.env.NODE_ENV === "production",
      // "none" is required so the cross-origin SPA's credentialed requests
      // still carry the session cookie. CSRF is mitigated by the Origin guard
      // above (cross-site POSTs from disallowed origins are rejected) plus the
      // CORS allowlist, not by sameSite.
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      // Share the session across the apex and www hosts (the Worker serves
      // both as canonical), so a login on one works on the other. With
      // SameSite=None + Secure this is safe; X-Forwarded-Proto is forwarded by
      // the Worker so the Secure cookie is actually issued.
      domain: process.env.SESSION_COOKIE_DOMAIN || (process.env.NODE_ENV === "production" ? ".research-center.fit" : undefined),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

export default app;
