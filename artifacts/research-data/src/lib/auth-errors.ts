/**
 * ============================================================================
 * AUTH ERROR CATALOGUE
 * ============================================================================
 *
 * The auth API returns BOTH a stable machine code and a human English
 * `error` string. Until this file existed the UI rendered `error` directly,
 * which meant every failure on the sign-in screen was English even when the
 * interface was Arabic.
 *
 * The rule from here on: **switch on `code`, translate the message, and fall
 * back to the raw `error` only when the code is one we do not recognise.** A
 * code we have never seen still has to produce readable copy rather than a
 * blank banner or a leaked internal string.
 *
 * Nothing in here imports React or i18next: it is a pure function of
 * (response, translate) so it can be unit-tested without a DOM, and so the
 * same catalogue can be reused by the recovery pages, the OTP component and
 * anything else that has to explain an auth failure.
 */

/* -------------------------------------------------------------------------- */
/* Contract types                                                              */
/* -------------------------------------------------------------------------- */

/** The shape the backend adds `code` to. Everything is optional and defensive. */
export interface AuthErrorResponse {
  /** Existing human-readable (English) message. Unchanged by the contract. */
  error?: string | null;
  /** Stable machine code, e.g. `AUTH_INVALID_CREDENTIALS`. */
  code?: string | null;
  /** Present on every 429. */
  retryAfterSec?: number | null;
  /** Opaque passthrough — the login OTP flow needs `loginToken` off an error. */
  [key: string]: unknown;
}

/**
 * Every code in the auth contract. Kept as a tuple rather than a bare union so
 * the map below is checked against it at compile time: adding a code to the
 * contract without writing copy here is a type error, not a silent English
 * banner in production.
 */
export const AUTH_ERROR_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_ACCOUNT_LOCKED",
  "AUTH_ACCOUNT_PENDING",
  "AUTH_ACCOUNT_SUSPENDED",
  "AUTH_RATE_LIMITED",
  "AUTH_MFA_REQUIRED",
  "AUTH_MFA_INVALID",
  "AUTH_MFA_NOT_ENROLLED",
  "AUTH_RECOVERY_INVALID",
  "AUTH_RESET_TOKEN_INVALID",
  "AUTH_RESET_TOKEN_EXPIRED",
  "AUTH_RESET_TOKEN_USED",
  "AUTH_PASSWORD_WEAK",
  "AUTH_EMAIL_INVALID",
  "AUTH_USERNAME_TAKEN",
  "AUTH_FIELD_REQUIRED",
  "AUTH_REAUTH_REQUIRED",
  "AUTH_SESSION_EXPIRED",
  "AUTH_OAUTH_INVALID",
  "AUTH_OAUTH_LINK_REQUIRED",
  "AUTH_SESSION_REVOKED",
  // Added by the api-server auth build. `AUTH_TOTP_*` are emitted when an
  // enrolment is attempted on an account that already has (or lacks) an
  // authenticator; `AUTH_SESSION_CURRENT` when a caller tries to revoke the
  // session it is currently using.
  "AUTH_TOTP_NOT_CONFIGURED",
  "AUTH_TOTP_ALREADY_SET",
  "AUTH_SESSION_CURRENT",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * How a failure should be *presented*. `kind` is deliberately coarser than
 * `code`: the UI branches on behaviour (is this retryable? does it send the
 * user somewhere else?), and two codes with identical behaviour should not
 * need two branches.
 */
export type AuthErrorKind =
  /** Wrong username/password. Retryable in place. */
  | "credentials"
  /** Account exists but is not usable (pending / suspended / locked). */
  | "account"
  /** Throttled; comes with a countdown. */
  | "rate-limited"
  /** Second-factor problems. */
  | "mfa"
  /** Recovery / backup code problems. */
  | "recovery"
  /** Password-reset token problems. */
  | "reset"
  /** A field value the server refused. */
  | "validation"
  /** The session is gone; the user must sign in again. */
  | "session"
  /** Federated sign-in problems. */
  | "oauth"
  /** Authenticator-app enrolment state. */
  | "totp"
  /** No code, or a code we do not know yet. */
  | "unknown";

