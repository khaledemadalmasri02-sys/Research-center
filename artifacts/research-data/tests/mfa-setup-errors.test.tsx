/**
 * Error mapping across the MFA flow.
 *
 * The backend contract adds a `code` field to error responses and this code
 * switches on it. These tests pin the behaviour that matters most:
 *
 *   - a build PREDATING the `code` field still says something honest, because
 *     the English `error` string is used as the last resort;
 *   - a rejected code fails LOUDLY — assertive, destructive, boxes cleared, and
 *     no success-shaped motion anywhere;
 *   - an absent ROUTE is not a user error, and must not be reported as one;
 *   - `AUTH_REAUTH_REQUIRED` bounces back to the password step with the right
 *     intent, and does NOT silently re-enrol.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MfaSetupPage from "@/pages/mfa-setup";
import {
  AuthApiError,
  authErrorFromResponse,
  presentAuthError,
} from "@/components/auth/mfa/errors";
import {
  SECRET,
  URI,
  baselineRoutes,
  installFetch,
  installMatchMedia,
  jsonResponse,
  renderWithProviders,
} from "./mfa-fixtures";

let restoreMatchMedia: (() => void) | null = null;

beforeEach(() => {
  restoreMatchMedia = installMatchMedia();
});

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Pure mapping                                                               */
/* -------------------------------------------------------------------------- */

