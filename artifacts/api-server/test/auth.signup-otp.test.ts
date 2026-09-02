import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";

// Capture every email the api-server tries to send so we can extract the
// 4-digit OTP code from the rendered body.
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push({ to: input.to, subject: input.subject, text: input.text });
    return true;
  }),
}));

/** Extract the 4-digit login OTP from the email text body. */
function extractOtp(text: string): string {
  const m = text.match(/code is:\s*(\d{4})/i);
  if (!m) throw new Error(`OTP not found in email: ${text.slice(0, 200)}`);
  return m[1];
}

describe("auth.signup + email OTP verification (P0.3 — slice 2)", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it("creates an unverified signup request and triggers an email", async () => {
    const res = await request(t.app)
      .post("/api/auth/signup")
      .send({
        username: "newuser",
        password: "StrongPass1!",
        email: "new@example.com",
        fullName: "New User",
        reason: "Research collaboration",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, status: "unverified" });

    // The signup itself does not send an email (the OTP is requested
    // separately via /auth/signup/otp/send).
    expect(sentEmails).toHaveLength(0);

    const { rows } = await t.pool.query<{
      status: string;
      email: string;
      email_verified: boolean;
    }>(
      `SELECT status, email, email_verified FROM signup_requests WHERE username = $1`,
      ["newuser"],
    );
    expect(rows[0]).toEqual({
      status: "unverified",
      email: "new@example.com",
      email_verified: false,
    });
  });

  it("rejects signup with a weak password (no upper/symbol/number)", async () => {
    const res = await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "weakpw", password: "weakloweronlypw", email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase|uppercase|number|symbol/);
  });

  it("rejects signup with a duplicate username", async () => {
    await t.createUser({ username: "dup", password: "StrongPass1!" });
    const res = await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "dup", password: "StrongPass1!", email: "a@b.com" });
    expect(res.status).toBe(409);
  });

  it("rejects signup with a duplicate pending request", async () => {
    await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "dupx", password: "StrongPass1!", email: "x@y.com" });
    const res = await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "dupx", password: "StrongPass1!", email: "x@y.com" });
    expect(res.status).toBe(409);
  });

  it("rejects signup with an invalid email", async () => {
    const res = await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "u2", password: "StrongPass1!", email: "not-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid email/i);
  });

  it("does not leak whether a username exists on /auth/signup/otp/send", async () => {
    // Unknown username should respond with sent:false but 200.
    const res = await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "nobody", email: "no@one.com" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sent: false });
    expect(sentEmails).toHaveLength(0);
  });

  it("does not leak via email mismatch", async () => {
    await request(t.app)
      .post("/api/auth/signup")
      .send({
        username: "leaky",
        password: "StrongPass1!",
        email: "real@example.com",
      });
    const res = await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "leaky", email: "other@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: false });
    expect(sentEmails).toHaveLength(0);
  });

  it("sends an OTP to the signup email and the verify endpoint promotes the request to pending", async () => {
    await request(t.app)
      .post("/api/auth/signup")
      .send({
        username: "verifyme",
        password: "StrongPass1!",
        email: "verify@example.com",
      });
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "verifyme", email: "verify@example.com" });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("verify@example.com");
    const otp = extractOtp(sentEmails[0].text);

    const verify = await request(t.app)
      .post("/api/auth/signup/otp/verify")
      .send({ username: "verifyme", email: "verify@example.com", code: otp });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ ok: true, verified: true });

    const { rows } = await t.pool.query<{
      status: string;
      email_verified: boolean;
    }>(
      `SELECT status, email_verified FROM signup_requests WHERE username = $1`,
      ["verifyme"],
    );
    expect(rows[0]).toEqual({ status: "pending", email_verified: true });
  });

  it("rejects verify with a wrong code and increments otp_attempts", async () => {
    await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "wrongc", password: "StrongPass1!", email: "r@e.com" });
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "wrongc", email: "r@e.com" });
    const res = await request(t.app)
      .post("/api/auth/signup/otp/verify")
      .send({ username: "wrongc", email: "r@e.com", code: "0000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);
    const { rows } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM signup_requests WHERE username = $1`,
      ["wrongc"],
    );
    expect(rows[0].otp_attempts).toBe(1);
  });

  it("blocks verify after 5 wrong attempts and forces a resend", async () => {
    await request(t.app)
      .post("/api/auth/signup")
      .send({ username: "blockv", password: "StrongPass1!", email: "r2@e.com" });
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "blockv", email: "r2@e.com" });
    for (let i = 0; i < 5; i++) {
      await request(t.app)
        .post("/api/auth/signup/otp/verify")
        .send({ username: "blockv", email: "r2@e.com", code: "0000" });
    }
    // After 5 wrong attempts the next verify should be 429.
    const res = await request(t.app)
      .post("/api/auth/signup/otp/verify")
      .send({ username: "blockv", email: "r2@e.com", code: "0000" });
    expect(res.status).toBe(429);
    // Resend should reset otp_attempts.
    await request(t.app)
      .post("/api/auth/signup/otp/send")
      .send({ username: "blockv", email: "r2@e.com" });
    const { rows } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM signup_requests WHERE username = $1`,
      ["blockv"],
    );
    expect(rows[0].otp_attempts).toBe(0);
  });
});