/**
 * Minimal shape of `t` that this module needs.
 *
 * Deliberately NOT `TFunction`: the auth pages pass react-i18next's `t`, but
 * the tests pass a two-line stub, and keeping the dependency to `(key,
 * fallback, params)` means the catalogue is testable without i18next.
 */
export type AuthTranslate = (
  key: string,
  fallback?: string,
  params?: Record<string, unknown>,
) => string;

export interface AuthErrorDescriptor {
  /** i18n key reported to the catalogue owner. */
  key: string;
  /**
   * English copy shown when the key is not yet translated. This is also the
   * string a screen reader gets in every locale until `ar.ts` catches up.
   */
  fallback: string;
  kind: AuthErrorKind;
  /** True when simply submitting again could succeed. */
  retryable: boolean;
  /**
   * Seconds to assume on a 429 when the server omits `retryAfterSec`. Showing
   * no countdown at all would be worse than showing a conservative one.
   */
  defaultRetryAfterSec?: number;
}

export interface ResolvedAuthError {
  /** Echo of the code we resolved on, or `null` for the raw fallback. */
  code: string | null;
  /** Translated, user-facing message. Ready to render. */
  message: string;
  kind: AuthErrorKind;
  /** Countdown in seconds, or `null` when the server did not throttle us. */
  retryAfterSec: number | null;
  /** Whether retrying the same request could work. */
  retryable: boolean;
  /** `AUTH_ACCOUNT_LOCKED` — retrying in place cannot clear this. */
  locked: boolean;
  /** The session ended; the user has to sign in again. */
  sessionEnded: boolean;
}

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Code -> copy. Ordered to match {@link AUTH_ERROR_CODES}.
 *
 * COPY RULES (these are not stylistic):
 *  - Never say "wrong password" when the account may not exist. Login and
 *    password reset share `AUTH_INVALID_CREDENTIALS`-style wording that stays
 *    true either way, so the message cannot be used to enumerate accounts.
 *  - An expired reset link gets real instructions, because that is the single
 *    most common outcome of the flow (links are deliberately short-lived) and
 *    a generic "request failed" dead-ends the user with no next step.
 *  - Never suggest a retry that the server will reject.
 */