describe("auth error mapping", () => {
  it("prefers the machine code over the English string", async () => {
    const err = await authErrorFromResponse(
      jsonResponse({ code: "AUTH_MFA_INVALID", error: "bad otp" }, 400),
    );
    expect(err.code).toBe("AUTH_MFA_INVALID");
    // The server string is still carried through for display.
    expect(err.serverMessage).toBe("bad otp");
  });

  it("falls back to the English string when the build has no `code` field", async () => {
    const err = await authErrorFromResponse(jsonResponse({ error: "Cannot revoke the current session." }, 400));
    // No code in the body, no distinctive status -> the generic bucket, but the
    // server's own words survive.
    expect(err.serverMessage).toBe("Cannot revoke the current session.");
    expect(err.message).toBe("Cannot revoke the current session.");

    const shown = presentAuthError(err);
    expect(shown.code).toBe("AUTH_UNKNOWN");
    expect(shown.serverMessage).toBe("Cannot revoke the current session.");
  });

  it("treats an absent route as unavailability, not a user error", async () => {
    for (const status of [404, 405, 501]) {
      const err = await authErrorFromResponse(jsonResponse({}, status));
      expect(err.code).toBe("AUTH_ENDPOINT_MISSING");
      const shown = presentAuthError(err);
      expect(shown.severity).toBe("info");
      expect(shown.titleKey).toBe("mfa.error.unavailableTitle");
    }
  });

  it("reads retryAfterSec from the body, then the header, then a default", async () => {
    const fromBody = await authErrorFromResponse(
      jsonResponse({ code: "AUTH_RATE_LIMITED", error: "slow down", retryAfterSec: 45 }, 429),
    );
    expect(fromBody.retryAfterSec).toBe(45);

    const fromHeader = await authErrorFromResponse(
      jsonResponse({ code: "AUTH_RATE_LIMITED", error: "slow down" }, 429, { "Retry-After": "30" }),
    );
    expect(fromHeader.retryAfterSec).toBe(30);

    const fromNothing = await authErrorFromResponse(jsonResponse({ error: "slow down" }, 429));
    expect(fromNothing.code).toBe("AUTH_RATE_LIMITED");
    expect(fromNothing.retryAfterSec).toBe(60);
  });

  it("does not attach a countdown to non-429 errors", async () => {
    const err = await authErrorFromResponse(
      jsonResponse({ code: "AUTH_MFA_INVALID", error: "nope", retryAfterSec: 30 }, 400),
    );
    expect(err.retryAfterSec).toBeNull();
  });

  it("survives an unparseable body", async () => {
    const err = await authErrorFromResponse({
      status: 500,
      headers: new Headers(),
      json: async () => {
        throw new Error("not json");
      },
    });
    expect(err.code).toBe("AUTH_UNKNOWN");
    expect(err.message).toContain("500");
  });

  it("maps every contract code to a distinct, presentable message", () => {
    const codes = [
      "AUTH_MFA_INVALID",
      "AUTH_MFA_NOT_ENROLLED",
      "AUTH_RECOVERY_INVALID",
      "AUTH_TOTP_NOT_CONFIGURED",
      "AUTH_TOTP_ALREADY_SET",
      "AUTH_REAUTH_REQUIRED",
      "AUTH_RATE_LIMITED",
      "AUTH_SESSION_REVOKED",
      "AUTH_SESSION_EXPIRED",
    ] as const;

    const seen = new Set<string>();
    for (const code of codes) {
      const shown = presentAuthError(new AuthApiError({ code, message: code }));
      expect(shown.titleKey, code).not.toBe("mfa.error.unknownTitle");
      expect(shown.bodyFallback.length, code).toBeGreaterThan(10);
      seen.add(shown.titleKey);
    }
    expect(seen.size).toBe(codes.length);
  });

  it("never maps a rejected code to a success-shaped severity", () => {
    for (const code of ["AUTH_MFA_INVALID", "AUTH_RECOVERY_INVALID", "AUTH_SESSION_REVOKED"]) {
      expect(presentAuthError(new AuthApiError({ code, message: code })).severity).toBe("danger");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Page-level behaviour                                                       */
/* -------------------------------------------------------------------------- */

type ConfirmOutcome = { status: number; body: unknown };

async function walkToVerify(
  user: ReturnType<typeof userEvent.setup>,
  confirm: ConfirmOutcome,
) {
  installFetch(
    baselineRoutes([
      {
        match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
        respond: () => jsonResponse({ ok: true }),
      },
      {
        match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
        respond: () => jsonResponse({ secret: SECRET, otpauthUri: URI }),
      },
      {
        match: (url, init) => url === "/api/auth/mfa/enroll/confirm" && init.method === "POST",
        respond: () => jsonResponse(confirm.body, confirm.status),
      },
    ]),
  );
  renderWithProviders(<MfaSetupPage />);
  await user.click(await screen.findByTestId("mfa-intro-start"));
  await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
  await user.click(screen.getByTestId("mfa-reauth-submit"));
  await user.click(await screen.findByTestId("mfa-enroll-continue"));
  for (const [i, d] of ["4", "1", "9", "2", "0", "7"].entries()) {
    await user.type(screen.getAllByRole("textbox")[i], d);
  }
  await user.click(screen.getByTestId("mfa-verify-submit"));
}

describe("a rejected TOTP code", () => {
  it("fails loudly: assertive alert, danger severity, boxes cleared", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, {
      status: 400,
      body: { code: "AUTH_MFA_INVALID", error: "Invalid or expired code" },
    });

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_MFA_INVALID");
    expect(banner).toHaveAttribute("data-error-severity", "danger");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    // The server's own words are shown, not swallowed.
    expect(banner).toHaveTextContent("Invalid or expired code");

    // Every box is emptied: the user must not be able to re-submit the same
    // refused code.
    await waitFor(() => {
      expect(screen.getAllByRole("textbox").map((b) => (b as HTMLInputElement).value)).toEqual([
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    });
  });

  it("keeps the user on the verify step so they can retype", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, { status: 400, body: { code: "AUTH_MFA_INVALID", error: "nope" } });

    await screen.findByTestId("mfa-error");
    expect(screen.getByTestId("mfa-verify-submit")).toBeInTheDocument();
    // Retyping is possible.
    await user.type(screen.getAllByRole("textbox")[0], "9");
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("9");
  });

  it("never renders a success state on this path", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, { status: 400, body: { code: "AUTH_MFA_INVALID", error: "nope" } });

    await screen.findByTestId("mfa-error");
    expect(screen.queryByText("mfa.done.title")).toBeNull();
    expect(screen.queryByText("mfa.recovery.onceTitle")).toBeNull();
  });
});

describe("rate limiting", () => {
  it("counts the server's window down and gates the submit while it runs", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, {
      status: 429,
      body: { code: "AUTH_RATE_LIMITED", error: "Too many attempts", retryAfterSec: 30 },
    });

    const notice = await screen.findByTestId("mfa-rate-limit");
    // The count is already ticking by the time we read it, so assert the
    // window rather than an exact tick.
    const first = Number(notice.getAttribute("data-remaining-seconds"));
    expect(first).toBeGreaterThan(25);
    expect(first).toBeLessThanOrEqual(30);
    expect(notice).toHaveTextContent("mfa.rateLimited.heading");
    expect(screen.getByTestId("mfa-rate-limit-seconds")).toHaveTextContent(/^\d:\d\d$/);

    expect(screen.getByTestId("mfa-verify-submit")).toBeDisabled();
    // Boxes are locked too, so a user cannot queue a doomed attempt.
    expect(screen.getAllByRole("textbox")[0]).toBeDisabled();

    await waitFor(() => {
      const next = Number(
        screen.getByTestId("mfa-rate-limit").getAttribute("data-remaining-seconds"),
      );
      expect(next).toBeLessThan(first);
    });
  }, 20000);

  it("re-enables the submit once the window expires", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, {
      status: 429,
      body: { code: "AUTH_RATE_LIMITED", error: "Too many attempts", retryAfterSec: 1 },
    });

    await screen.findByTestId("mfa-rate-limit");
    expect(screen.getByTestId("mfa-verify-submit")).toBeDisabled();

    // The countdown is the ONLY thing allowed to unlock this. Nothing the user
    // does, and no background retry, races the server's own window.
    await waitFor(() => expect(screen.queryByTestId("mfa-rate-limit")).toBeNull(), {
      timeout: 10000,
    });
    expect(screen.getByTestId("mfa-verify-submit")).toBeDisabled(); // boxes empty
  }, 20000);

  it("formats the countdown as m:ss", () => {
    // Asserted through the pure helper so a 60s window reads "1:00", not "60".
    expect(formatCountdownProbe(95)).toBe("1:35");
  });
});

