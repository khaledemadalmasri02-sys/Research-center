/**
 * Network layer for the MFA / re-auth endpoints.
 *
 * ===========================================================================
 * READ THIS BEFORE ASSUMING ANY OF IT WORKS
 * ===========================================================================
 * These endpoints are being built by a parallel agent and may not exist when
 * this code runs. Every function here therefore:
 *
 *   1. throws `AuthApiError` with `code: "AUTH_ENDPOINT_MISSING"` for a
 *      404/405/501, which the UI renders as "not available yet" — never as a
 *      validation error. (See `errors.ts` for why conflating the two is a real
 *      failure mode.)
 *   2. tolerates a *partial* rollout. `/api/auth/mfa/enroll` may return only
 *      `secret` and no `otpauthUri`; the UI needs the secret to work, and the
 *      URI is a convenience. Conversely a 200 with a missing field is treated
 *      as a failure rather than rendering an empty form.
 *   3. treats an unparseable body as a failure instead of `undefined` flowing
 *      into the tree.
 *
 * Nothing here retries. A retry against `/mfa/enroll/confirm` is a second
 * attempt at a rate-limited endpoint, and the countdown the UI owns is the only
 * thing allowed to decide when to try again.
 */
import {
  AuthApiError,
  authErrorFromResponse,
  networkError,
} from "./errors";

/**
 * `installCsrfFetch()` in `src/main.tsx` wraps `window.fetch` and attaches
 * `X-CSRF-Token` to mutating same-origin `/api` requests, so a bare
 * `fetch("/api/...", { method: "POST" })` is correct here and adding a manual
 * CSRF header would be wrong.
 */
const JSON_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
};

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (body: unknown) => T,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include", ...init });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw await authErrorFromResponse(res);

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new AuthApiError({
      code: "AUTH_UNKNOWN",
      message: `Malformed response from ${path}`,
      status: res.status,
    });
  }
  return parse(body);
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new AuthApiError({ code: "AUTH_UNKNOWN", message: "Unexpected response shape" });
  }
  return body as Record<string, unknown>;
}

function asString(body: unknown, field: string, path: string): string {
  const v = asRecord(body)[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new AuthApiError({
      code: "AUTH_UNKNOWN",
      message: `${path} did not return \`${field}\``,
    });
  }
  return v;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The subset of `GET /api/auth/me` this flow needs.
 *
 * `mfaEnabled` is assumed to be `boolean | undefined`. `undefined` is a real
 * state, not an error: a server predating the field cannot tell us whether MFA
 * is on, so the page renders the unknown state ("we could not confirm whether
 * two-factor authentication is on") instead of claiming it is off.
 */
export interface MfaStatus {
  mfaEnabled: boolean | undefined;
  /** Milliseconds since epoch, or `null` when the server omitted it. */
  sessionExpiresAt: number | null;
  /** True when the server answered with fields we do not know about. */
  fromNewServer: boolean;
}

export async function fetchMfaStatus(signal?: AbortSignal): Promise<MfaStatus> {
  let res: Response;
  try {
    res = await fetch("/api/auth/me", { credentials: "include", signal });
  } catch (e) {
    throw networkError(e);
  }
  // 401 is the documented "signed out" answer, not an error page.
  if (res.status === 401) {
    return { mfaEnabled: false, sessionExpiresAt: null, fromNewServer: false };
  }
  if (!res.ok) throw await authErrorFromResponse(res);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AuthApiError({ code: "AUTH_UNKNOWN", message: "Malformed /api/auth/me response" });
  }
  const rec = asRecord(body);
  const mfaEnabled = typeof rec.mfaEnabled === "boolean" ? rec.mfaEnabled : undefined;
  const expiresRaw = rec.sessionExpiresAt;
  const sessionExpiresAt =
    typeof expiresRaw === "string" || typeof expiresRaw === "number"
      ? new Date(expiresRaw).getTime()
      : null;

  return {
    mfaEnabled,
    sessionExpiresAt: Number.isFinite(sessionExpiresAt as number) ? sessionExpiresAt : null,
    fromNewServer: mfaEnabled !== undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Password re-entry                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/auth/reauth` — re-verifies the password and records
 * `reauthenticatedAt` on the session.
 *
 * A 200 with an empty body is success. We do not require `reauthenticatedAt`:
 * some deployments answer `{}`, and failing the flow over a field we would
 * only display would be a self-inflicted outage.
 */
export async function reauthenticate(password: string): Promise<{ at: number | null }> {
  const body = await request(
    "/api/auth/reauth",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password }) },
    (parsed) => parsed,
  );
  const raw = asRecord(body).reauthenticatedAt;
  const at =
    typeof raw === "string" || typeof raw === "number" ? new Date(raw).getTime() : null;
  return { at: Number.isFinite(at as number) ? at : null };
}

/* -------------------------------------------------------------------------- */
/* Enrolment                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/auth/mfa/enroll` → `{ secret, otpauthUri }`.
 *
 * `otpauthUri` is treated as optional on the response because manual entry only
 * needs `secret`, and a partial implementation that returns just the secret
 * still gives the user a working setup. We do NOT synthesise an otpauth URI
 * client-side: the account label and issuer inside it are server policy, and
 * guessing them would produce a QR that silently provisions the wrong account.
 */
export interface EnrollmentSecret {
  secret: string;
  otpauthUri: string | null;
}

export async function startEnrollment(): Promise<EnrollmentSecret> {
  const body = await request(
    "/api/auth/mfa/enroll",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    (parsed) => parsed,
  );
  const rec = asRecord(body);
  const secret = asString(rec, "secret", "/api/auth/mfa/enroll");
  const uri = typeof rec.otpauthUri === "string" && rec.otpauthUri.trim() !== "" ? rec.otpauthUri : null;
  return { secret, otpauthUri: uri };
}

/** Codes arrive as strings; tolerate `null` entries and drop empties. */
function readRecoveryCodes(body: unknown): string[] {
  const rec = asRecord(body);
  const raw = rec.recoveryCodes;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AuthApiError({
      code: "AUTH_UNKNOWN",
      message: "The server did not return any recovery codes",
    });
  }
  const codes = raw.filter((c): c is string => typeof c === "string" && c.trim() !== "");
  if (codes.length === 0) {
    throw new AuthApiError({
      code: "AUTH_UNKNOWN",
      message: "The server returned an empty recovery code list",
    });
  }
  return codes;
}

/**
 * `POST /api/auth/mfa/enroll/confirm` `{ code }` → `{ recoveryCodes }`.
 *
 * Returned exactly once. The caller MUST NOT cache this anywhere; the codes
 * are unrecoverable afterwards, which is the entire point of the reveal step.
 */
export async function confirmEnrollment(code: string): Promise<string[]> {
  const body = await request(
    "/api/auth/mfa/enroll/confirm",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code }) },
    (parsed) => parsed,
  );
  return readRecoveryCodes(body);
}

