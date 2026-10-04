/**
 * Error normalisation for the MFA / sessions endpoints.
 *
 * WHY THIS LIVES HERE AND NOT IN `@/lib/auth-errors`.
 * A parallel agent owns `src/lib/auth-errors.ts`. That module is the app-wide
 * mapper; this file is the MFA/sessions-scoped view of the same contract, kept
 * next to the components that consume it so the two cannot drift. If their
 * mapper lands first, this becomes a thin re-export — see the note on
 * {@link AuthErrorCode}.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT WE ARE CODING AGAINST (may not exist yet — see `api.ts`)
 * ---------------------------------------------------------------------------
 * Every error response gains a `code` field. We switch on `code` and fall back
 * to the English `error` string, because a build that predates the `code` field
 * must still render *something* honest rather than a generic failure.
 *
 * Two codes get special treatment that is NOT derivable from `code` alone:
 *
 *   - `AUTH_RATE_LIMITED` always carries `retryAfterSec`. We read the body
 *     first, then the `Retry-After` header, then fall back to 60s. A countdown
 *     that guesses too low lets the user hammer a rate-limited endpoint.
 *   - a 404/405/501 means the *route* is absent, not that the user did
 *     something wrong. That is `AUTH_ENDPOINT_MISSING` and it is rendered as
 *     "not available yet", never as a validation error. Confusing the two is
 *     how a half-shipped backend produces "your code is wrong" for a user who
 *     did nothing wrong.
 */

/** Stable codes we branch on. Unknown strings are preserved on the error. */
import type { AuthErrorCode as ServerAuthErrorCode_ } from "@/lib/auth-errors";

/**
 * Error codes for the MFA surfaces.
 *
 * The SERVER contract lives once, in `@/lib/auth-errors` — that module owns
 * `AUTH_ERROR_CODES` and the login/signup/recovery mapping. This module used to
 * redeclare the union from scratch, which meant a code added on one side could
 * silently go unhandled on the other. It now derives from the canonical list.
 *
 * `AUTH_TOTP_NOT_CONFIGURED` and `AUTH_TOTP_ALREADY_SET` were listed here as
 * client-only when the backend contract was still being written; the api-server
 * now emits both, so they were moved into the canonical list.
 *
 * The four extras below are CLIENT-ONLY: the api-server never emits them. They
 * exist so a transport failure can be distinguished from a server rejection —
 * "we could not reach the server" and "the server does not support this yet" are
 * materially different from "your code was wrong", and collapsing them into one
 * generic failure would be a lie. `AUTH_ENDPOINT_MISSING` is likewise local: it
 * fires on 404/405/501 while the backend rolls out, and is informational — the
 * UI says nothing was changed rather than showing a validation error.
 */
/** Codes the api-server can actually send. */
type ServerAuthErrorCode = ServerAuthErrorCode_;

/** Locally-raised codes, never sent by the server. */
export type AuthClientErrorCode =
  | "AUTH_INVALID_PASSWORD"
  | "AUTH_ENDPOINT_MISSING"
  | "AUTH_NETWORK"
  | "AUTH_UNKNOWN";

export type AuthErrorCode = ServerAuthErrorCode | AuthClientErrorCode;

/** Fallback countdown when a 429 carries no usable `retryAfterSec`. */
export const DEFAULT_RETRY_AFTER_SEC = 60;

export class AuthApiError extends Error {
  /** `body.code` when present, else a code derived from the status. */
  readonly code: AuthErrorCode | string;
  readonly status: number;
  /** Present for 429. `null` everywhere else. */
  readonly retryAfterSec: number | null;
  /** The server's English `error` string, verbatim. */
  readonly serverMessage: string | null;

  constructor(init: {
    code: AuthErrorCode | string;
    message: string;
    status?: number;
    retryAfterSec?: number | null;
    serverMessage?: string | null;
  }) {
    super(init.message);
    this.name = "AuthApiError";
    this.code = init.code;
    this.status = init.status ?? 0;
    this.retryAfterSec = init.retryAfterSec ?? null;
    this.serverMessage = init.serverMessage ?? null;
  }
}

/** Narrowing helper — `instanceof` across module realms is unreliable. */
export function isAuthApiError(e: unknown): e is AuthApiError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AuthApiError" &&
    typeof (e as { code?: unknown }).code === "string"
  );
}

