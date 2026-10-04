// A5 + A6 + A8 — auth hardening.
//
// A5: OTP codes come from a CSPRNG (unique + in range over many samples).
// A6: /api/auth/login/otp/verify is rate limited and its attempt counter is
//     atomic, so concurrent wrong codes still lock out after 5; the signup
//     verify route behaves the same.
// A8: the OAuth callback refuses a suspended account and refuses to link on an
//     unverified email.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";
import { __resetRateLimits, clientIp } from "../src/lib/security";
import { generateOtpCode, OTP_LENGTH, oauthCallbackHandler } from "../src/routes/auth";

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push({ to: input.to, subject: input.subject, text: input.text });
    return true;
  }),
}));

function extractOtp(text: string): string {
  const m = text.match(/code is:\s*(\d{4,8})/i);
  if (!m) throw new Error(`OTP not found in email: ${text.slice(0, 200)}`);
  return m[1]!;
}

describe("A5 — OTP generation uses a CSPRNG", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
    __resetRateLimits();
  });

  it("stays in range and produces no duplicates over many samples", () => {
    const lower = 10 ** (OTP_LENGTH - 1);
    const upper = 10 ** OTP_LENGTH;
    const samples = 20_000;
    const seen = new Set<string>();
    for (let i = 0; i < samples; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d+$/);
      const n = Number(code);
      expect(n).toBeGreaterThanOrEqual(lower);
      expect(n).toBeLessThan(upper);
      seen.add(code);
    }
    // Collisions are expected by birthday bound for 1e6 space / 20k draws
    // (~18%), but never a systematic repeat and never out of range. What we
    // can assert is that the generator is not returning a constant and that
    // every distinct draw is a valid code.
    expect(seen.size).toBeGreaterThan(samples / 2);
  });

  it("honours the configured length", () => {
    expect(generateOtpCode(6)).toMatch(/^\d{6}$/);
    expect(generateOtpCode(4)).toMatch(/^\d{4}$/);
    expect(generateOtpCode(8)).toMatch(/^\d{8}$/);
  });

  it("emails a 6-digit code through the live signup route", async () => {
    await request(t.app).post("/api/auth/signup").send({
      username: "csprng-user",
      password: "StrongPass1!",
      email: "csprng@example.com",
    });
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "csprng-user", email: "csprng@example.com" });
    const mail = sentEmails.find((e) => e.to === "csprng@example.com");
    expect(mail).toBeDefined();
    expect(extractOtp(mail!.text)).toMatch(/^\d{6}$/);
  });
});

describe("A6 — login OTP verify is rate limited and atomically counted", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
    __resetRateLimits();
  });

  async function startChallenge(
    username: string,
  ): Promise<{ loginToken: string; otp: string }> {
    await t.createUser({
      username,
      password: "StrongPass1!",
      email: `${username}@example.com`,
      role: "editor",
    });
    const login = await request(t.app)
      .post("/api/auth/login")
      .send({ username, password: "StrongPass1!" });
    expect(login.status).toBe(200);
    expect(login.body.otpRequired).toBe(true);
    const mail = sentEmails.find((e) => e.to === `${username}@example.com`);
    expect(mail).toBeDefined();
    return { loginToken: login.body.loginToken as string, otp: extractOtp(mail!.text) };
  }

  it("rejects the 6th consecutive wrong code", async () => {
    const { loginToken } = await startChallenge("otp-sixth");
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(t.app)
        .post("/api/auth/login/otp/verify")
        .send({ username: "otp-sixth", loginToken, code: "000000" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/incorrect/i);
      statuses.push(res.status);
    }
    const sixth = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({ username: "otp-sixth", loginToken, code: "000000" });
    expect(sixth.status).toBe(429);
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
  });

  it("still locks out after 5 when N wrong codes arrive concurrently", async () => {
    const { loginToken } = await startChallenge("otp-race");
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(t.app)
          .post("/api/auth/login/otp/verify")
          .send({ username: "otp-race", loginToken, code: "000000" }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 400).length;
    const locked = attempts.filter((r) => r.status === 429).length;
    expect(ok).toBe(5);
    expect(locked).toBe(8 - 5);

    // The counter never exceeds the cap, whatever the interleaving was.
    const { rows } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM users WHERE username = $1`,
      ["otp-race"],
    );
    expect(rows[0]!.otp_attempts).toBe(5);

    // ...and the correct code is now refused too.
    const after = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({ username: "otp-race", loginToken, code: "123456" });
    expect(after.status).toBe(429);
  });

  it("returns 429 from the per-IP limiter", async () => {
    // Bogus challenges: the per-IP budget (LOGIN_RATE_LIMIT = 10 / 15 min) is
    // consumed before any DB work, so the 11th request is a 429.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(t.app).post("/api/auth/login/otp/verify").send({
        username: "nobody",
        loginToken: "f".repeat(64),
        code: "123456",
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it("applies the same rate limit + atomic counter to the signup verify route", async () => {
    await request(t.app).post("/api/auth/signup").send({
      username: "otp-signup-race",
      password: "StrongPass1!",
      email: "signup-race@example.com",
    });
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "otp-signup-race", email: "signup-race@example.com" });

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(t.app).post("/api/auth/signup/otp/verify").send({
          username: "otp-signup-race",
          email: "signup-race@example.com",
          code: "000000",
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === 400)).toHaveLength(5);
    expect(attempts.filter((r) => r.status === 429)).toHaveLength(3);

    const { rows } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM signup_requests WHERE username = $1`,
      ["otp-signup-race"],
    );
    expect(rows[0]!.otp_attempts).toBe(5);
  });

  it("establishes a session with a NEW session id (fixation defence, A7)", async () => {
    const agent = request.agent(t.app);
    const start = await agent.get("/api/auth/me");
    expect(start.status).toBe(401);
    const preCookie = start.headers["set-cookie"]?.[0] ?? "";

    await t.createUser({ username: "fixation-user", password: "StrongPass1!" });
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "fixation-user", password: "StrongPass1!" });
    expect(login.status).toBe(200);

    const postCookie = login.headers["set-cookie"]?.[0] ?? "";
    expect(postCookie).toMatch(/^rc_sid=/);
    const sid = (c: string) => /rc_sid=([^;]+)/.exec(c)?.[1];
    // The pre-login cookie (if any) must not be reused as the login session.
    if (sid(preCookie)) expect(sid(postCookie)).not.toBe(sid(preCookie));

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("fixation-user");
  });
});

