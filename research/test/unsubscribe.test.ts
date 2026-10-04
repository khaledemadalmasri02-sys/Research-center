import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  unsubscribeApp,
  mintUnsubscribeToken,
  resolveSuppressionScope,
  SECURITY_CATEGORIES,
} from "../src/routes/unsubscribe";
import { FakeD1 } from "./helpers";
import type { AppBindings, AppVariables } from "../src/lib/env";

const SECRET = "worker-unsubscribe-secret";

function makeEnv(db: FakeD1, extra: Record<string, unknown> = {}): AppBindings {
  return {
    DB: db as any,
    // A KV stub good enough for the rate limiter.
    SESSIONS: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
    ASSETS: { fetch: async () => new Response("") },
    APP_USERNAME: "x",
    APP_PASSWORD_HASH: "x",
    SESSION_SECRET: SECRET,
    ...extra,
  } as any;
}

function makeApp() {
  return new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({ strict: false })
    .route("/api/unsubscribe", unsubscribeApp);
}

async function tokenFor(
  email: string,
  category: string,
  env: AppBindings = makeEnv(new FakeD1())
) {
  return mintUnsubscribeToken(SECRET, email, category);
}

describe("unsubscribe GET page (W7)", () => {
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

  it("rejects a GET with NO token (never reflect an unverifiable request)", async () => {
    const res = await app.request(
      "/api/unsubscribe?email=user%40example.com&category=newsletter",
      { method: "GET" },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/not valid/i);
  });

  it("rejects a GET with a WRONG token", async () => {
    const res = await app.request(
      "/api/unsubscribe?email=user%40example.com&category=newsletter&token=deadbeef",
      { method: "GET" },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid unsubscribe token/);
  });

  it("renders the confirmation page for a valid signed link", async () => {
    const token = await tokenFor("user@example.com", "newsletter", env);
    const res = await app.request(
      `/api/unsubscribe?email=user%40example.com&category=newsletter&token=${token}`,
      { method: "GET" },
      env
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Unsubscribe from MedResearch/i);
    expect(html).toMatch(/Confirm unsubscribe/);
    expect(html).toMatch(/newsletter/);
  });

  it("tells the user that a login-otp link cannot be honoured", async () => {
    const token = await tokenFor("user@example.com", "login-otp", env);
    const res = await app.request(
      `/api/unsubscribe?email=user%40example.com&category=login-otp&token=${token}`,
      { method: "GET" },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/always sent and cannot be suppressed/);
  });

  it("'all' states which categories will actually stop", async () => {
    const token = await tokenFor("user@example.com", "all", env);
    const res = await app.request(
      `/api/unsubscribe?email=user%40example.com&category=all&token=${token}`,
      { method: "GET" },
      env
    );
    const html = await res.text();
    expect(html).toMatch(/Login, password-reset and account-security emails are always sent/);
    expect(html).not.toMatch(/<code>login-otp<\/code>/);
  });
});

