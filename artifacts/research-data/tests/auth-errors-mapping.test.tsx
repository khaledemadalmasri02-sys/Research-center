import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MAP,
  AuthApiError,
  DEFAULT_RETRY_AFTER_SEC,
  SESSION_EXPIRED_LOGIN_PATH,
  authErrorFromThrown,
  formatCountdown,
  isSessionExpiredReason,
  resolveAuthError,
  tr,
  type AuthErrorCode,
  type AuthTranslate,
} from "@/lib/auth-errors";
import { useRetryCountdown } from "@/components/auth/use-retry-countdown";

/**
 * ============================================================================
 * AUTH ERROR CATALOGUE
 * ============================================================================
 *
 * The regression this file exists to prevent: the auth UI rendered the
 * backend's English `error` string, so the entire sign-in screen was English
 * in Arabic. These tests pin the contract that a `code` always wins, and that a
 * code nobody has seen yet still produces readable copy.
 */

/**
 * A translator that behaves like a *fully translated* provider: the key is
 * resolved to `ar:<key>` so a test can tell "we asked for a key" apart from
 * "we fell back to English".
 */
const translated: AuthTranslate = (key, _fallback, _params) => `ar:${key}`;

/** A translator that has no entry for anything, as in a fresh install. */
const untranslated: AuthTranslate = (key) => key;

/** i18next's real miss behaviour when no default value is supplied. */
const echoesNothing: AuthTranslate = () => "";

afterEach(() => {
  vi.useRealTimers();
});

describe("auth error catalogue — coverage", () => {
  it("has a descriptor for every code in the contract", () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(AUTH_ERROR_MAP[code], `missing descriptor for ${code}`).toBeDefined();
    }
  });

  it("gives every code a distinct i18n key and English fallback", () => {
    const keys = AUTH_ERROR_CODES.map((c) => AUTH_ERROR_MAP[c].key);
    const fallbacks = AUTH_ERROR_CODES.map((c) => AUTH_ERROR_MAP[c].fallback);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(fallbacks).size).toBe(fallbacks.length);
  });

  it("resolves every code to a non-empty, user-facing message", () => {
    for (const code of AUTH_ERROR_CODES) {
      const resolved = resolveAuthError({ code }, untranslated);
      expect(resolved.message.length, code).toBeGreaterThan(0);
      expect(resolved.message, code).not.toContain("{{");
      // Never leak the machine code at a user.
      expect(resolved.message, code).not.toBe(code);
      expect(resolved.code, code).toBe(code);
    }
  });

  it("never promises a retry it cannot deliver", () => {
    const nonRetryable: AuthErrorCode[] = [
      "AUTH_ACCOUNT_LOCKED",
      "AUTH_ACCOUNT_PENDING",
      "AUTH_ACCOUNT_SUSPENDED",
      "AUTH_RESET_TOKEN_EXPIRED",
      "AUTH_RESET_TOKEN_USED",
      "AUTH_RESET_TOKEN_INVALID",
      "AUTH_SESSION_EXPIRED",
      "AUTH_SESSION_REVOKED",
    ];
    for (const code of nonRetryable) {
      expect(resolveAuthError({ code }, untranslated).retryable, code).toBe(false);
    }
    for (const code of ["AUTH_INVALID_CREDENTIALS", "AUTH_MFA_INVALID"] as const) {
      expect(resolveAuthError({ code }, untranslated).retryable, code).toBe(true);
    }
  });
});

