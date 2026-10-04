import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clearAllRecordDrafts } from "./use-record-draft";
import { AuthApiError, type AuthErrorResponse } from "@/lib/auth-errors";

interface AuthMe {
  authenticated: boolean;
  username: string | null;
  role: "admin" | "editor" | "viewer" | "user" | null;
  canAdminAccess: boolean;
  /**
   * Added by the auth contract. Optional because a deployment that predates
   * the field must not break the auth gate — `/api/auth/me` 500s into
   * "signed out" otherwise.
   */
  mfaEnabled?: boolean;
  /** ISO timestamp, or null for a session that does not expire. */
  sessionExpiresAt?: string | null;
}

/**
 * Mirrors `STORAGE_KEY` in `components/desktop/window-store.tsx`. Kept as a
 * literal so `use-auth` does not have to import the desktop store (and pull
 * the whole desktop bundle into the classic shell).
 */
export const DESKTOP_WINDOWS_STORAGE_KEY = "ubuntu-desktop-windows-v1";

/** How often to re-check the session while the app is open. */
export const SESSION_WATCHDOG_MS = 5 * 60 * 1000;

// Fetch with a hard timeout so an unreachable backend (e.g. the Worker → tunnel
// → api-server chain is down) aborts instead of hanging the whole app on the
// auth gate. Without this, a pending /api/auth/me leaves `isLoading` true
// forever and the app shows an endless spinner.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchMe(): Promise<AuthMe> {
  const res = await fetchWithTimeout("/api/auth/me", { credentials: "include" });
  if (res.status === 401) {
    return {
      authenticated: false,
      username: null,
      role: null,
      canAdminAccess: false,
      mfaEnabled: false,
      sessionExpiresAt: null,
    };
  }
  if (!res.ok) throw new Error("Failed to check auth");
  return res.json() as Promise<AuthMe>;
}

/**
 * Turn a failed auth response into an `AuthApiError`.
 *
 * The thrown `message` is still the server's English `error`, so every
 * existing `mutation.error.message` consumer keeps behaving exactly as before;
 * what is new is `code` and `retryAfterSec` riding along, which is what
 * `resolveAuthError` in `@/lib/auth-errors` switches on to produce translated
 * copy. A non-JSON body (proxy error page, empty 502) yields an empty
 * payload, and the caller supplies the fallback message.
 */
async function toAuthError(res: Response, fallbackMessage: string): Promise<AuthApiError> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const payload: AuthErrorResponse = {
    error: typeof body?.error === "string" ? body.error : undefined,
    code: typeof body?.code === "string" ? body.code : undefined,
    retryAfterSec:
      typeof body?.retryAfterSec === "number" ? body.retryAfterSec : undefined,
  };
  // Pass through anything else the backend may have attached (e.g. the
  // `loginToken` an MFA-required response carries) without enumerating it.
  for (const [key, value] of Object.entries(body ?? {})) {
    if (!(key in payload)) payload[key] = value;
  }
  return new AuthApiError(payload, res.status, fallbackMessage);
}

async function postLogin(username: string, password: string) {
  const res = await fetchWithTimeout("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await toAuthError(res, "Login failed");
  return res.json();
}

async function postLogout() {
  await fetchWithTimeout("/api/auth/logout", { method: "POST", credentials: "include" });
}

async function postSignup(payload: {
  username: string;
  password: string;
  fullName?: string;
  email?: string;
  reason?: string;
}) {
  const res = await fetchWithTimeout("/api/auth/signup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await toAuthError(res, "Sign-up failed");
  return res.json();
}

async function postSignupOtpSend(username: string, email: string) {
  const res = await fetchWithTimeout("/api/auth/signup/otp/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email }),
  });
  if (!res.ok) throw await toAuthError(res, "Could not send code");
  return (await res.json().catch(() => ({}))) as {
    ok: boolean;
    sent?: boolean;
    emailMasked?: string;
  };
}

async function postLoginOtpSend(username: string, loginToken: string) {
  const res = await fetchWithTimeout("/api/auth/login/otp/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, loginToken }),
  });
  if (!res.ok) throw await toAuthError(res, "Could not send code");
  return (await res.json().catch(() => ({}))) as {
    ok: boolean;
    sent?: boolean;
    emailMasked?: string;
  };
}

