import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import cors from "cors";

// Mirror the CORS + Origin-guard setup from src/app.ts. We re-declare it here
// (instead of importing) because the production app boots the session store,
// the pool, and pino-http — too much for a unit test. The behaviour under test
// is the policy, not the app wiring.
function buildApp(opts: {
  allowed?: string[];
  secureCors?: string;
  env?: string;
}): express.Express {
  const env = opts.env ?? "development";
  if (
    env === "production" &&
    !opts.allowed?.length &&
    opts.secureCors !== "allow-any"
  ) {
    throw new Error(
      "Refusing to start: production requires ALLOWED_ORIGINS or SECURE_CORS=allow-any. " +
        "Set ALLOWED_ORIGINS to a comma-separated list of allowed origins.",
    );
  }

  const allowAny = opts.secureCors === "allow-any";
  const allowedOrigins =
    opts.allowed ??
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

  const app = express();
  app.use(
    cors({
      origin: allowAny
        ? true
        : (origin, cb) => {
            if (!origin) return cb(null, true);
            if (
              allowedOrigins &&
              allowedOrigins.includes(origin)
            )
              return cb(null, true);
            return cb(null, false);
          },
      credentials: true,
    }),
  );

  const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
  app.use((req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (allowAny) return next();
    if (allowedOrigins && allowedOrigins.includes(origin)) return next();
    try {
      if (new URL(origin).host === req.headers.host) return next();
    } catch {
      /* fall through */
    }
    res.status(403).json({ error: "Cross-origin request forbidden" });
  });

  app.post("/api/echo", (_req, res) => res.json({ ok: true }));
  app.get("/api/echo", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("api-server CORS / Origin guard (P0.4)", () => {
  describe("development mode (NODE_ENV=development, no env vars)", () => {
    const app = buildApp({ env: "development" });

    it("allows POST from an allowed origin", async () => {
      const res = await request(app)
        .post("/api/echo")
        .set("Origin", "http://localhost:3004")
        .set("Host", "localhost:3004");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("blocks POST from a disallowed origin", async () => {
      const res = await request(app)
        .post("/api/echo")
        .set("Origin", "http://evil.example")
        .set("Host", "localhost:3004");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Cross-origin request forbidden" });
    });

    it("allows GET from a disallowed origin (safe method)", async () => {
      const res = await request(app)
        .get("/api/echo")
        .set("Origin", "http://evil.example")
        .set("Host", "localhost:3004");
      expect(res.status).toBe(200);
    });

    it("allows POST with no Origin (same-origin / non-browser)", async () => {
      const res = await request(app)
        .post("/api/echo")
        .set("Host", "localhost:3004");
      expect(res.status).toBe(200);
    });
  });

  describe("production mode", () => {
    it("refuses to start without ALLOWED_ORIGINS", () => {
      expect(() => buildApp({ env: "production" })).toThrow(
        /ALLOWED_ORIGINS/,
      );
    });

    it("allows POST from ALLOWED_ORIGINS", async () => {
      const app = buildApp({
        env: "production",
        allowed: ["https://research-center.fit"],
      });
      const res = await request(app)
        .post("/api/echo")
        .set("Origin", "https://research-center.fit")
        .set("Host", "research-center.fit");
      expect(res.status).toBe(200);
    });

    it("blocks POST from a non-allowed origin", async () => {
      const app = buildApp({
        env: "production",
        allowed: ["https://research-center.fit"],
      });
      const res = await request(app)
        .post("/api/echo")
        .set("Origin", "https://evil.example")
        .set("Host", "research-center.fit");
      expect(res.status).toBe(403);
    });

    it("SECURE_CORS=allow-any permits any POST (escape hatch)", async () => {
      const app = buildApp({ env: "production", secureCors: "allow-any" });
      const res = await request(app)
        .post("/api/echo")
        .set("Origin", "https://random-cloud-ide.preview")
        .set("Host", "localhost:3004");
      expect(res.status).toBe(200);
    });
  });
});