describe("auth error catalogue — code wins over the English string", () => {
  it("translates a known code instead of echoing the backend's English", () => {
    const resolved = resolveAuthError(
      { code: "AUTH_ACCOUNT_LOCKED", error: "account locked" },
      translated,
    );
    expect(resolved.message).toBe("ar:auth.errAccountLocked");
    // The decisive assertion: the raw English string is NOT what the user sees.
    expect(resolved.message).not.toContain("account locked");
    expect(resolved.locked).toBe(true);
    expect(resolved.kind).toBe("account");
  });

  it("uses the English fallback when the key is not translated", () => {
    const resolved = resolveAuthError(
      { code: "AUTH_INVALID_CREDENTIALS" },
      untranslated,
    );
    expect(resolved.message).toBe(
      AUTH_ERROR_MAP.AUTH_INVALID_CREDENTIALS.fallback,
    );
    expect(resolved.kind).toBe("credentials");
  });

  it("flags a session-ended error so the UI can route to login", () => {
    for (const code of ["AUTH_SESSION_EXPIRED", "AUTH_SESSION_REVOKED"] as const) {
      const resolved = resolveAuthError({ code }, untranslated);
      expect(resolved.sessionEnded, code).toBe(true);
      expect(resolved.kind, code).toBe("session");
    }
    expect(resolveAuthError({ code: "AUTH_MFA_REQUIRED" }, untranslated).sessionEnded).toBe(
      false,
    );
  });

  it("marks MFA codes apart from credential codes", () => {
    expect(resolveAuthError({ code: "AUTH_MFA_REQUIRED" }, untranslated).kind).toBe("mfa");
    expect(resolveAuthError({ code: "AUTH_MFA_INVALID" }, untranslated).kind).toBe("mfa");
    expect(resolveAuthError({ code: "AUTH_MFA_NOT_ENROLLED" }, untranslated).kind).toBe(
      "mfa",
    );
  });

  it("gives the two OAuth codes different copy, because the next step differs", () => {
    const invalid = resolveAuthError({ code: "AUTH_OAUTH_INVALID" }, untranslated);
    const link = resolveAuthError({ code: "AUTH_OAUTH_LINK_REQUIRED" }, untranslated);
    expect(invalid.message).not.toBe(link.message);
    expect(link.retryable).toBe(false);
    expect(invalid.retryable).toBe(true);
  });

  it("gives the three reset-token problems genuinely different copy", () => {
    const expired = resolveAuthError({ code: "AUTH_RESET_TOKEN_EXPIRED" }, untranslated);
    const used = resolveAuthError({ code: "AUTH_RESET_TOKEN_USED" }, untranslated);
    const invalid = resolveAuthError({ code: "AUTH_RESET_TOKEN_INVALID" }, untranslated);
    expect(new Set([expired.message, used.message, invalid.message]).size).toBe(3);
    // The expired case is the common one and has to say what to do next.
    expect(expired.message).toMatch(/request a new link/i);
    // The used case must mention that a link only works once, or the user
    // retries the same URL forever.
    expect(used.message).toMatch(/already been used|sign in with your new password/i);
    for (const r of [expired, used, invalid]) {
      expect(r.kind).toBe("reset");
      expect(r.retryable).toBe(false);
    }
  });
});

describe("auth error catalogue — unknown code fallback", () => {
  it("falls back to the raw error string for a code we do not know", () => {
    const resolved = resolveAuthError(
      { code: "AUTH_SOMETHING_NEW_2030", error: "Policy 42 is unavailable" },
      translated,
    );
    expect(resolved.code).toBe("AUTH_SOMETHING_NEW_2030");
    expect(resolved.message).toBe("Policy 42 is unavailable");
    expect(resolved.kind).toBe("unknown");
    // Unknown is not known-not-retryable: keep the retry affordance.
    expect(resolved.retryable).toBe(true);
  });

  it("falls back to the raw error string when there is no code at all", () => {
    // A pre-contract deployment sends only `error`; this must keep working.
    const resolved = resolveAuthError({ error: "Invalid credentials" }, translated);
    expect(resolved.message).toBe("Invalid credentials");
    expect(resolved.code).toBeNull();
  });

  it("produces a generic message when there is neither a code nor an error", () => {
    const translatedOut = resolveAuthError({}, translated);
    expect(translatedOut.message).toBe("ar:auth.errUnknown");
    // Never an empty banner, and never the key: the user has to be told
    // something happened even on a response with no body at all.
    const bare = resolveAuthError({}, untranslated);
    expect(bare.message).not.toBe("auth.errUnknown");
    expect(bare.message).toMatch(/went wrong|try again/i);
    expect(bare.kind).toBe("unknown");
    expect(bare.retryable).toBe(true);
  });

  it("ignores a blank error string rather than rendering an empty banner", () => {
    const resolved = resolveAuthError({ error: "   ", code: null }, translated);
    expect(resolved.message).toBe("ar:auth.errUnknown");
  });
});