export const AUTH_ERROR_MAP: Record<AuthErrorCode, AuthErrorDescriptor> = {
  AUTH_INVALID_CREDENTIALS: {
    key: "auth.errInvalidCredentials",
    fallback:
      "That username and password do not match. Check them and try again, or reset your password.",
    kind: "credentials",
    retryable: true,
  },
  AUTH_ACCOUNT_LOCKED: {
    key: "auth.errAccountLocked",
    fallback:
      "This account is locked after too many failed attempts. An administrator has to unlock it before you can sign in.",
    kind: "account",
    retryable: false,
  },
  AUTH_ACCOUNT_PENDING: {
    key: "auth.errAccountPending",
    fallback:
      "Your account is still waiting for administrator approval. You will be able to sign in once it is approved.",
    kind: "account",
    retryable: false,
  },
  AUTH_ACCOUNT_SUSPENDED: {
    key: "auth.errAccountSuspended",
    fallback:
      "This account has been suspended. Contact an administrator if you think this is a mistake.",
    kind: "account",
    retryable: false,
  },
  AUTH_RATE_LIMITED: {
    key: "auth.errRateLimited",
    fallback: "Too many attempts in a row. Wait for the timer below before trying again.",
    kind: "rate-limited",
    retryable: true,
    defaultRetryAfterSec: 60,
  },
  AUTH_MFA_REQUIRED: {
    key: "auth.errMfaRequired",
    fallback:
      "This account needs two-factor verification. Enter the code we sent to your email to continue.",
    kind: "mfa",
    retryable: true,
  },
  AUTH_MFA_INVALID: {
    key: "auth.errMfaInvalid",
    fallback: "That verification code is not correct. Check the code and enter it again.",
    kind: "mfa",
    retryable: true,
  },
  AUTH_MFA_NOT_ENROLLED: {
    key: "auth.errMfaNotEnrolled",
    fallback:
      "No two-factor method is enrolled for this account. Sign in and enrol one in Settings first.",
    kind: "mfa",
    retryable: false,
  },
  AUTH_RECOVERY_INVALID: {
    key: "auth.errRecoveryInvalid",
    fallback: "That recovery code is not valid. Check the code you saved and try again.",
    kind: "recovery",
    retryable: true,
  },
  AUTH_RESET_TOKEN_INVALID: {
    key: "auth.errResetTokenInvalid",
    fallback:
      "This password-reset link is not valid. It may have been altered in transit — request a new one.",
    kind: "reset",
    retryable: false,
  },
  AUTH_RESET_TOKEN_EXPIRED: {
    key: "auth.errResetTokenExpired",
    fallback:
      "This password-reset link has expired. Reset links are deliberately short-lived to protect your account — request a new link and it will work immediately.",
    kind: "reset",
    retryable: false,
  },
  AUTH_RESET_TOKEN_USED: {
    key: "auth.errResetTokenUsed",
    fallback:
      "This password-reset link has already been used. If that was you, sign in with your new password; otherwise request a new link.",
    kind: "reset",
    retryable: false,
  },
  AUTH_PASSWORD_WEAK: {
    key: "auth.errPasswordWeak",
    fallback:
      "That password does not meet the security rules yet. Use 12 or more characters with upper case, lower case, a number and a symbol.",
    kind: "validation",
    retryable: true,
  },
  AUTH_EMAIL_INVALID: {
    key: "auth.errEmailUndeliverable",
    fallback: "We could not send anything to that email address. Check it and try again.",
    kind: "validation",
    retryable: true,
  },
  AUTH_USERNAME_TAKEN: {
    key: "auth.errUsernameTaken",
    fallback: "That username is already taken. Choose a different one.",
    kind: "validation",
    retryable: true,
  },
  AUTH_FIELD_REQUIRED: {
    key: "auth.errFieldRequired",
    fallback: "A required field is missing. Fill in every required field and try again.",
    kind: "validation",
    retryable: true,
  },
  AUTH_REAUTH_REQUIRED: {
    key: "auth.errReauthRequired",
    fallback: "Confirm your current password to continue.",
    kind: "session",
    retryable: true,
  },
  AUTH_SESSION_EXPIRED: {
    key: "auth.errSessionExpired",
    fallback: "Your session expired, so you were signed out. Sign in again to carry on where you left off.",
    kind: "session",
    retryable: false,
  },
  AUTH_OAUTH_INVALID: {
    key: "auth.errOauthInvalid",
    fallback: "Sign-in with that provider did not complete. Try again, or use your username and password.",
    kind: "oauth",
    retryable: true,
  },
  AUTH_OAUTH_LINK_REQUIRED: {
    key: "auth.errOauthLinkRequired",
    fallback:
      "That provider is not linked to your account. Sign in with your username and password, then link the provider in Settings.",
    kind: "oauth",
    retryable: false,
  },
  AUTH_SESSION_REVOKED: {
    key: "auth.errSessionRevoked",
    fallback: "This session was signed out. Sign in again to continue.",
    kind: "session",
    retryable: false,
  },

  AUTH_TOTP_NOT_CONFIGURED: {
    key: "auth.errTotpNotConfigured",
    fallback:
      "No authenticator app is registered on this account yet. Start the setup again to register your app.",
    kind: "totp",
    retryable: false,
  },
  AUTH_TOTP_ALREADY_SET: {
    key: "auth.errTotpAlreadySet",
    fallback:
      "This account already uses an authenticator app. Turn two-factor authentication off first if you want to replace it.",
    kind: "totp",
    retryable: false,
  },
  AUTH_SESSION_CURRENT: {
    key: "auth.errSessionCurrent",
    fallback:
      "You cannot end the session you are using from here. Sign out instead — that ends it everywhere, including here.",
    kind: "session",
    retryable: false,
  },
};


