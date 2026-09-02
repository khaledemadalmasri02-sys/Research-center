// Tests for P1.7 — CSRF/cookie hardening env vars and the default Lax policy.
import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";

// These tests build a tiny Express app that mirrors the production
// cookie/sameSite logic from artifacts/api-server/src/app.ts. We don't
// import app.ts directly because that file boots the full session
// store, CORS, and routes — way more than we need here.

function buildApp(
  env: { NODE_ENV?: string; SESSION_COOKIE_SAMESITE?: string } = {},
  opts: { https?: boolean } = {},
) {
  const proc = { ...process.env, ...env };
  const isProduction = proc.NODE_ENV === "production";
  const v = (proc.SESSION_COOKIE_SAMESITE ?? "lax").toLowerCase();
  const sameSite: "lax" | "strict" | "none" =
    v === "strict" || v === "none" ? (v as "strict" | "none") : "lax";

  const app = express();
  // Trust the X-Forwarded-Proto header so the test can simulate HTTPS
  // by setting it on the request. The production app does the same
  // (see app.ts) and the Worker sets X-Forwarded-Proto: https.
  app.set("trust proxy", true);
  app.use(cookieParser());
  app.use(
    session({
      name: "rc_sid",
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      store: new session.MemoryStore(),
      cookie: {
        httpOnly: true,
        secure: isProduction || proc.FORCE_SECURE_COOKIE === "true",
        sameSite,
        domain: proc.SESSION_COOKIE_DOMAIN ||
          (isProduction ? ".research-center.fit" : undefined) || undefined,
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.get("/login", (req, res) => {
    req.session.userId = 1;
    res.json({ ok: true });
  });
  app.get("/me", (req, res) => {
    res.json({ userId: req.session.userId ?? null });
  });
  return app;
}

// Wrap a request so it always carries X-Forwarded-Proto: https when
// the test is simulating a production environment. This is the same
// header the production Worker sets on every proxied request.
function httpsGet<T extends { get: Function }>(app: T, path: string) {
  return app.get(path).set("X-Forwarded-Proto", "https");
}

describe("P1.7 — session cookie hardening", () => {
  it("defaults to SameSite=Lax in development", async () => {
    const app = buildApp({ NODE_ENV: "development" });
    const res = await request(app).get("/login");
    expect(res.status).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/SameSite=Lax/);
  });

  it("uses SameSite=Lax in production (no longer None)", async () => {
    const app = buildApp({ NODE_ENV: "production" });
    const res = await httpsGet(request(app), "/login");
    expect(res.status).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).not.toMatch(/SameSite=None/);
  });

  it("respects SESSION_COOKIE_SAMESITE=strict for admin deployments", async () => {
    const app = buildApp({
      NODE_ENV: "production",
      SESSION_COOKIE_SAMESITE: "strict",
    });
    const res = await httpsGet(request(app), "/login");
    expect(res.status).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/SameSite=Strict/);
  });

  it("preserves SameSite=None when explicitly requested (legacy escape hatch)", async () => {
    const app = buildApp({
      NODE_ENV: "production",
      SESSION_COOKIE_SAMESITE: "none",
    });
    const res = await httpsGet(request(app), "/login");
    expect(res.status).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/SameSite=None/);
  });

  it("rejects unknown SESSION_COOKIE_SAMESITE values and falls back to Lax", async () => {
    const app = buildApp({
      NODE_ENV: "production",
      SESSION_COOKIE_SAMESITE: "garbage",
    });
    const res = await httpsGet(request(app), "/login");
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(/SameSite=Lax/);
  });

  it("shares the session across apex and www via the .research-center.fit domain", async () => {
    const app = buildApp({ NODE_ENV: "production" });
    const res = await httpsGet(request(app), "/login");
    expect(res.status).toBe(200);
    const sc = String(res.headers["set-cookie"]);
    // The cookie must have Domain=.research-center.fit so the browser
    // sends it to both apex and www. (This is what allows a login on
    // one host to be valid on the other.)
    expect(sc).toMatch(/Domain=\.research-center\.fit/);

    // The cookie also has Path=/ so any path on those hosts works.
    expect(sc).toMatch(/Path=\//);
  });

  it("does not set a domain in dev (cookie is host-only)", async () => {
    const app = buildApp({ NODE_ENV: "development" });
    const res = await request(app).get("/login");
    const sc = String(res.headers["set-cookie"]);
    expect(sc).not.toMatch(/Domain=/);
  });

  it("cookie is HttpOnly in both dev and prod", async () => {
    for (const env of ["development", "production"]) {
      const app = buildApp({ NODE_ENV: env });
      const res = env === "production"
        ? await httpsGet(request(app), "/login")
        : await request(app).get("/login");
      const sc = String(res.headers["set-cookie"]);
      expect(sc).toMatch(/HttpOnly/);
    }
  });

  it("cookie is Secure in production, not in dev", async () => {
    const devApp = buildApp({ NODE_ENV: "development" });
    const devRes = await request(devApp).get("/login");
    expect(String(devRes.headers["set-cookie"])).not.toMatch(/;\s*Secure/);

    const prodApp = buildApp({ NODE_ENV: "production" });
    const prodRes = await httpsGet(request(prodApp), "/login");
    expect(String(prodRes.headers["set-cookie"])).toMatch(/;\s*Secure/);
  });
});