describe("auth error catalogue — rate limiting and the countdown", () => {
  it("passes retryAfterSec through from a coded 429", () => {
    const resolved = resolveAuthError(
      { code: "AUTH_RATE_LIMITED", error: "slow down", retryAfterSec: 42 },
      translated,
    );
    expect(resolved.kind).toBe("rate-limited");
    expect(resolved.retryAfterSec).toBe(42);
  });

  it("assumes a conservative wait when the server omits retryAfterSec", () => {
    const resolved = resolveAuthError({ code: "AUTH_RATE_LIMITED" }, translated);
    expect(resolved.retryAfterSec).toBe(DEFAULT_RETRY_AFTER_SEC);
  });

  it("treats a bare HTTP 429 as rate limiting even without a code", () => {
    // A deployment that predates the `code` field still throttles us.
    const resolved = resolveAuthError(
      { error: "Too many requests" },
      translated,
      { status: 429 },
    );
    expect(resolved.kind).toBe("rate-limited");
    expect(resolved.retryAfterSec).toBe(DEFAULT_RETRY_AFTER_SEC);
    expect(resolved.message).toBe("ar:auth.errRateLimited");
  });

  it("reads retryAfterSec from an uncoded 429 body", () => {
    const resolved = resolveAuthError({ retryAfterSec: 7 }, translated, { status: 429 });
    expect(resolved.retryAfterSec).toBe(7);
  });

  it("does not invent a countdown for a non-throttled error", () => {
    expect(
      resolveAuthError({ code: "AUTH_INVALID_CREDENTIALS" }, translated).retryAfterSec,
    ).toBeNull();
  });

  it("clamps a negative or non-finite retryAfterSec", () => {
    expect(
      resolveAuthError(
        { code: "AUTH_RATE_LIMITED", retryAfterSec: -5 },
        translated,
      ).retryAfterSec,
    ).toBe(0);
    expect(
      resolveAuthError(
        { code: "AUTH_RATE_LIMITED", retryAfterSec: Number.NaN },
        translated,
      ).retryAfterSec,
    ).toBe(DEFAULT_RETRY_AFTER_SEC);
  });

  it("ticks the countdown down once a second and stops at zero", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRetryCountdown(3));

    expect(result.current).toBe(3);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 0 means "the wait is over", which is distinct from null ("no countdown").
    expect(result.current).toBe(0);

    // And it must not go negative, however long the test runs.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(0);
  });

  it("reports no countdown at all when the error was not throttled", () => {
    const { result } = renderHook(() => useRetryCountdown(null));
    expect(result.current).toBeNull();
    const { result: undef } = renderHook(() => useRetryCountdown(undefined));
    expect(undef.current).toBeNull();
    const { result: zero } = renderHook(() => useRetryCountdown(0));
    expect(zero.current).toBe(0);
  });

  it("re-seeds when a new throttle arrives", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ sec }: { sec: number | null }) => useRetryCountdown(sec),
      { initialProps: { sec: 5 as number | null } },
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(4);
    rerender({ sec: 30 });
    expect(result.current).toBe(30);
    rerender({ sec: null });
    expect(result.current).toBeNull();
  });

  it("formats a countdown as m:ss and never as NaN", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(59)).toBe("0:59");
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(null)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
  });
});