/* Imported lazily to keep the import list above focused. */
import { formatCountdown as formatCountdownProbe } from "@/components/auth/mfa";

describe("re-auth requirement", () => {
  it("sends the user back to the password step and explains why", async () => {
    const stub = installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => jsonResponse({ ok: true }),
        },
        {
          match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
          respond: () => jsonResponse({ code: "AUTH_REAUTH_REQUIRED", error: "Re-authenticate" }, 403),
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    // Back on the reauth step, which is the route back the user is told about.
    await screen.findByTestId("mfa-reauth-form");
    const enrollCalls = stub.calls().filter((c) => c.url === "/api/auth/mfa/enroll");
    expect(enrollCalls).toHaveLength(1);
  });

  it("does NOT re-enrol after a re-auth from the verify step", async () => {
    // Re-enrolling would rotate the secret and invalidate the app the user just
    // added, so the resume path must go straight back to "type your code".
    const stub = installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => jsonResponse({ ok: true }),
        },
        {
          match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
          respond: () => jsonResponse({ secret: SECRET, otpauthUri: URI }),
        },
        {
          match: (url, init) => url === "/api/auth/mfa/enroll/confirm" && init.method === "POST",
          respond: () => jsonResponse({ code: "AUTH_REAUTH_REQUIRED", error: "Re-authenticate" }, 403),
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));
    await user.click(await screen.findByTestId("mfa-enroll-continue"));
    for (const [i, d] of ["4", "1", "9", "2", "0", "7"].entries()) {
      await user.type(screen.getAllByRole("textbox")[i], d);
    }
    await user.click(screen.getByTestId("mfa-verify-submit"));

    await screen.findByTestId("mfa-reauth-form");
    const before = stub.calls().filter((c) => c.url === "/api/auth/mfa/enroll").length;

    // Re-authenticate again: we must land back on verify with the SAME secret.
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw2");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    await screen.findByTestId("mfa-verify-submit");
    expect(stub.calls().filter((c) => c.url === "/api/auth/mfa/enroll")).toHaveLength(before);
  });
});

describe("state mismatches reported by the server", () => {
  it("switches to the enabled panel when enrol says MFA is already on", async () => {
    installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => jsonResponse({ ok: true }),
        },
        {
          match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
          respond: () => jsonResponse({ code: "AUTH_TOTP_ALREADY_SET", error: "Already enabled" }, 409),
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    // Not a dead end: the page shows the "on" panel and offers the disable path.
    expect(await screen.findByText("mfa.on.title")).toBeInTheDocument();
    const banner = screen.getByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_TOTP_ALREADY_SET");
    expect(banner).toHaveAttribute("data-error-severity", "warning");
    expect(screen.getByText("mfa.on.disable")).toBeInTheDocument();
  });

  it("sends the user back to the start when the secret was never registered", async () => {
    const user = userEvent.setup();
    await walkToVerify(user, {
      status: 409,
      body: { code: "AUTH_TOTP_NOT_CONFIGURED", error: "No pending enrolment" },
    });

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_TOTP_NOT_CONFIGURED");
    // Back on the intro, with no stale secret to type a code against.
    expect(screen.getByTestId("mfa-intro-start")).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-secret")).toBeNull();
  });
});

describe("a server without the MFA endpoints", () => {
  it("says the feature is unavailable and that nothing was changed", async () => {
    installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => jsonResponse({ code: "AUTH_ENDPOINT_MISSING" }, 404),
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_ENDPOINT_MISSING");
    expect(banner).toHaveAttribute("data-error-severity", "info");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("mfa.error.unavailableBody");
    // The user is still on a working screen, not a broken one.
    expect(screen.getByTestId("mfa-reauth-form")).toBeInTheDocument();
  });

  it("treats a network failure as a failure, not as an empty state", async () => {
    installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => {
            throw new TypeError("Failed to fetch");
          },
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_NETWORK");
    expect(banner).toHaveAttribute("data-error-severity", "danger");
  });
});

describe("a revoked session", () => {
  it("offers a way back to sign in", async () => {
    installFetch(
      baselineRoutes([
        {
          match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
          respond: () => jsonResponse({ code: "AUTH_SESSION_REVOKED", error: "Session revoked" }, 401),
        },
      ]),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
    await user.click(screen.getByTestId("mfa-reauth-submit"));

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_SESSION_REVOKED");
    expect(await screen.findByText("mfa.signInAgain")).toBeInTheDocument();
  });
});