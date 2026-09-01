import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { unsubscribeApp } from "../src/routes/unsubscribe";
import { FakeD1 } from "./helpers";
import type { AppBindings, AppVariables } from "../src/lib/env";

function makeEnv(db: FakeD1): AppBindings {
  return {
    DB: db as any,
    SESSIONS: {} as any,
    ASSETS: { fetch: async () => new Response("") },
    APP_USERNAME: "x",
    APP_PASSWORD_HASH: "x",
    SESSION_SECRET: "x",
  } as any;
}

function makeApp() {
  return new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({ strict: false })
    .route("/api/unsubscribe", unsubscribeApp);
}

describe("unsubscribe route", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: AppBindings;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
  });

  it("rejects GET with missing email", async () => {
    const res = await app.request("/api/unsubscribe?category=all", { method: "GET" }, env);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid unsubscribe link/);
  });

  it("rejects GET with malformed email", async () => {
    const res = await app.request("/api/unsubscribe?email=not-an-email", { method: "GET" }, env);
    expect(res.status).toBe(400);
  });

  it("GET renders a confirmation page for a valid email", async () => {
    const res = await app.request(
      "/api/unsubscribe?email=user%40example.com&category=login-otp",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Unsubscribe from MedResearch/i);
    expect(html).toMatch(/Confirm unsubscribe/);
    expect(html).toMatch(/login-otp/);
  });

  it("POST without an email returns 400", async () => {
    const res = await app.request("/api/unsubscribe", { method: "POST" }, env);
    expect(res.status).toBe(400);
  });

  it("POST one-click (List-Unsubscribe-Post header) records and returns 200", async () => {
    const res = await app.request("/api/unsubscribe", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "list-unsubscribe-post": "List-Unsubscribe=One-Click",
      },
      body: "email=user%40example.com&category=login-otp",
    }, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toMatch(/INSERT INTO email_unsubscribes/);
    expect(db.calls[0].binds[0]).toBe("user@example.com");
    expect(db.calls[0].binds[1]).toBe("login-otp");
  });

  it("POST form submission records and renders a confirmation page", async () => {
    const res = await app.request("/api/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=user%40example.com&category=all",
    }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/You've been unsubscribed/);
  });

  it("POST normalises email and category", async () => {
    const res = await app.request("/api/unsubscribe", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "list-unsubscribe-post": "List-Unsubscribe=One-Click",
      },
      body: "email=USER%40Example.COM&category=NOTREAL",
    }, env);
    expect(res.status).toBe(200);
    expect(db.calls[0].binds[0]).toBe("user@example.com");
    expect(db.calls[0].binds[1]).toBe("all"); // unknown category falls back to "all"
  });

  it("GET /status returns the unsubscribed categories for an email", async () => {
    db.responder = (sql, _binds) => {
      if (sql.includes("FROM email_unsubscribes")) {
        return { results: [{ category: "login-otp" }, { category: "all" }] };
      }
      return {};
    };
    const res = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.unsubscribedAll).toBe(true);
    expect(body.unsubscribedCategories).toEqual(["login-otp", "all"]);
  });

  it("GET /status requires a matching token when UNSUBSCRIBE_STATUS_TOKEN is set", async () => {
    const envWithToken = { ...env, UNSUBSCRIBE_STATUS_TOKEN: "secret-123" } as any;
    // No token header -> 403
    const denied = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET" },
      envWithToken,
    );
    expect(denied.status).toBe(403);
    // Wrong token -> 403
    const wrong = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET", headers: { "x-mail-unsubscribe-token": "nope" } },
      envWithToken,
    );
    expect(wrong.status).toBe(403);
    // Correct token -> 200
    const ok = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET", headers: { "x-mail-unsubscribe-token": "secret-123" } },
      envWithToken,
    );
    expect(ok.status).toBe(200);
  });
});