/** Codes that mean "the session is over" rather than "that was wrong". */
const SESSION_ENDED_CODES = new Set<string>([
  "AUTH_SESSION_EXPIRED",
  "AUTH_SESSION_REVOKED",
]);

/** Fallback wait when a 429 arrives with no `retryAfterSec`. */
export const DEFAULT_RETRY_AFTER_SEC = 60;

/* -------------------------------------------------------------------------- */
/* Translation helper                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `t(key, fallback, params)` that is honest about a MISS.
 *
 * i18next returns the key itself when a translation is absent and no default
 * value was supplied — but it returns the *default value* when one is, which
 * is why every call site here passes an English fallback. The one remaining
 * miss case is a translator/provider that echoes the key (the test mock in
 * `tests/vitest.setup.tsx` implements `t` as `key => key`, and some custom
 * backends do the same). In that case the resolved string is identical to the
 * key we asked for, which means the lookup failed — and the English fallback
 * is the better answer than showing the user `auth.errAccountLocked`.
 *
 * Interpolation is applied to the resolved string rather than trusting the
 * provider, so `{{seconds}}` is filled in on the fallback path too.
 */
export function tr(
  t: AuthTranslate,
  key: string,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  let resolved: string;
  try {
    resolved = t(key, fallback, params);
  } catch {
    resolved = "";
  }
  if (!resolved || resolved === key) resolved = fallback;
  return interpolate(resolved, params);
}

