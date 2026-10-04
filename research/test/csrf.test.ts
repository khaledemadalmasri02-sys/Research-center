import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { csrfGuard, timingSafeEqual } from "../src/lib/security";
import { deidentifyApp } from "../src/routes/deidentify";
import { cohortApp } from "../src/routes/cohort";
import type { AppBindings, AppVariables, AppContext } from "../src/lib/env";
import { FakeD1 } from "./helpers";

// The D1 route handlers are exercised for real here (to prove the guard lets a
// valid request through and blocks an invalid one), so their auth dependency is
// stubbed to return "unauthenticated" — the handler then answers a clean 401
// instead of reaching for an undefined DB binding.
vi.mock("../src/lib/security", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAuthUser: vi.fn(async () => null),
    writeAudit: vi.fn(),
    canEdit: () => false,
    isAdmin: () => false,
  };
});

// ---------------------------------------------------------------------------
// W4 — CSRF: the guard must actually be wired, and mutating GETs must be gone.
// ---------------------------------------------------------------------------

describe("timingSafeEqual (pure)", () => {
  it("compares by value", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("csrfGuard rejects missing/mismatched tokens on a mutation", () => {
  function makeApp() {
    const app = new Hono<{ Bindings: any; Variables: any }>({ strict: false });
    app.use("/api/deidentify", csrfGuard);
    app.use("/api/deidentify/*", csrfGuard);
    app.use("/api/cohort", csrfGuard);
    app.use("/api/cohort/*", csrfGuard);
    app.route("/api/deidentify", deidentifyApp);
    app.route("/api/cohort", cohortApp);
    return app;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("403 when neither cookie nor header is present", async () => {
    const res = await makeApp().request("/api/deidentify/export", { method: "POST" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/CSRF token mismatch/);
  });

  it("403 when the cookie is present but the header is not", async () => {
    const res = await makeApp().request("/api/deidentify/export", {
      method: "POST",
      headers: { Cookie: "csrf=abc123" },
    });
    expect(res.status).toBe(403);
  });

  it("403 when the header is present but the cookie is not", async () => {
    const res = await makeApp().request("/api/deidentify/export", {
      method: "POST",
      headers: { "X-CSRF-Token": "abc123" },
    });
    expect(res.status).toBe(403);
  });

  it("403 when the tokens differ", async () => {
    const res = await makeApp().request("/api/deidentify/export", {
      method: "POST",
      headers: { Cookie: "csrf=abc123", "X-CSRF-Token": "zzz999" },
    });
    expect(res.status).toBe(403);
  });

  it("403 on a same-length near-miss (guards against the old === path being the only check)", async () => {
    const res = await makeApp().request("/api/cohort/export", {
      method: "POST",
      headers: { Cookie: "csrf=abcdefgh", "X-CSRF-Token": "abcdefgi" },
    });
    expect(res.status).toBe(403);
  });

  it("lets a matching double-submit through to the handler", async () => {
    const res = await makeApp().request("/api/cohort/export", {
      method: "POST",
      headers: { Cookie: "csrf=abc123", "X-CSRF-Token": "abc123" },
    });
    // The cohort handler runs and answers 401 (no auth stubbed), which proves
    // the guard let it through.
    expect(res.status).not.toBe(403);
  });

  it("exempts Bearer API-token requests", async () => {
    const res = await makeApp().request("/api/deidentify/export", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
    expect(res.status).not.toBe(403);
  });
});

describe("the deidentify export no longer responds to GET", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: AppBindings;

  function makeApp() {
    const a = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({ strict: false });
    a.route("/api/deidentify", deidentifyApp);
    return a;
  }

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = {
      DB: db as any,
      SESSIONS: {} as any,
      ASSETS: { fetch: async () => new Response("") },
      APP_USERNAME: "x",
      APP_PASSWORD_HASH: "",
      SESSION_SECRET: "s",
    } as any;
  });

  it("a cross-site GET navigation cannot write pseudonyms", async () => {
    // Exactly what an attacker embeds: <img src="…/api/deidentify/export?studyCode=evil">
    const res = await app.request(
      "https://research-center.fit/api/deidentify/export?studyCode=evil",
      {
        method: "GET",
        headers: {
          Cookie: "sessionId=abc",
          Origin: "https://evil.example",
          Referer: "https://evil.example/x",
        },
      },
      env
    );
    expect([404, 405, 401, 403]).toContain(res.status);
    expect(
      db.calls.some((c) => c.sql.includes("INSERT OR IGNORE INTO pseudonyms"))
    ).toBe(false);
    expect(
      db.calls.some((c) => c.sql.includes("INSERT INTO deid_jobs"))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// W4.1 — the proxy must PRESERVE the client's Origin and enforce an allow-list.
// This mirrors proxyToBackend() in src/index.ts, which cannot be imported
// directly because that module registers the whole Worker.
// ---------------------------------------------------------------------------

const CANONICAL_HOSTS = new Set(["research-center.fit", "www.research-center.fit"]);

interface ProxyResult {
  status: number;
  forwardedOrigin: string | null;
  target: string;
}

async function callProxy(
  req: Request,
  backend = "https://backend.internal"
): Promise<ProxyResult> {
  const url = new URL(req.url);
  let seen: { origin: string | null; target: string } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const r = input as Request;
    seen = { origin: r.headers.get("origin"), target: r.url };
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
  try {
    const clientOrigin = req.headers.get("origin");
    let originHost = "";
    if (clientOrigin) {
      try {
        originHost = new URL(clientOrigin).host;
      } catch {
        return { status: 403, forwardedOrigin: null, target: "" };
      }
      if (!CANONICAL_HOSTS.has(originHost)) {
        return { status: 403, forwardedOrigin: null, target: "" };
      }
    }
    const target = `${backend}${url.pathname}${url.search}`;
    const headers = new Headers(req.headers);
    if (clientOrigin) headers.set("origin", clientOrigin);
    else headers.delete("origin");
    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
      // Node/undici requires this for a streaming request body. The Workers
      // runtime streams request bodies natively and does not need it.
      (init as any).duplex = "half";
    }
    const res = await fetch(new Request(target, init));
    return { status: res.status, forwardedOrigin: seen!.origin, target: seen!.target };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("proxyToBackend Origin handling (W4.1)", () => {
  it("rejects a cross-origin request from an attacker host", async () => {
    const res = await callProxy(
      new Request("https://research-center.fit/api/records", {
        method: "POST",
        headers: { Origin: "https://evil.example", Cookie: "connect.sid=victim" },
        body: "{}",
      })
    );
    expect(res.status).toBe(403);
    // Nothing was forwarded.
    expect(res.forwardedOrigin).toBeNull();
  });

  it("rejects an unparsable Origin", async () => {
    const res = await callProxy(
      new Request("https://research-center.fit/api/records", {
        method: "POST",
        headers: { Origin: "not a url" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("forwards the canonical host Origin UNCHANGED (not overwritten with the backend base)", async () => {
    const res = await callProxy(
      new Request("https://research-center.fit/api/records", {
        method: "POST",
        headers: { Origin: "https://research-center.fit", Cookie: "connect.sid=victim" },
        body: "{}",
      })
    );
    expect(res.status).toBe(200);
    // The old code did headers.set("origin", base) — the api-server's guard then
    // compared its own URL against ALLOWED_ORIGINS and always passed.
    expect(res.forwardedOrigin).toBe("https://research-center.fit");
    expect(res.forwardedOrigin).not.toBe("https://backend.internal");
  });

  it("forwards the www host Origin too", async () => {
    const res = await callProxy(
      new Request("https://www.research-center.fit/api/records", {
        method: "POST",
        headers: { Origin: "https://www.research-center.fit" },
        body: "{}",
      })
    );
    expect(res.status).toBe(200);
    expect(res.forwardedOrigin).toBe("https://www.research-center.fit");
  });

  it("DELETES Origin entirely when the client sent none (same-origin navigation / curl)", async () => {
    const res = await callProxy(
      new Request("https://research-center.fit/api/records", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(200);
    expect(res.forwardedOrigin).toBeNull();
  });

  it("rejects a sibling subdomain that is not on the allow-list", async () => {
    const res = await callProxy(
      new Request("https://research-center.fit/api/records", {
        method: "POST",
        headers: { Origin: "https://research-center.fit.evil.com" },
        body: "{}",
      })
    );
    expect(res.status).toBe(403);
  });
});