/**
 * `POST /api/auth/mfa/disable` — requires a recent password re-entry.
 *
 * A 200 with `{ ok: false }` is treated as FAILURE on purpose. The old UI had a
 * revoke button that reported success whenever the HTTP call resolved; if the
 * server says it did not disable MFA, saying "Two-factor authentication is off"
 * would be the most security-relevant lie in the app.
 */
export async function disableMfa(): Promise<void> {
  const body = await request(
    "/api/auth/mfa/disable",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    (parsed) => parsed,
  );
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (rec.ok === false) {
    throw new AuthApiError({
      code: "AUTH_UNKNOWN",
      message: "The server declined to disable two-factor authentication.",
    });
  }
}

/**
 * `POST /api/auth/mfa/recovery/regenerate` → `{ recoveryCodes }`.
 *
 * This DESTROYS every previously issued recovery code. The caller is
 * responsible for telling the user that before calling.
 */
export async function regenerateRecoveryCodes(): Promise<string[]> {
  const body = await request(
    "/api/auth/mfa/recovery/regenerate",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
    (parsed) => parsed,
  );
  return readRecoveryCodes(body);
}

/* -------------------------------------------------------------------------- */
/* Recovery redemption (login flow — Task 2)                                   */
/* -------------------------------------------------------------------------- */

/**
 * ASSUMED ENDPOINT — the backend contract does not list one.
 *
 * The contract covers enrolment, confirmation, disable, regeneration and
 * re-auth, but NOT redeeming a recovery code at login. Something has to redeem
 * it. This is the path we assume:
 *
 *     POST /api/auth/mfa/recovery/verify  { code, loginToken? }
 *
 * Two details are guesses and both are surfaced in the report:
 *   - the path,
 *   - the optional `loginToken`, which the login 2FA step already holds
 *     (`useAuth().verifyLoginOtp` is called with `{ username, loginToken,
 *     code }`), so a redemption endpoint that needs to bind the code to an
 *     in-flight login almost certainly needs it too.
 *
 * This helper is deliberately NOT used by {@link RecoveryCodeEntry}: that
 * component is prop-driven (`onRedeem`) so the login page can pass its own
 * mutation and own the session hand-off. It exists for the mfa-setup page's
 * "use a recovery code instead" affordance and for whoever wires the login
 * side. If the real path differs, only this one string changes.
 */
export async function redeemRecoveryCode(
  code: string,
  opts: { loginToken?: string | null; username?: string | null } = {},
): Promise<void> {
  const payload: Record<string, string> = { code };
  if (opts.loginToken) payload.loginToken = opts.loginToken;
  if (opts.username) payload.username = opts.username;

  const body = await request(
    "/api/auth/mfa/recovery/verify",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) },
    (parsed) => parsed,
  );
  // `ok: false` on a 200 is the same lie as in `disableMfa` — refuse it.
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (rec.ok === false) {
    throw new AuthApiError({
      code: "AUTH_RECOVERY_INVALID",
      message: "That recovery code was not accepted.",
    });
  }
}