describe("unsubscribe POST requires proof of mailbox ownership (W7)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: AppBindings;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
  });

  const FORM = { "content-type": "application/x-www-form-urlencoded" };

  it("POST without an email returns 400", async () => {
    const res = await app.request("/api/unsubscribe", { method: "POST" }, env);
    expect(res.status).toBe(400);
  });

  it("POST with a bare email and NO token is refused (the old 2FA-suppression attack)", async () => {
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: "email=victim%40clinic.org&category=all" },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Missing unsubscribe token/);
    // Absolutely nothing written: no suppression of any kind.
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("POST with a forged token is refused", async () => {
    const res = await app.request(
      "/api/unsubscribe",
      {
        method: "POST",
        headers: FORM,
        body: "email=victim%40clinic.org&category=all&token=" + "a".repeat(32),
      },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid unsubscribe token/);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("a token minted for a DIFFERENT address does not work", async () => {
    const token = await tokenFor("attacker@example.com", "all", env);
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: `email=victim%40clinic.org&category=all&token=${token}` },
      env
    );
    expect(res.status).toBe(400);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("a token minted for a DIFFERENT category does not work", async () => {
    const token = await tokenFor("victim@clinic.org", "newsletter", env);
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: `email=victim%40clinic.org&category=all&token=${token}` },
      env
    );
    expect(res.status).toBe(400);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("refuses when NO verification secret is configured (fails closed)", async () => {
    const noSecret = makeEnv(db, { SESSION_SECRET: "", INBOUND_EMAIL_SECRET: "" });
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: "email=victim%40clinic.org&category=all&token=abc" },
      noSecret
    );
    expect(res.status).toBe(400);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("a valid signed one-click POST records the non-security categories and returns OK", async () => {
    const token = await tokenFor("user@example.com", "all", env);
    const res = await app.request(
      "/api/unsubscribe",
      {
        method: "POST",
        headers: { ...FORM, "list-unsubscribe-post": "List-Unsubscribe=One-Click" },
        body: `email=user%40example.com&category=all&token=${token}`,
      },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    const cats = db.calls.map((c) => c.binds[1]);
    expect(cats).not.toContain("all");
    expect(cats).not.toContain("login-otp");
    expect(cats).not.toContain("signup-otp");
    expect(cats).not.toContain("transactional");
    for (const c of db.calls) expect(c.binds[0]).toBe("user@example.com");
  });

  it("a valid signed form POST renders the confirmation page", async () => {
    const token = await tokenFor("user@example.com", "all", env);
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: `email=user%40example.com&category=all&token=${token}` },
      env
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/You've been unsubscribed/);
  });

  it("normalises email and category", async () => {
    const token = await tokenFor("user@example.com", "product-update", env);
    const res = await app.request(
      "/api/unsubscribe",
      {
        method: "POST",
        headers: { ...FORM, "list-unsubscribe-post": "List-Unsubscribe=One-Click" },
        body: `email=USER%40Example.COM&category=product-update&token=${token}`,
      },
      env
    );
    expect(res.status).toBe(200);
    expect(db.calls[0].binds[0]).toBe("user@example.com");
    expect(db.calls[0].binds[1]).toBe("product-update");
  });

  it("rate limits repeated suppression writes from one IP", async () => {
    let count = 0;
    const limited = makeEnv(db, {
      SESSIONS: {
        get: async () => String(count),
        put: async (_k: string, v: string) => {
          count = parseInt(v, 10);
        },
        delete: async () => {},
      },
    });
    const token = await tokenFor("user@example.com", "newsletter", limited);
    let sawTooMany = false;
    for (let i = 0; i < 15; i++) {
      const res = await app.request(
        "/api/unsubscribe",
        {
          method: "POST",
          headers: { ...FORM, "cf-connecting-ip": "203.0.113.9" },
          body: `email=user%40example.com&category=newsletter&token=${token}`,
        },
        limited
      );
      if (res.status === 429) {
        sawTooMany = true;
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });
});

describe("category=\"all\" can never suppress a login OTP (W7)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: AppBindings;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
  });

  const FORM = { "content-type": "application/x-www-form-urlencoded" };

  it("does NOT write a login-otp suppression row", async () => {
    const token = await tokenFor("clinician@clinic.org", "all", env);
    const res = await app.request(
      "/api/unsubscribe",
      {
        method: "POST",
        headers: { ...FORM, "list-unsubscribe-post": "List-Unsubscribe=One-Click" },
        body: `email=clinician%40clinic.org&category=all&token=${token}`,
      },
      env
    );
    expect(res.status).toBe(200);
    const written = db.calls.map((c) => c.binds[1]);
    expect(written).not.toContain("login-otp");
    expect(written).not.toContain("all");
  });

  it("a direct login-otp unsubscribe is refused with 400 and writes nothing", async () => {
    const token = await tokenFor("clinician@clinic.org", "login-otp", env);
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: `email=clinician%40clinic.org&category=login-otp&token=${token}` },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/CAN-SPAM 4\(4\)/);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("password-reset is likewise refused", async () => {
    const token = await tokenFor("u@example.com", "password-reset", env);
    const res = await app.request(
      "/api/unsubscribe",
      { method: "POST", headers: FORM, body: `email=u%40example.com&category=password-reset&token=${token}` },
      env
    );
    expect(res.status).toBe(400);
    expect(db.calls.filter((c) => c.sql.includes("email_unsubscribes"))).toHaveLength(0);
  });

  it("the denylist covers every category the api-server uses for 2FA", () => {
    // artifacts/api-server/src/routes/auth.ts sends the login OTP with
    // category "login-otp".
    expect(SECURITY_CATEGORIES.has("login-otp")).toBe(true);
    for (const cat of SECURITY_CATEGORIES) {
      expect(resolveSuppressionScope(cat).scope).not.toContain(cat);
    }
  });
});

describe("GET /status fails closed (W7)", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: AppBindings;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db, { SESSION_SECRET: "", INBOUND_EMAIL_SECRET: "" });
  });

  it("403 when NO status token is configured", async () => {
    const res = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET" },
      env
    );
    expect(res.status).toBe(403);
    // And no suppression state is disclosed.
    expect(db.calls.filter((c) => c.sql.includes("FROM email_unsubscribes"))).toHaveLength(0);
  });

  it("403 with a wrong token", async () => {
    const withToken = makeEnv(db, { UNSUBSCRIBE_STATUS_TOKEN: "lookup-secret" });
    const res = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET", headers: { "x-mail-unsubscribe-token": "nope" } },
      withToken
    );
    expect(res.status).toBe(403);
  });

  it("403 with NO token header when one is configured", async () => {
    const withToken = makeEnv(db, { UNSUBSCRIBE_STATUS_TOKEN: "lookup-secret" });
    const res = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET" },
      withToken
    );
    expect(res.status).toBe(403);
  });

  it("200 with the correct token", async () => {
    const withToken = makeEnv(db, { UNSUBSCRIBE_STATUS_TOKEN: "lookup-secret" });
    db.responder = (sql) =>
      sql.includes("FROM email_unsubscribes")
        ? { results: [{ category: "newsletter" }, { category: "research-update" }] }
        : {};
    const res = await app.request(
      "/api/unsubscribe/status?email=user%40example.com",
      { method: "GET", headers: { "x-mail-unsubscribe-token": "lookup-secret" } },
      withToken
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.unsubscribedCategories).toEqual(["newsletter", "research-update"]);
    // `unsubscribedAll` can never be true now, so a client keying off it
    // cannot be made to suppress security mail.
    expect(body.unsubscribedAll).toBe(false);
    expect(body.securityCategoriesSuppressible).toBe(false);
  });

  it("400 for an invalid email even with a valid token", async () => {
    const withToken = makeEnv(db, { UNSUBSCRIBE_STATUS_TOKEN: "lookup-secret" });
    const res = await app.request(
      "/api/unsubscribe/status?email=nope",
      { method: "GET", headers: { "x-mail-unsubscribe-token": "lookup-secret" } },
      withToken
    );
    expect(res.status).toBe(400);
  });
});