async function postSignupOtpVerify(username: string, email: string, code: string) {
  const res = await fetchWithTimeout("/api/auth/signup/otp/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, code }),
  });
  if (!res.ok) throw await toAuthError(res, "Verification failed");
  return (await res.json().catch(() => ({}))) as { ok: boolean; verified: boolean };
}

async function postLoginOtpVerify(username: string, loginToken: string, code: string) {
  const res = await fetchWithTimeout("/api/auth/login/otp/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, loginToken, code }),
  });
  if (!res.ok) throw await toAuthError(res, "Verification failed");
  return res.json();
}

/**
 * `POST /api/auth/mfa/recovery/verify` — redeem a single-use recovery code.
 *
 * This path is NOT in the backend contract the two auth agents agreed on, so it
 * is isolated here in one place: if the api-server lands it under a different
 * path, this function is the only thing that changes.
 *
 * On success the server establishes the session itself, exactly as
 * `/auth/login/otp/verify` does — which is why the caller only has to invalidate
 * `auth-me` and the auth gate in `App.tsx` flips and unmounts the login screen.
 * A recovery code is single-use, so a refusal must reject rather than resolve:
 * `RecoveryCodeEntry` relies on the rejection to retire that exact code and stop
 * the user re-sending it, while still allowing a *different* code (so a typo is
 * recoverable).
 */
async function postRecoveryCodeVerify(args: {
  code: string;
  username?: string | null;
  loginToken?: string | null;
}) {
  const res = await fetchWithTimeout("/api/auth/mfa/recovery/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: args.code,
      username: args.username ?? undefined,
      loginToken: args.loginToken ?? undefined,
    }),
  });
  if (!res.ok) throw await toAuthError(res, "Recovery code refused");
  // A 200 carrying `{ok: false}` is a FAILURE, not a success: treating it as
  // success would show "signed in" over an account that is still locked.
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
  if (body && body.ok === false) {
    throw new AuthApiError(
      { error: "Recovery code refused", code: "AUTH_RECOVERY_INVALID" },
      res.status,
    );
  }
  return body;
}

/* -------------------------------------------------------------------------- */
/* Password recovery                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/auth/password-reset/request`
 *
 * Takes `{identifier}` — an email OR a username — and answers with a neutral
 * 200 that never reveals whether the account exists. The UI must therefore
 * never branch on the *result*; `recovery-machine.ts` models "sent" as one
 * terminal state regardless of what actually happened.
 *
 * A dev/test deployment may return a `token` so the flow can be completed
 * without an inbox. It is passed through here, but the page only falls back to
 * it when no deep link arrived.
 */
export const PASSWORD_RESET_REQUEST_URL = "/api/auth/password-reset/request";
export const PASSWORD_RESET_CONFIRM_URL = "/api/auth/password-reset/confirm";

async function postPasswordResetRequest(identifier: string) {
  const res = await fetchWithTimeout(PASSWORD_RESET_REQUEST_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier }),
  });
  // The endpoint is specified to answer neutrally on success. Anything that is
  // not 2xx is still a real failure and carries a code we can translate.
  if (!res.ok) throw await toAuthError(res, "Could not start password recovery");
  return (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    token?: string;
    expiresInSec?: number;
  };
}

async function postPasswordResetConfirm(token: string, password: string) {
  const res = await fetchWithTimeout(PASSWORD_RESET_CONFIRM_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) throw await toAuthError(res, "Could not update the password");
  return (await res.json().catch(() => ({}))) as { ok?: boolean };
}