/** Best-effort read of `code` from an arbitrary parsed body. */
function readCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.trim() !== "" ? code : null;
}

function readMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  return typeof err === "string" && err.trim() !== "" ? err : null;
}

/**
 * `Retry-After` may be seconds or an HTTP date. We take seconds; a date is
 * converted, and anything unparseable is discarded in favour of the default.
 */
function readRetryAfterHeader(res: { headers?: { get(name: string): string | null } }): number | null {
  const raw = res.headers?.get?.("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return null;
}

function deriveCodeFromStatus(status: number): AuthErrorCode {
  if (status === 404 || status === 405 || status === 501) return "AUTH_ENDPOINT_MISSING";
  if (status === 401) return "AUTH_SESSION_EXPIRED";
  if (status === 429) return "AUTH_RATE_LIMITED";
  return "AUTH_UNKNOWN";
}

/**
 * Turn a non-OK response into an {@link AuthApiError}.
 *
 * The body is read defensively: a proxy or an error page can hand us HTML, in
 * which case `res.json()` rejects and we still produce a usable error from the
 * status alone.
 */
export async function authErrorFromResponse(
  res: { status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> },
): Promise<AuthApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const serverMessage = readMessage(body);
  const derived = deriveCodeFromStatus(res.status);
  const code = readCode(body) ?? derived;

  const bodyRetry = (() => {
    if (!body || typeof body !== "object") return null;
    const v = (body as { retryAfterSec?: unknown }).retryAfterSec;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.ceil(v) : null;
  })();

  const retryAfterSec =
    code === "AUTH_RATE_LIMITED"
      ? (bodyRetry ?? readRetryAfterHeader(res) ?? DEFAULT_RETRY_AFTER_SEC)
      : null;

  return new AuthApiError({
    code,
    message: serverMessage ?? `Request failed (${res.status})`,
    status: res.status,
    retryAfterSec,
    serverMessage,
  });
}