describe("auth.login 2FA flow (P0.3 — slice 2)", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  // Create a user with email on file and capture their initial otp email.
  async function createUserWithOtp(
    username: string,
    password: string,
    email: string,
  ): Promise<{ userId: number; loginToken: string; otp: string }> {
    const userId = await t.createUser({
      username,
      password,
      email,
      role: "editor",
    });
    // Trigger login to get a 2FA challenge.
    const login = await request(t.app)
      .post("/api/auth/login")
      .send({ username, password });
    expect(login.status).toBe(200);
    expect(login.body.otpRequired).toBe(true);
    expect(sentEmails).toHaveLength(1);
    const otp = extractOtp(sentEmails[0].text);
    return {
      userId,
      loginToken: login.body.loginToken as string,
      otp,
    };
  }

  it("login with email on file returns otpRequired and sends a code", async () => {
    const { otp, loginToken } = await createUserWithOtp(
      "emaillogin",
      "StrongPass1!",
      "el@example.com",
    );
    expect(typeof otp).toBe("string");
    expect(otp).toMatch(/^\d{4}$/);
    expect(typeof loginToken).toBe("string");
    expect(loginToken).toMatch(/^[0-9a-f]{64}$/);
    // Email is masked before sending the response.
    expect(sentEmails[0].to).toBe("el@example.com");
  });

  it("verify otp establishes a session and GET /me reports the user", async () => {
    const { loginToken, otp } = await createUserWithOtp(
      "sessionuser",
      "StrongPass1!",
      "s@example.com",
    );
    const agent = request.agent(t.app);
    const verify = await agent
      .post("/api/auth/login/otp/verify")
      .send({ username: "sessionuser", loginToken, code: otp });
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({
      ok: true,
      username: "sessionuser",
      role: "editor",
      canAdminAccess: false,
    });

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      authenticated: true,
      username: "sessionuser",
      role: "editor",
      canAdminAccess: false,
    });
  });

  it("verify rejects a wrong code and increments otp_attempts", async () => {
    const { loginToken } = await createUserWithOtp(
      "wrongcode",
      "StrongPass1!",
      "w@example.com",
    );
    const res = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({ username: "wrongcode", loginToken, code: "0000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);
    const { rows } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM users WHERE username = $1`,
      ["wrongcode"],
    );
    expect(rows[0].otp_attempts).toBe(1);
  });

  it("verify rejects an invalid login token with 401", async () => {
    await t.createUser({
      username: "tokentest",
      password: "StrongPass1!",
      email: "tt@example.com",
    });
    const res = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({
        username: "tokentest",
        loginToken: "deadbeef".repeat(8),
        code: "1234",
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/session expired/i);
  });

  it("login challenge cannot be reused (consumed_at set after verify)", async () => {
    const { loginToken, otp } = await createUserWithOtp(
      "reusetest",
      "StrongPass1!",
      "r@example.com",
    );
    const r1 = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({ username: "reusetest", loginToken, code: otp });
    expect(r1.status).toBe(200);
    // Second use of the same login token must fail (challenge was consumed).
    const r2 = await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({ username: "reusetest", loginToken, code: otp });
    expect(r2.status).toBe(401);
  });

  it("logout destroys the session and /me returns 401", async () => {
    const { loginToken, otp } = await createUserWithOtp(
      "logoutuser",
      "StrongPass1!",
      "lo@example.com",
    );
    const agent = request.agent(t.app);
    await agent
      .post("/api/auth/login/otp/verify")
      .send({ username: "logoutuser", loginToken, code: otp });
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);

    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    const me2 = await agent.get("/api/auth/me");
    expect(me2.status).toBe(401);
  });

  it("otp resend issues a new code and resets otp_attempts", async () => {
    await t.createUser({
      username: "resendtest",
      password: "StrongPass1!",
      email: "rs@example.com",
    });
    const login = await request(t.app)
      .post("/api/auth/login")
      .send({ username: "resendtest", password: "StrongPass1!" });
    expect(login.status).toBe(200);
    const initialToken = login.body.loginToken as string;
    const initialOtp = extractOtp(sentEmails[0].text);

    // Use a wrong code to bump attempts.
    await request(t.app)
      .post("/api/auth/login/otp/verify")
      .send({
        username: "resendtest",
        loginToken: initialToken,
        code: "0000",
      });
    const { rows: before } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM users WHERE username = $1`,
      ["resendtest"],
    );
    expect(before[0].otp_attempts).toBe(1);

    // Resend.
    const resend = await request(t.app)
      .post("/api/auth/login/otp/send")
      .send({ username: "resendtest", loginToken: initialToken });
    expect(resend.status).toBe(200);
    expect(sentEmails).toHaveLength(2);
    const newOtp = extractOtp(sentEmails[1].text);
    expect(newOtp).toMatch(/^\d{4}$/);
    expect(newOtp).not.toBe(initialOtp);

    const { rows: after } = await t.pool.query<{ otp_attempts: number }>(
      `SELECT otp_attempts FROM users WHERE username = $1`,
      ["resendtest"],
    );
    expect(after[0].otp_attempts).toBe(0);
  });
});

describe("auth.me (P0.3 — slice 2)", () => {
  const t: DbFixture = withDb();

  it("returns 401 when not authenticated", async () => {
    const res = await request(t.app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ authenticated: false });
  });
});