describe("auth error catalogue — thrown errors", () => {
  it("keeps the raw English message on the Error for legacy consumers", () => {
    const err = new AuthApiError(
      { error: "Account locked", code: "AUTH_ACCOUNT_LOCKED", retryAfterSec: 0 },
      423,
      "Login failed",
    );
    expect(err).toBeInstanceOf(Error);
    // Anything still reading `mutation.error.message` sees exactly what it saw
    // before this contract existed.
    expect(err.message).toBe("Account locked");
    expect(err.code).toBe("AUTH_ACCOUNT_LOCKED");
    expect(err.status).toBe(423);
  });

  it("uses the caller's fallback message when the body has none", () => {
    const err = new AuthApiError({}, 500, "Login failed");
    expect(err.message).toBe("Login failed");
    expect(err.code).toBeNull();
  });

  it("maps a thrown AuthApiError through the catalogue", () => {
    const err = new AuthApiError(
      { error: "Too many attempts", code: "AUTH_RATE_LIMITED", retryAfterSec: 30 },
      429,
    );
    const resolved = authErrorFromThrown(err, translated);
    expect(resolved.message).toBe("ar:auth.errRateLimited");
    expect(resolved.retryAfterSec).toBe(30);
    expect(resolved.kind).toBe("rate-limited");
  });

  it("maps a duck-typed payload, so a non-AuthApiError still resolves", () => {
    const err = Object.assign(new Error("boom"), {
      payload: { error: "boom", code: "AUTH_MFA_INVALID" },
    });
    expect(authErrorFromThrown(err, translated).message).toBe("ar:auth.errMfaInvalid");
  });

  it("falls back to a plain Error message when there is no payload", () => {
    const resolved = authErrorFromThrown(new Error("Failed to fetch"), translated);
    expect(resolved.message).toBe("Failed to fetch");
    expect(resolved.kind).toBe("unknown");
  });

  it("does not leak 'The operation was aborted' from the request timeout", () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    expect(authErrorFromThrown(abort, translated).message).toBe("ar:auth.errUnknown");
  });

  it("survives being handed something that is not an Error", () => {
    expect(authErrorFromThrown(undefined, translated).message).toBe("ar:auth.errUnknown");
    expect(authErrorFromThrown("nope", translated).message).toBe("ar:auth.errUnknown");
  });
});

describe("translation helper", () => {
  it("returns the translation when the key resolves", () => {
    expect(tr(translated, "auth.x", "English")).toBe("ar:auth.x");
  });

  it("returns the English fallback when the provider echoes the key", () => {
    // The vitest mock implements `t` as `key => key`; so do some custom
    // backends. Either way the user must not see the key.
    expect(tr(untranslated, "auth.errAccountLocked", "Locked.")).toBe("Locked.");
  });

  it("returns the English fallback when the provider returns nothing", () => {
    expect(tr(echoesNothing, "auth.x", "English")).toBe("English");
  });

  it("interpolates placeholders into the fallback path", () => {
    const out = tr(untranslated, "auth.x", "Retry in {{time}}.", { time: "0:42" });
    expect(out).toBe("Retry in 0:42.");
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    expect(tr(untranslated, "auth.x", "Hi {{missing}}", { other: 1 })).toBe(
      "Hi {{missing}}",
    );
  });

  it("survives a translator that throws", () => {
    const hostile: AuthTranslate = () => {
      throw new Error("i18n not initialised");
    };
    expect(tr(hostile, "auth.x", "English")).toBe("English");
  });
});

describe("session-expiry routing", () => {
  it("routes to login with a reason the login screen can explain", () => {
    expect(SESSION_EXPIRED_LOGIN_PATH).toBe("/login?reason=session-expired");
    expect(isSessionExpiredReason("session-expired")).toBe(true);
    expect(isSessionExpiredReason(null)).toBe(false);
    expect(isSessionExpiredReason("something-else")).toBe(false);
  });
});