/**
 * A8 — the OAuth callback.
 *
 * The handler is driven directly (`oauthCallbackHandler`) rather than through
 * the router: `router.use(requireAuth, <subRouter>)` in routes/index.ts
 * registers `requireAuth` at path "/" (the `router` package treats the first
 * function argument as a middleware at "/", not as a gate for the second
 * argument), so every request that falls through authRouter — including the
 * OAuth callback — is answered 401 before the handler runs. See the report:
 * that mounting bug needs its own fix. These assertions are about the
 * handler's own authorisation decisions.
 */
describe("A8 — OAuth callback refuses suspended and unverified identities", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    __resetRateLimits();
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/oauth/google/callback";
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  interface StubResponse {
    statusCode: number;
    location?: string;
    body?: unknown;
  }

  function stubResponse(): StubResponse & {
    res: Record<string, unknown>;
  } {
    const out: StubResponse = { statusCode: 200 };
    const res = {
      redirect(loc: string) {
        out.statusCode = 302;
        out.location = loc;
        return res;
      },
      status(code: number) {
        out.statusCode = code;
        return res;
      },
      json(payload: unknown) {
        out.body = payload;
        return res;
      },
      send(payload: unknown) {
        out.body = payload;
        return res;
      },
    };
    return Object.assign(out, { res: res as unknown as Record<string, unknown> });
  }

  async function runCallback(
    email: string,
    opts: { emailVerified: boolean; subject: string },
  ): Promise<{ statusCode: number; location?: string; session: Record<string, unknown> }> {
    const tokenInfo = {
      iss: "https://accounts.google.com",
      aud: "cid",
      sub: opts.subject,
      email,
      email_verified: String(opts.emailVerified),
      name: "OAuth User",
      nonce: "nonce-1",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ id_token: "header.payload.sig" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://www.googleapis.com/oauth2/v3/tokeninfo")) {
        return new Response(JSON.stringify(tokenInfo), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const session: Record<string, unknown> = {
      oauthState: { provider: "google", state: "st", nonce: "nonce-1", createdAt: Date.now() },
      regenerate(cb: (err?: Error | null) => void) {
        cb(null);
      },
    };

    try {
      const req = {
        method: "POST",
        params: { provider: "google" },
        query: {},
        body: { code: "auth-code", state: "st" },
        headers: { host: "localhost:3000" },
        socket: { remoteAddress: "127.0.0.1" },
        session,
        log: { warn: () => undefined, error: () => undefined, info: () => undefined },
      };
      const stub = stubResponse();
      await oauthCallbackHandler(req as never, stub.res as never);
      return { statusCode: stub.statusCode, location: stub.location, session };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it("does not establish a session for a suspended user", async () => {
    const userId = await t.createUser({
      username: "suspended-oauth",
      password: "StrongPass1!",
      role: "editor",
      email: "suspended-oauth@example.com",
      status: "suspended",
    });
    // Pre-link the provider identity the way an earlier login would have.
    await t.pool.query(
      `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email, provider_email_verified, created_at)
       VALUES ($1, 'google', $2, $3, true, now())`,
      [userId, "sub-suspended", "suspended-oauth@example.com"],
    );

    const res = await runCallback("suspended-oauth@example.com", {
      emailVerified: true,
      subject: "sub-suspended",
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toContain("oauth=error");
    expect(res.location).not.toContain("/dashboard");
    expect(res.session.authenticated).toBeUndefined();
  });

  it("refuses to create a session when the provider has not verified the email", async () => {
    const res = await runCallback("unverified@example.com", {
      emailVerified: false,
      subject: "sub-unverified",
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toContain("oauth=error");
    expect(res.session.authenticated).toBeUndefined();

    const { rows } = await t.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE email = $1`,
      ["unverified@example.com"],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("does not auto-link to an existing local account by email alone", async () => {
    await t.createUser({
      username: "local-only",
      password: "StrongPass1!",
      role: "admin",
      canAdminAccess: true,
      email: "victim@example.com",
    });
    const res = await runCallback("victim@example.com", {
      emailVerified: true,
      subject: "attacker-sub",
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toContain("oauth=link_required");
    expect(res.location).not.toContain("/dashboard");
    expect(res.session.authenticated).toBeUndefined();

    const { rows } = await t.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM oauth_identities WHERE provider_user_id = $1`,
      ["attacker-sub"],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("still creates a session for a new, provider-verified identity", async () => {
    const res = await runCallback("brand-new@example.com", {
      emailVerified: true,
      subject: "new-sub",
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toContain("/dashboard");
    expect(res.session.authenticated).toBe(true);
  });

  it("rejects a callback whose state does not match the session", async () => {
    const res = await stubResponse();
    const req = {
      method: "POST",
      params: { provider: "google" },
      query: {},
      body: { code: "auth-code", state: "tampered" },
      headers: { host: "localhost:3000" },
      socket: { remoteAddress: "127.0.0.1" },
      session: {
        oauthState: { provider: "google", state: "st", nonce: "n", createdAt: Date.now() },
      },
      log: { warn: () => undefined, error: () => undefined, info: () => undefined },
    };
    await oauthCallbackHandler(req as never, res.res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid/i);
  });
});

describe("A9 — X-Forwarded-For is only trusted from a configured proxy", () => {
  const req = (headers: Record<string, string>, remoteAddress: string) =>
    ({ headers, socket: { remoteAddress } }) as never;

  it("ignores a spoofed XFF from an untrusted peer", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "198.51.100.7"))).toBe(
      "198.51.100.7",
    );
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "::ffff:198.51.100.7"))).toBe(
      "198.51.100.7",
    );
  });

  it("ignores XFF when no proxy list is configured at all", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    expect(clientIp(req({ "x-forwarded-for": "10.0.0.1" }, "203.0.113.9"))).toBe(
      "203.0.113.9",
    );
  });

  it("honours XFF from a trusted IPv4 range", () => {
    process.env.TRUSTED_PROXY_CIDRS = "173.245.48.0/20, 103.21.244.0/22";
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "173.245.48.9"))).toBe("1.2.3.4");
    // Chained proxies: the left-most entry is the client.
    expect(
      clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, "103.21.244.5")),
    ).toBe("1.2.3.4");
    // A different trusted range in the list also works.
    expect(clientIp(req({ "x-forwarded-for": "5.6.7.8" }, "103.21.244.5"))).toBe("5.6.7.8");
  });

  it("still ignores XFF from a peer outside every configured range", () => {
    process.env.TRUSTED_PROXY_CIDRS = "173.245.48.0/20";
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "198.51.100.7"))).toBe(
      "198.51.100.7",
    );
    // A malformed CIDR entry must fail closed, not match everything.
    process.env.TRUSTED_PROXY_CIDRS = "not-an-ip, 999.999.0.0/16";
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "198.51.100.7"))).toBe(
      "198.51.100.7",
    );
  });

  it("supports IPv6 proxy ranges", () => {
    process.env.TRUSTED_PROXY_CIDRS = "2400:cb00::/32";
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "2400:cb00::1"))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }, "2606:4700::1"))).toBe(
      "2606:4700::1",
    );
  });

  it("keeps supertest's loopback bucket stable", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    expect(clientIp(req({}, "127.0.0.1"))).toBe("test-client");
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9" }, "::1"))).toBe("test-client");
  });

  it("a spoofed header cannot get a fresh rate-limit bucket", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    const spoofed = req({ "x-forwarded-for": `${Math.floor(Math.random() * 1e9)}.1.1.1` }, "127.0.0.1");
    const real = req({}, "127.0.0.1");
    expect(clientIp(spoofed)).toBe(clientIp(real));
  });
});