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
// Strict mode is opt-in via ALLOWED_ORIGINS (comma-separated) or SECURE_CORS=true.
// Cloud-IDE previews set NODE_ENV=production but serve the SPA from a dynamic
// URL, so we do NOT key strictness on NODE_ENV alone — that would break the
// dev workflow. Without explicit configuration we reflect any origin (the
// original, working behavior), still protected by auth + the write-time Origin
// guard below when strict mode is enabled.
const strictCors = process.env.SECURE_CORS === "true" || !!process.env.ALLOWED_ORIGINS;
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ??
  [
    "http://localhost:3003",
    "http://localhost:3004",
    "http://127.0.0.1:3003",
    "https://research-center.fit",
  ]
);

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
// Strict mode (set ALLOWED_ORIGINS / SECURE_CORS=true): only reflect explicitly
// allowed origins. Otherwise reflect any origin so the SPA can be served from
// any host/port (local dev, cloud-IDE preview) without breaking the cookie.
app.use(
  cors({
    origin: strictCors
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          if (allowedOrigins.includes(origin)) return cb(null, true);
          return cb(null, false);
        }
      : true,
    credentials: true,
  }),
);

// ---- CSRF-style guard: block cross-origin state-changing requests ---------
// (Enforced only in strict mode; otherwise CORS above reflects any origin.)
// Works with cross-origin credentialed cookies: the browser always sends
// `Origin` for cross-site POSTs, and CORS refuses to reflect responses to
// disallowed origins.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  if (!strictCors) return next();
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin / non-browser
  if (allowedOrigins.includes(origin)) return next();
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
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

export default app;
