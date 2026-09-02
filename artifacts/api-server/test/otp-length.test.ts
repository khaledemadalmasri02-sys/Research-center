// P1.4 — OTP length & threat-model policy.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withDb, type DbFixture } from "./helpers/db";

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
  return m[1];
}

describe("P1.4 — generated OTP codes match the configured length", () => {
  const t: DbFixture = withDb();

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it("emails a 6-digit signup OTP (default OTP_LENGTH=6)", async () => {
    const agent = await t.loginAs("otptest", "StrongPass1!").catch(async () => {
      // loginAs fails if user doesn't exist; create then login.
      await t.createUser({
        username: "otptest",
        password: "StrongPass1!",
        email: "otptest@example.com",
      });
      return t.loginAs("otptest", "StrongPass1!");
    });
    void agent;
    // Use the signup route directly (don't need a logged-in user).
    const { default: app } = await import("../src/app.ts");
    const supertest = (await import("supertest")).default;
    const a = supertest.agent(app);
    const signup = await a.post("/api/auth/signup").send({
      username: "otplen-u1",
      password: "StrongPass1!",
      email: "otplen-u1@example.com",
    });
    if (signup.status !== 201) {
      // eslint-disable-next-line no-console
      console.log("SIGNUP FAILED", signup.status, signup.body);
    }
    const send = await a
      .post("/api/auth/signup/otp/send")
      .send({ username: "otplen-u1", email: "otplen-u1@example.com" });
    if (send.status !== 200) {
      // eslint-disable-next-line no-console
      console.log("SEND FAILED", send.status, send.body);
    }
    // Filter to the email for this specific test's recipient. The
    // shared `sentEmails` array may also contain emails from other
    // tests in this file (e.g. the 2FA describe runs after this one
    // and doesn't clear between describes).
    const myEmail = sentEmails.find((e) => e.to === "otplen-u1@example.com");
    expect(myEmail).toBeDefined();
    const otp = extractOtp(myEmail!.text);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("emails a 6-digit 2FA OTP (default OTP_LENGTH=6)", async () => {
    await t.createUser({
      username: "otplen-2fa",
      password: "StrongPass1!",
      email: "otplen-2fa@example.com",
    });
    const { default: app } = await import("../src/app.ts");
    const supertest = (await import("supertest")).default;
    const agent = supertest.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "otplen-2fa", password: "StrongPass1!" });
    expect(login.status).toBe(200);
    expect(login.body.otpRequired).toBe(true);
    expect(sentEmails).toHaveLength(1);
    const otp = extractOtp(sentEmails[0].text);
    expect(otp).toMatch(/^\d{6}$/);
  });
});

describe("P1.4 — OTP_LENGTH env var parsing", () => {
  // We test the env-parsing logic by re-importing the module with
  // different env values. Vitest's module cache is per-file so this
  // works inside a single test file.
  it("defaults to 6 when OTP_LENGTH is unset", async () => {
    delete process.env.OTP_LENGTH;
    vi.resetModules();
    const mod = await import("../src/routes/auth.ts");
    expect(mod.OTP_LENGTH).toBe(6);
  });

  it("accepts 4 when OTP_LENGTH=4 (legacy override)", async () => {
    process.env.OTP_LENGTH = "4";
    vi.resetModules();
    const mod = await import("../src/routes/auth.ts");
    expect(mod.OTP_LENGTH).toBe(4);
    delete process.env.OTP_LENGTH;
  });

  it("accepts 8 when OTP_LENGTH=8 (high-security)", async () => {
    process.env.OTP_LENGTH = "8";
    vi.resetModules();
    const mod = await import("../src/routes/auth.ts");
    expect(mod.OTP_LENGTH).toBe(8);
    delete process.env.OTP_LENGTH;
  });

  it("falls back to 6 for out-of-range or garbage values", async () => {
    for (const v of ["3", "9", "abc", "", "-1"]) {
      process.env.OTP_LENGTH = v;
      vi.resetModules();
      const mod = await import("../src/routes/auth.ts");
      expect(mod.OTP_LENGTH).toBe(6);
    }
    delete process.env.OTP_LENGTH;
  });
});