/** A thrown `fetch` (DNS, offline, CORS, abort). Never a validation error. */
export function networkError(cause: unknown): AuthApiError {
  return new AuthApiError({
    code: "AUTH_NETWORK",
    message:
      cause instanceof Error && cause.message
        ? cause.message
        : "Could not reach the server. Check your connection and try again.",
  });
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

export type AuthErrorSeverity = "danger" | "warning" | "info";

export interface AuthErrorPresentation {
  /** i18n key — report these, they are not in `en.ts` yet. */
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
  severity: AuthErrorSeverity;
  /** Non-null only for `AUTH_RATE_LIMITED`. */
  retryAfterSec: number | null;
  /** The raw server `error` string, shown verbatim under the mapped copy. */
  serverMessage: string | null;
  code: AuthErrorCode | string;
}

interface Mapping {
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
  severity: AuthErrorSeverity;
}

const MAPPINGS: Record<string, Mapping> = {
  AUTH_MFA_INVALID: {
    titleKey: "mfa.error.invalidTitle",
    titleFallback: "That code was not accepted",
    bodyKey: "mfa.error.invalidBody",
    bodyFallback:
      "Check the 6-digit code in your authenticator app and enter it again. Codes expire every 30 seconds.",
    severity: "danger",
  },
  AUTH_MFA_NOT_ENROLLED: {
    titleKey: "mfa.error.notEnrolledTitle",
    titleFallback: "Two-factor authentication is not set up on this account",
    bodyKey: "mfa.error.notEnrolledBody",
    bodyFallback:
      "Start the setup from the beginning so the authenticator app can be registered first.",
    severity: "warning",
  },
  AUTH_RECOVERY_INVALID: {
    titleKey: "mfa.error.recoveryInvalidTitle",
    titleFallback: "That recovery code was not accepted",
    bodyKey: "mfa.error.recoveryInvalidBody",
    bodyFallback:
      "Each recovery code works once. Check for typos, or use another code from your list.",
    severity: "danger",
  },
  AUTH_TOTP_NOT_CONFIGURED: {
    titleKey: "mfa.error.notConfiguredTitle",
    titleFallback: "No authenticator app is registered",
    bodyKey: "mfa.error.notConfiguredBody",
    bodyFallback:
      "Two-factor authentication is not switched on for this account yet. Start the setup again to register your app.",
    severity: "warning",
  },
  AUTH_TOTP_ALREADY_SET: {
    titleKey: "mfa.error.alreadySetTitle",
    titleFallback: "Two-factor authentication is already on",
    bodyKey: "mfa.error.alreadySetBody",
    bodyFallback:
      "This account already uses an authenticator app. To replace it, turn two-factor authentication off first.",
    severity: "warning",
  },
  AUTH_REAUTH_REQUIRED: {
    titleKey: "mfa.error.reauthRequiredTitle",
    titleFallback: "Please confirm your password again",
    bodyKey: "mfa.error.reauthRequiredBody",
    bodyFallback:
      "For your protection this needs a recent password confirmation. Enter your password to continue.",
    severity: "warning",
  },
  AUTH_RATE_LIMITED: {
    titleKey: "mfa.error.rateLimitedTitle",
    titleFallback: "Too many attempts",
    bodyKey: "mfa.error.rateLimitedBody",
    bodyFallback:
      "For your account's security this is temporarily blocked. Wait for the countdown, then try again.",
    severity: "warning",
  },
  AUTH_SESSION_REVOKED: {
    titleKey: "mfa.error.sessionRevokedTitle",
    titleFallback: "This session was signed out",
    bodyKey: "mfa.error.sessionRevokedBody",
    bodyFallback:
      "It was signed out somewhere else — for example from another device. Sign in again to continue.",
    severity: "danger",
  },
  AUTH_SESSION_EXPIRED: {
    titleKey: "mfa.error.sessionExpiredTitle",
    titleFallback: "Your session has expired",
    bodyKey: "mfa.error.sessionExpiredBody",
    bodyFallback: "Sign in again to continue setting up two-factor authentication.",
    severity: "danger",
  },
  AUTH_INVALID_PASSWORD: {
    titleKey: "mfa.error.badPasswordTitle",
    titleFallback: "That password was not correct",
    bodyKey: "mfa.error.badPasswordBody",
    bodyFallback: "Your password was not accepted. Try again.",
    severity: "danger",
  },
  AUTH_ENDPOINT_MISSING: {
    titleKey: "mfa.error.unavailableTitle",
    titleFallback: "Two-factor authentication is not available on this server yet",
    bodyKey: "mfa.error.unavailableBody",
    bodyFallback:
      "The server did not provide this feature. Nothing was changed on your account. Try again later.",
    severity: "info",
  },
  AUTH_NETWORK: {
    titleKey: "mfa.error.networkTitle",
    titleFallback: "Could not reach the server",
    bodyKey: "mfa.error.networkBody",
    bodyFallback:
      "Check your connection. Nothing was changed on your account, so it is safe to try again.",
    severity: "danger",
  },
};

const UNKNOWN: Mapping = {
  titleKey: "mfa.error.unknownTitle",
  titleFallback: "Something went wrong",
  bodyKey: "mfa.error.unknownBody",
  bodyFallback: "The request did not complete. Try again in a moment.",
  severity: "danger",
};

/**
 * Map any thrown value onto presentable copy.
 *
 * An unrecognised `code` still surfaces the server's own English `error`
 * string, which is the whole point of the fallback: a build older than the
 * `code` field still tells the user what the server actually said.
 */
export function presentAuthError(e: unknown): AuthErrorPresentation {
  if (!isAuthApiError(e)) {
    const message = e instanceof Error ? e.message : null;
    return {
      ...UNKNOWN,
      titleFallback: message && message !== UNKNOWN.titleFallback ? message : UNKNOWN.titleFallback,
      retryAfterSec: null,
      serverMessage: message,
      code: "AUTH_UNKNOWN",
    };
  }

  const mapped = MAPPINGS[e.code] ?? UNKNOWN;
  return {
    ...mapped,
    retryAfterSec: e.retryAfterSec,
    serverMessage: e.serverMessage,
    code: e.code,
  };
}

/** Convenience: is this error telling the user to re-enter their password? */
export function needsReauth(e: unknown): boolean {
  return isAuthApiError(e) && e.code === "AUTH_REAUTH_REQUIRED";
}

/** Convenience: is this a 401-ish dead session that must not be retried? */
export function isDeadSession(e: unknown): boolean {
  if (!isAuthApiError(e)) return false;
  return e.code === "AUTH_SESSION_REVOKED" || e.code === "AUTH_SESSION_EXPIRED";
}