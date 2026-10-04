import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

const GOOGLE_SECRET = "test-google-secret";
const GOOGLE_CLIENT_ID = "test-google-client-id";
const APPLE_CLIENT_ID = "test-apple-client-id";
const APPLE_SECRET = "test-apple-secret";

describe("auth.oauth (P1.2)", () => {
  const t: DbFixture = withDb();

  // Every test here replaces `fetch` to intercept Google's token and tokeninfo
  // endpoints. Without this the stub leaks into the next test in the file (and
  // out of it), which is how the suite ended up with order-dependent results.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const googleEnv = {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    GOOGLE_REDIRECT_URI: "https://app.test/api/auth/oauth/google/callback",
    APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: APPLE_SECRET,
    APPLE_REDIRECT_URI: "https://app.test/api/auth/oauth/apple/callback",
  };

  beforeEach(async () => {
    Object.assign(process.env, googleEnv);
  });

  it("returns 400 for an unknown provider", async () => {
    const res = await request(t.app).get("/api/auth/oauth/github").redirects(0);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Unsupported OAuth provider.",
      code: "AUTH_OAUTH_INVALID",
    });
  });

  it("redirects to the provider with a saved state + nonce", async () => {
    const res = await request(t.app).get("/api/auth/oauth/google").redirects(0);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.origin).toBe("https://accounts.google.com");
    expect(loc.searchParams.get("client_id")).toBe(GOOGLE_CLIENT_ID);
    expect(loc.searchParams.get("redirect_uri")).toBe(googleEnv.GOOGLE_REDIRECT_URI);
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("openid email profile");
    expect(loc.searchParams.get("state")).toBeTruthy();
    expect(loc.searchParams.get("nonce")).toBeTruthy();

    const sessionRes = await request(t.app).get("/api/auth/me").redirects(0);
    // The session is stored on the cookie jar, not exposed via /me before login.
    expect(sessionRes.status).toBe(401);
  });

  it("rejects a callback with mismatched state", async () => {
    const agent = request.agent(t.app);
    await agent.get("/api/auth/oauth/google");

    const res = await agent
      .get("/api/auth/oauth/google/callback")
      .query({ code: "abc", state: "tampered" })
      .redirects(0);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("verifies the Google id_token and creates a session for a new user", async () => {
    const now = Math.floor(Date.now() / 30) * 30;
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: GOOGLE_CLIENT_ID,
        sub: "google-sub-123",
        email: "newuser@example.com",
        email_verified: true,
        name: "New User",
        nonce: "testnonce",
        exp: now + 3600,
        iat: now,
      }),
    ).toString("base64url");
    const idToken = `${header}.${payload}.sig`;

    // `global.fetch` is Node's real undici fetch, NOT a vitest mock, so
    // calling `.mockImplementation()` on it threw
    // "globalFetch.mockImplementation is not a function" and both tests below
    // errored before ever reaching the handler. A hoisted `vi.fn()` was created
    // and then discarded. `vi.stubGlobal` is the supported way to replace a
    // global for the duration of a test, and `vi.unstubAllGlobals()` in
    // afterEach puts the real implementation back.
    let issuedNonce = "";
    const globalFetch = vi.fn(async (input: RequestInfo, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "access", id_token: idToken }),
        } as Response;
      }
      if (url.startsWith("https://www.googleapis.com/oauth2/v3/tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            iss: "https://accounts.google.com",
            aud: GOOGLE_CLIENT_ID,
            sub: "google-sub-123",
            email: "newuser@example.com",
            // Required: the callback refuses to create or link an account
            // from an address the provider has not verified (A8).
            email_verified: true,
            name: "New User",
            // Echo the nonce the authorize step actually issued. The handler
            // verifies the id_token nonce against the value stored in the
            // session (jwksVerify(…, state.nonce)), so a hard-coded nonce here
            // cannot match and the test could never reach the assertions below.
            nonce: issuedNonce,
          }),
        } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", globalFetch);

    const agent = request.agent(t.app);

    // Initiate OAuth. The authorize redirect carries the `state` and `nonce`
    // that were just written into the session, so reading them off the Location
    // header is the only way a test can replay a *valid* callback. The previous
    // version sent a literal "ignored-because-tokeninfo-returns-fixed-nonce",
    // which the handler correctly rejects with 400 — so the assertions after it
    // were unreachable.
    const authorize = await agent.get("/api/auth/oauth/google").redirects(0);
    expect(authorize.status).toBe(302);
    const authorizeUrl = new URL(String(authorize.headers.location));
    const issuedState = authorizeUrl.searchParams.get("state");
    expect(issuedState).toMatch(/^[0-9a-f]{64}$/);
    issuedNonce = authorizeUrl.searchParams.get("nonce") ?? "";
    expect(issuedNonce).toMatch(/^[0-9a-f]{48}$/);

    const res = await agent
      .get("/api/auth/oauth/google/callback")
      .query({ code: "authcode", state: issuedState })
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/dashboard/);

    // A user + oauth identity should exist.
    const users = await t.pool.query<{ id: number; username: string; email: string }>(
      `SELECT "id", "username", "email" FROM "users" WHERE "email" = $1`,
      ["newuser@example.com"],
    );
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].username).toBe("newuser@example.com");

    const ids = await t.pool.query(
      `SELECT * FROM "oauth_identities" WHERE "provider" = $1 AND "provider_user_id" = $2`,
      ["google", "google-sub-123"],
    );
    expect(ids.rows).toHaveLength(1);
    expect(ids.rows[0].user_id).toBe(users.rows[0].id);
  });

  it("returns 401 with error redirect when the id_token fails verification", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "wrong-client",
        sub: "x",
      }),
    ).toString("base64url");
    const badToken = `${header}.${payload}.sig`;

    const globalFetch = vi.fn(async (input: RequestInfo, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return { ok: true, json: async () => ({ access_token: "a", id_token: badToken }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", globalFetch);

    const agent = request.agent(t.app);
    const authorize = await agent.get("/api/auth/oauth/google").redirects(0);
    const issuedState = new URL(String(authorize.headers.location)).searchParams.get("state");

    // Correct state, but the id_token carries the wrong audience, so JWKS
    // verification must fail and the callback must bounce to the error page
    // rather than establish a session.
    const res = await agent
      .get("/api/auth/oauth/google/callback")
      .query({ code: "x", state: issuedState })
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/auth\?oauth=error/);
  });
});
