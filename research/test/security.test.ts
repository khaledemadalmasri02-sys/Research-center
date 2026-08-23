import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ssrfCheck, csrfGuard } from "../src/lib/security";
import type { AppContext } from "../src/lib/env";

describe("ssrfCheck (pure)", () => {
  it("blocks cloud metadata + private hosts", () => {
    expect(ssrfCheck("http://169.254.169.254/latest").ok).toBe(false);
    expect(ssrfCheck("http://localhost/").ok).toBe(false);
    expect(ssrfCheck("http://10.0.0.5/x").ok).toBe(false);
    expect(ssrfCheck("http://192.168.1.1/").ok).toBe(false);
    expect(ssrfCheck("http://127.0.0.1/").ok).toBe(false);
    expect(ssrfCheck("http://[::1]/").ok).toBe(false);
    expect(ssrfCheck("http://[fd00::1]/").ok).toBe(false);
  });

  it("blocks non-http(s) schemes", () => {
    expect(ssrfCheck("ftp://example.com/").ok).toBe(false);
    expect(ssrfCheck("file:///etc/passwd").ok).toBe(false);
  });

  it("allows public http(s) URLs", () => {
    expect(ssrfCheck("https://example.com/path").ok).toBe(true);
    expect(ssrfCheck("http://8.8.8.8/").ok).toBe(true);
  });

  it("rejects malformed URLs", () => {
    expect(ssrfCheck("not a url").ok).toBe(false);
  });
});

describe("csrfGuard middleware", () => {
  function makeApp() {
    const app = new Hono<{ Bindings: any; Variables: any }>();
    app.use("*", (c, next) => csrfGuard(c as unknown as AppContext, next));
    app.post("/x", (c) => c.json({ ok: true }));
    app.get("/x", (c) => c.json({ ok: true }));
    return app;
  }

  it("blocks state-changing requests without a matching token", async () => {
    const res = await makeApp().request("/x", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("allows when cookie token matches header token", async () => {
    const res = await makeApp().request("/x", {
      method: "POST",
      headers: { Cookie: "csrf=abc123", "X-CSRF-Token": "abc123" },
    });
    expect(res.status).toBe(200);
  });

  it("allows Bearer/API-token requests (exempt)", async () => {
    const res = await makeApp().request("/x", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
  });

  it("allows safe (GET) requests without a token", async () => {
    const res = await makeApp().request("/x", { method: "GET" });
    expect(res.status).toBe(200);
  });
});