/**
 * Fired whenever we discover the session is gone while the user was working:
 * the watchdog poll below, or a 401 from any mutation.
 *
 * Without this, `staleTime: 60_000` plus the global
 * `refetchOnWindowFocus: false` meant a user returning after 30 minutes kept
 * reading *stale cached PHI* with no indication their session had expired, and
 * their next mutation failed with an unhandled 401.
 */
const SESSION_EXPIRED_EVENT = "mr:session-expired";

export function notifySessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function useSessionExpirySignal() {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);
  const dismiss = useCallback(() => setExpired(false), []);
  return { expired, dismiss };
}

/**
 * Global 401 interceptor.
 *
 * `installCsrfFetch()` in `main.tsx` already wraps `window.fetch`; this wraps
 * the *result* instead, so it observes the response rather than re-issuing the
 * request, and therefore cannot double-submit a mutation. Idempotent.
 */
let installed = false;
export function installSessionExpiryWatch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    try {
      if (res.status === 401) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
        // /api/auth/me returning 401 is the normal "signed out" answer and is
        // already reflected in `authenticated`; only *other* endpoints mean an
        // unexpected mid-session expiry.
        if (url && !url.includes("/api/auth/me")) {
          notifySessionExpired();
        }
      }
    } catch {
      /* never let the interceptor throw */
    }
    return res;
  };
}