function interpolate(
  template: string,
  params?: Record<string, unknown>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/**
 * `m:ss` for a countdown. Used wherever a raw second count would read badly
 * ("in 90s" vs "in 1:30"). Returns `"0:00"` for zero and for anything
 * non-finite, so a caller can never render `NaN:NaN`.
 */
export function formatCountdown(totalSeconds: number | null | undefined): string {
  const total =
    typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
      ? Math.max(0, Math.ceil(totalSeconds))
      : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* The error type                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Thrown by every auth request in `use-auth`.
 *
 * `message` stays the raw English `error` so that anything reading
 * `mutation.error.message` (the logout/settings paths, the OTP component's
 * last-resort text) sees exactly what it saw before. The *structured* payload
 * is what callers should use.
 */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSec: number | null;
  readonly payload: AuthErrorResponse;

  constructor(
    payload: AuthErrorResponse,
    status = 0,
    fallbackMessage = "Authentication failed",
  ) {
    const message =
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : fallbackMessage;
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = typeof payload.code === "string" ? payload.code : null;
    this.retryAfterSec =
      typeof payload.retryAfterSec === "number" &&
      Number.isFinite(payload.retryAfterSec)
        ? Math.max(0, Math.ceil(payload.retryAfterSec))
        : null;
    this.payload = payload;
    // Restores the prototype chain when the class is down-levelled.
    Object.setPrototypeOf(this, AuthApiError.prototype);
  }
}

/** Duck-typed read of the payload off anything throwable. */
function payloadOf(err: unknown): AuthErrorResponse | null {
  if (err instanceof AuthApiError) return err.payload;
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as { payload?: unknown; authPayload?: unknown };
  const raw = candidate.payload ?? candidate.authPayload;
  if (typeof raw !== "object" || raw === null) return null;
  return raw as AuthErrorResponse;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Map an auth response body to translated, user-facing copy.
 *
 * Resolution order, and why:
 *  1. A known `code` -> catalogue copy. This is the contract path.
 *  2. No code, but HTTP 429 -> rate-limit copy with the countdown. A throttled
 *     response is still a throttled response even if the deployment predates
 *     the `code` field.
 *  3. No code, no throttle -> the server's own `error` string. Unknown future
 *     codes therefore still say something useful, and a legacy backend that
 *     only sends `error` keeps working unchanged.
 *  4. Nothing at all -> a generic local message, never an empty banner.
 */
export function resolveAuthError(
  response: AuthErrorResponse | null | undefined,
  t: AuthTranslate,
  options: { status?: number } = {},
): ResolvedAuthError {
  const code =
    typeof response?.code === "string" && response.code.trim()
      ? response.code
      : null;
  const status = options.status ?? 0;

  const rawRetry =
    typeof response?.retryAfterSec === "number" &&
    Number.isFinite(response.retryAfterSec)
      ? Math.max(0, Math.ceil(response.retryAfterSec))
      : null;

  const descriptor = code ? AUTH_ERROR_MAP[code as AuthErrorCode] : undefined;

  if (descriptor) {
    const retryAfterSec =
      descriptor.kind === "rate-limited"
        ? (rawRetry ?? descriptor.defaultRetryAfterSec ?? DEFAULT_RETRY_AFTER_SEC)
        : rawRetry;
    return {
      code,
      message: tr(t, descriptor.key, descriptor.fallback),
      kind: descriptor.kind,
      retryAfterSec,
      retryable: descriptor.retryable,
      locked: code === "AUTH_ACCOUNT_LOCKED",
      sessionEnded: code !== null && SESSION_ENDED_CODES.has(code),
    };
  }

  if (status === 429) {
    const fallback = AUTH_ERROR_MAP.AUTH_RATE_LIMITED;
    return {
      code,
      message: tr(t, fallback.key, fallback.fallback),
      kind: "rate-limited",
      retryAfterSec: rawRetry ?? DEFAULT_RETRY_AFTER_SEC,
      retryable: true,
      locked: false,
      sessionEnded: false,
    };
  }

  const rawError =
    typeof response?.error === "string" && response.error.trim()
      ? response.error
      : null;

  if (rawError) {
    return {
      code,
      message: rawError,
      kind: "unknown",
      // An unmapped code may still be a 429 we did not recognise.
      retryAfterSec: rawRetry,
      retryable: true,
      locked: false,
      sessionEnded: false,
    };
  }

  return {
    code,
    message: tr(
      t,
      "auth.errUnknown",
      "Something went wrong while signing you in. Please try again.",
    ),
    kind: "unknown",
    retryAfterSec: rawRetry,
    retryable: true,
    locked: false,
    sessionEnded: false,
  };
}

/**
 * Resolve whatever a mutation rejected with.
 *
 * `mutateAsync` rejects, so every error path in the auth surface funnels
 * through here rather than reaching for `err.message` — that is how the raw
 * English string stopped reaching the screen in the first place.
 */
export function authErrorFromThrown(
  err: unknown,
  t: AuthTranslate,
): ResolvedAuthError {
  const payload = payloadOf(err);
  const rawStatus = typeof err === "object" && err !== null
    ? (err as { status?: unknown }).status
    : undefined;
  const status = typeof rawStatus === "number" ? rawStatus : 0;

  if (payload) {
    return resolveAuthError(payload, t, { status });
  }

  // A network failure has no payload at all: `fetch` rejected, or the request
  // aborted on the timeout. Say so instead of leaking "Failed to fetch".
  if (err instanceof Error && err.name === "AbortError") {
    return resolveAuthError({}, t, { status: 0 });
  }

  const message = err instanceof Error ? err.message : "";
  return resolveAuthError({ error: message || null }, t, { status });
}

/* -------------------------------------------------------------------------- */
/* Session-expiry routing                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where to send a user whose session ended.
 *
 * The reason travels as a query parameter so `/login` can explain what
 * happened on arrival — the alternative (a bare redirect) is a dead end where
 * the user is told nothing about why they are back on the sign-in screen.
 */
export const SESSION_EXPIRED_REASON_PARAM = "reason";
export const SESSION_EXPIRED_REASON_VALUE = "session-expired";
export const SESSION_EXPIRED_LOGIN_PATH = `/login?${SESSION_EXPIRED_REASON_PARAM}=${SESSION_EXPIRED_REASON_VALUE}`;

/** True when a `?reason=` value means "you were signed out mid-session". */
export function isSessionExpiredReason(value: string | null | undefined): boolean {
  return value === SESSION_EXPIRED_REASON_VALUE;
}