export function useAuth() {
  const qc = useQueryClient();
  const wasAuthenticated = useRef<boolean | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
    // The watchdog below already polls; refocus on top of that is cheap and
    // closes the "came back to a dead session" gap immediately.
    refetchOnWindowFocus: true,
    refetchInterval: SESSION_WATCHDOG_MS,
    refetchIntervalInBackground: false,
  });

  /**
   * Session-expiry watchdog. If the poll says "no longer authenticated" while
   * we previously *were*, the session died under the user — tell them before
   * they act on stale cached data.
   */
  useEffect(() => {
    const current = data?.authenticated ?? false;
    if (wasAuthenticated.current === true && !current) {
      notifySessionExpired();
    }
    wasAuthenticated.current = current;
  }, [data?.authenticated]);

  /**
   * PRIVACY (X22): a 401 on any mutation must also invalidate the cached PHI
   * query data, otherwise the user keeps reading the last-fetched records of a
   * dead session from the in-memory cache.
   */
  useEffect(() => {
    const onExpired = () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth-me" });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [qc]);

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      postLogin(username, password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const logoutMutation = useMutation({
    mutationFn: postLogout,
    onSuccess: () => {
      /**
       * PRIVACY. `ubuntu-desktop-windows-v1` survives logout (the `rc_sid`
       * cookie is host-scoped to `.research-center.fit`; this key is not), so
       * on a shared workstation the next user saw the previous user's open
       * windows — and the patient ids in their titles — before any auth
       * check. Defence in depth: Desktop.tsx and settings.tsx also clear it.
       */
      /**
       * PRIVACY. `clearDesktopStorage()` in `components/desktop/window-store`
       * removes this key, but importing that module here would pull the whole
       * desktop store into the classic bundle. `STORAGE_KEY` is
       * "ubuntu-desktop-windows-v1" and `canUseStorage()` is
       * `typeof window !== "undefined"`, so the removal is byte-identical to
       * calling it. Desktop.tsx and pages/settings.tsx also clear it.
       */
      try {
        window.localStorage.removeItem(DESKTOP_WINDOWS_STORAGE_KEY);
      } catch {
        /* private mode / quota: nothing to clear */
      }
      // PHI: `mr_draft:patient:*` holds the full unsaved 40-field record for
      // each patient an operator touched. localStorage is origin-scoped, not
      // session-scoped, so on a shared reading-room workstation the next user
      // would be handed the previous operator's unsaved clinical work — names,
      // complaints, diagnoses — just by opening the same patient id.
      clearAllRecordDrafts();
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      qc.clear();
    },
  });

  const signupMutation = useMutation({
    mutationFn: postSignup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const sendSignupOtpMutation = useMutation({
    mutationFn: ({ username, email }: { username: string; email: string }) =>
      postSignupOtpSend(username, email),
  });

  const verifySignupOtpMutation = useMutation({
    mutationFn: ({ username, email, code }: { username: string; email: string; code: string }) =>
      postSignupOtpVerify(username, email, code),
  });

  const sendLoginOtpMutation = useMutation({
    mutationFn: ({ username, loginToken }: { username: string; loginToken: string }) =>
      postLoginOtpSend(username, loginToken),
  });

  const verifyLoginOtpMutation = useMutation({
    mutationFn: ({
      username,
      loginToken,
      code,
    }: {
      username: string;
      loginToken: string;
      code: string;
    }) => postLoginOtpVerify(username, loginToken, code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  /** Redeem a single-use MFA recovery code during the login 2FA step. */
  const redeemRecoveryCodeMutation = useMutation({
    mutationFn: (args: { code: string; username?: string | null; loginToken?: string | null }) =>
      postRecoveryCodeVerify(args),
    // The server establishes the session, so the only thing the client owes is a
    // fresh identity — `ProtectedRoutes` will then unmount the login screen.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const passwordResetRequestMutation = useMutation({    mutationFn: ({ identifier }: { identifier: string }) =>
      postPasswordResetRequest(identifier),
  });

  const passwordResetConfirmMutation = useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      postPasswordResetConfirm(token, password),
  });

  return {
    isLoading,
    authenticated: data?.authenticated ?? false,
    username: data?.username ?? null,
    role: data?.role ?? null,
    canAdminAccess: data?.canAdminAccess ?? false,
    canEdit: data?.role ? data.role !== "viewer" : false,
    /** Added by the auth contract; absent on a pre-contract deployment. */
    mfaEnabled: data?.mfaEnabled ?? false,
    sessionExpiresAt: data?.sessionExpiresAt ?? null,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error?.message ?? null,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    signup: signupMutation.mutateAsync,
    signupError: signupMutation.error?.message ?? null,
    isSigningUp: signupMutation.isPending,
    sendSignupOtp: sendSignupOtpMutation.mutateAsync,
    sendSignupOtpError: sendSignupOtpMutation.error?.message ?? null,
    isSendingSignupOtp: sendSignupOtpMutation.isPending,
    verifySignupOtp: verifySignupOtpMutation.mutateAsync,
    verifySignupOtpError: verifySignupOtpMutation.error?.message ?? null,
    isVerifyingSignupOtp: verifySignupOtpMutation.isPending,
    // Login 2FA (OTP sent to the account email)
    sendLoginOtp: sendLoginOtpMutation.mutateAsync,
    sendLoginOtpError: sendLoginOtpMutation.error?.message ?? null,
    isSendingLoginOtp: sendLoginOtpMutation.isPending,
    verifyLoginOtp: verifyLoginOtpMutation.mutateAsync,
    verifyLoginOtpError: verifyLoginOtpMutation.error?.message ?? null,
    isVerifyingLoginOtp: verifyLoginOtpMutation.isPending,
    /** Single-use MFA recovery code, accepted in place of the emailed OTP. */
    redeemRecoveryCode: redeemRecoveryCodeMutation.mutateAsync,
    redeemRecoveryCodeError: redeemRecoveryCodeMutation.error?.message ?? null,
    isRedeemingRecoveryCode: redeemRecoveryCodeMutation.isPending,
    // Password recovery. Neutral request + token confirm; see
    // `recovery-machine.ts` for the state both of them feed.
    requestPasswordReset: passwordResetRequestMutation.mutateAsync,
    requestPasswordResetError:
      passwordResetRequestMutation.error?.message ?? null,
    isRequestingPasswordReset: passwordResetRequestMutation.isPending,
    confirmPasswordReset: passwordResetConfirmMutation.mutateAsync,
    confirmPasswordResetError:
      passwordResetConfirmMutation.error?.message ?? null,
    isConfirmingPasswordReset: passwordResetConfirmMutation.isPending,
  };
}