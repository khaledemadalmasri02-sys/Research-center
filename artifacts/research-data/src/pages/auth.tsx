import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";

import {
  useAuth,
  useSessionExpirySignal,
} from "@/hooks/use-auth";
import { useSound } from "@/components/sound-provider";
import { Button } from "@/components/ui/button";
import {
  DURATION,
  EASE_OUT,
  shouldReduceMotion,
  staggerStartDelay,
  useMotionPrefs,
} from "@/lib/motion";
import {
  AuthApiError,
  SESSION_EXPIRED_LOGIN_PATH,
  authErrorFromThrown,
  formatCountdown,
  isSessionExpiredReason,
  type AuthErrorKind,
  type AuthTranslate,
  type ResolvedAuthError,
} from "@/lib/auth-errors";
import {
  INITIAL_RECOVERY_STATE,
  isTokenProblem,
  recoveryReducer,
  type RecoveryStep,
} from "@/components/auth/recovery-machine";
import { useRetryCountdown } from "@/components/auth/use-retry-countdown";
import { useAuthTranslate } from "@/components/auth/use-translate";
import {
  firstFailedRule,
  isValidPassword,
} from "@/components/auth/password-rules";
import {
  AuthPasswordField,
  AuthSubmit,
  Field,
} from "@/components/auth/AuthFields";
import { OtpVerification } from "@/components/auth/OtpVerification";
import { RecoveryCodeEntry } from "@/components/auth/mfa";
import { SocialProviders } from "@/components/auth/SocialProviders";
import { cn } from "@/lib/utils";

/**
 * ============================================================================
 * THE AUTH SURFACE
 * ============================================================================
 *
 * One component owns all four modes — `login`, `signup`, `forgot`, `reset` —
 * so that moving between them is a state change inside one layout rather than
 * four pages that each invent their own transition. `src/pages/login.tsx`,
 * `signup.tsx`, `forgot-password.tsx` and `reset-password.tsx` are four-line
 * route wrappers around it, which is also what makes `/reset-password?token=…`
 * deep-linkable.
 *
 * Rules this file has to keep (they are load-bearing, not preferences):
 *  - `useId()` + `htmlFor`/`id` on every field, `aria-invalid` +
 *    `aria-describedby` wired to the hint/error ids. See `AuthFields.tsx`.
 *  - A reserved-height error slot on every field, so validation never shifts
 *    the layout. Nothing here animates its height.
 *  - `aria-live="assertive" role="alert"` on the server-error banner.
 *  - 6-digit OTP with `autoComplete="one-time-code"`, `inputMode="numeric"`
 *    and a masked destination.
 *  - `autoComplete` on every field, including the recovery ones, because
 *    password managers are the only reason half of these users are still
 *    typing passwords at all.
 *  - Reduced motion AND reduced data honoured on every tween, and any stagger
 *    capped (see `FieldStagger`).
 *  - The hidden height measurer stays `inert` + `aria-hidden`.
 *  - Focus moves to the first field when the mode changes.
 *  - An `sr-only` live region announces the current mode.
 */

/** The four faces of this component. */
export type AuthMode = "login" | "signup" | "forgot" | "reset";

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/*                                                                            */
/* Mirrors the server rules so users get instant feedback. The server stays   */
/* the source of truth — anything it rejects is surfaced through the coded     */
/* error banner, translated.                                                   */
/* -------------------------------------------------------------------------- */

/** `(key, englishFallback, params?)` — see `@/components/auth/use-translate`. */
type T = AuthTranslate;

interface LoginValues {
  username: string;
  password: string;
}

interface SignupValues {
  username: string;
  password: string;
  confirmPassword: string;
  fullName: string;
  email: string;
  reason: string;
}

type Errors<T2> = Partial<Record<keyof T2, string>>;

function validateLogin(v: LoginValues, t: T): Errors<LoginValues> {
  const errors: Errors<LoginValues> = {};
  if (!v.username.trim())
    errors.username = t("auth.errUsernameRequired", "Enter your username.");
  if (!v.password)
    errors.password = t("auth.errPasswordRequired", "Enter your password.");
  return errors;
}

function validateSignup(v: SignupValues, t: T): Errors<SignupValues> {
  const errors: Errors<SignupValues> = {};
  if (v.username.trim().length < 3)
    errors.username = t("auth.errUsernameShort",
      "Username must be at least 3 characters.",
    );
  // `isValidPassword` is the shared client mirror of the server rule, so the
  // live checklist and this check can never disagree.
  if (v.password && !isValidPassword(v.password)) {
    const first = firstFailedRule(v.password);
    errors.password = first
      ? t("auth.errPasswordRule", "Password needs: {{rule}}.", {
          rule: t(first.key, first.fallback),
        })
      : t("auth.errPasswordComplexity",
          "Password must include lowercase, uppercase, a number, and a symbol.",
        );
  }
  if (!v.confirmPassword)
    errors.confirmPassword = t("auth.errConfirmRequired",
      "Confirm your password.",
    );
  else if (v.confirmPassword !== v.password)
    errors.confirmPassword = t("auth.errPasswordsMismatch",
      "Passwords do not match.",
    );
  if (!v.email.trim())
    errors.email = t("auth.errEmailRequired", "Email is required.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
    errors.email = t("auth.errEmailInvalid",
      "Enter a valid email address.",
    );
  return errors;
}

function validateReset(
  v: { password: string; confirmPassword: string },
  t: T,
): Errors<{ password: string; confirmPassword: string }> {
  const errors: Errors<{ password: string; confirmPassword: string }> = {};
  if (!v.password) {
    errors.password = t("auth.errPasswordRequired", "Enter your password.");
  } else if (!isValidPassword(v.password)) {
    const first = firstFailedRule(v.password);
    errors.password = first
      ? t("auth.errPasswordRule", "Password needs: {{rule}}.", {
          rule: t(first.key, first.fallback),
        })
      : t("auth.errPasswordComplexity",
          "Password must include lowercase, uppercase, a number, and a symbol.",
        );
  }
  if (!v.confirmPassword) {
    errors.confirmPassword = t("auth.errConfirmRequired",
      "Confirm your password.",
    );
  } else if (v.confirmPassword !== v.password) {
    errors.confirmPassword = t("auth.errPasswordsMismatch",
      "Passwords do not match.",
    );
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Motion — one shared vocabulary                                              */
/* -------------------------------------------------------------------------- */

/**
 * THE panel transition. One definition, used by the mobile stack, the desktop
 * form panel and the desktop welcome panel, so login -> signup -> forgot ->
 * reset all move the same way instead of four unrelated effects.
 *
 * Direction is fixed — content enters from 8px below and leaves upwards — and
 * that is deliberate: it is a single surface, not a carousel. Anything that
 * looks like "this panel slides in from the direction you came from" needs
 * per-mode offsets and reads as a bug the moment a mode is added.
 *
 * `AnimatePresence initial={false}` means a fresh mount (a route change into
 * `/forgot-password`) does NOT animate in, so a route hop and an in-page mode
 * switch never stack two animations on the same element.
 */
const MODE_PANEL: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  },
};

/** Reduced-motion twin of {@link MODE_PANEL}: opacity only, no travel. */
const MODE_PANEL_REDUCED: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.fast } },
  exit: { opacity: 0, transition: { duration: DURATION.fast } },
};

/**
 * The desktop split-panel slide. One definition for both halves, derived from
 * the active language via `isRtl` at the call site — the original bug this
 * fixed was a hardcoded LTR offset that slid the form over the welcome panel
 * in Arabic.
 */
const PANEL_SLIDE = { duration: DURATION.deliberate, ease: EASE_OUT } as const;

/**
 * Field-level entrance stagger.
 *
 * Opacity plus a 6px lift only. Each item's delay comes from
 * `staggerStartDelay`, which clamps the slot against `MAX_STAGGERED_CHILDREN`
 * rather than trusting the rendered count — so the sign-up form's seven fields
 * finish *starting* inside the 200ms budget, and no future field count can push
 * this past it.
 *
 * Rendered as plain children when the user asked for reduced motion or reduced
 * data. The fields are focusable and typeable from the first frame either way;
 * this only makes them *appear* in order.
 */
function FieldStagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = shouldReduceMotion(useMotionPrefs());
  if (reduced) return <div className={className}>{children}</div>;
  const items = Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: DURATION.base,
            ease: EASE_OUT,
            delay: staggerStartDelay(index),
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Banner                                                                     */
/* -------------------------------------------------------------------------- */

interface BannerAction {
  label: string;
  onClick: () => void;
}

/** Seconds a fresh OTP stays un-resendable. Matches the pre-existing value. */
const OTP_RESEND_COOLDOWN_SEC = 30;

interface Banner {
  /**
   * `error` is assertive and loud; `notice` is polite and informational.
   * Nothing else may be announced assertively — a user who is mid-typing
   * should not be interrupted by a status line.
   */
  tone: "error" | "notice";
  message: string;
  /** Present on 429; drives the live countdown. */
  retryAfterSec?: number | null;
  action?: BannerAction;
  /** Mirrors `resolved.kind`, used for the retry-label decision. */
  kind?: AuthErrorKind;
}

function FormBanner({
  banner,
  retryRemaining,
  t,
}: {
  banner: Banner | null;
  retryRemaining: number | null;
  t: T;
}) {
  const reduced = shouldReduceMotion(useMotionPrefs());
  const tone = banner?.tone ?? "error";
  const isError = tone === "error";

  return (
    <div
      // Assertive for a rejection (it is the answer to what the user just did),
      // polite for an explanation. Kept on a stable wrapper so assistive tech
      // has one live region to watch rather than a node that mounts and unmounts.
      aria-live={isError ? "assertive" : "polite"}
      role={isError ? "alert" : "status"}
    >
      <AnimatePresence initial={false}>
        {banner ? (
          <motion.div
            key={banner.message}
            // Opacity + 4px rise. NOT height: the banner used to animate
            // `height: 0 -> auto`, which is a layout animation on the auth
            // card and re-introduced the reflow the reserved-height slots
            // exist to prevent. Nothing in this panel animates layout any more.
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{
              duration: reduced ? 0 : DURATION.fast,
              ease: EASE_OUT,
            }}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm",
              isError
                ? "border-rose-500/35 bg-rose-500/10 text-rose-200"
                : "border-sky-400/30 bg-sky-400/10 text-sky-100",
            )}
          >
            <p>{banner.message}</p>
            {retryRemaining !== null ? (
              <p
                className="mt-1 text-xs font-medium tabular-nums"
                data-testid="auth-retry-countdown"
              >
                {retryRemaining > 0
                  ? t("auth.retryCountdown",
                      "You can try again in {{time}}.",
                      { time: formatCountdown(retryRemaining) },
                    )
                  : t("auth.retryNow", "You can try again now.")}
              </p>
            ) : null}
            {banner.action ? (
              <button
                type="button"
                onClick={banner.action.onClick}
                className="mt-1.5 text-xs font-semibold underline underline-offset-2 hover:no-underline"
              >
                {banner.action.label}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

const EMPTY_LOGIN: LoginValues = { username: "", password: "" };
const EMPTY_SIGNUP: SignupValues = {
  username: "",
  password: "",
  confirmPassword: "",
  fullName: "",
  email: "",
  reason: "",
};
const EMPTY_RESET: { password: string; confirmPassword: string } = {
  password: "",
  confirmPassword: "",
};

/* -------------------------------------------------------------------------- */
/* Submit guard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Hard double-submit guard.
 *
 * `mutation.isPending` is one render behind the click that started it, so a
 * fast double-click can fire two requests before React re-renders — which on a
 * login endpoint means two password attempts against the rate limiter, and on
 * the OTP send means two emails. The ref closes that window synchronously; the
 * state exists only so the button can render the busy state.
 */
function useSubmitGuard() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function AuthPage({
  initialMode = "login",
  resetToken: resetTokenProp,
}: {
  initialMode?: AuthMode;
  /** Deep-link token. Falls back to `?token=` on the current URL. */
  resetToken?: string;
}) {
  const { i18n } = useTranslation();
  const { t } = useAuthTranslate();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const {
    login,
    isLoggingIn,
    signup,
    isSigningUp,
    sendSignupOtp,
    verifySignupOtp,
    sendLoginOtp,
    verifyLoginOtp,
    redeemRecoveryCode,
    isSendingSignupOtp,
    isVerifyingSignupOtp,
    isSendingLoginOtp,
    isVerifyingLoginOtp,
    requestPasswordReset,
    isRequestingPasswordReset,
    confirmPasswordReset,
    isConfirmingPasswordReset,
  } = useAuth();
  const reduced = shouldReduceMotion(useMotionPrefs());
  const { play } = useSound();
  const { expired: sessionExpired, dismiss: dismissSessionExpiry } =
    useSessionExpirySignal();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // OTP email-verification step: only shown after a sign-up that included an email.
  const [otpStep, setOtpStep] = useState(false);
  const [otpTo, setOtpTo] = useState<string | undefined>(undefined);
  const [otpVerified, setOtpVerified] = useState(false);

  // Login 2FA step (shown after a correct password when the account has email).
  const [loginOtpStep, setLoginOtpStep] = useState(false);
  const [loginOtpToken, setLoginOtpToken] = useState<string | undefined>(undefined);
  const [loginOtpTo, setLoginOtpTo] = useState<string | undefined>(undefined);

  const [loginValues, setLoginValues] = useState<LoginValues>(EMPTY_LOGIN);
  const [loginErrors, setLoginErrors] = useState<Errors<LoginValues>>({});
  const [signupValues, setSignupValues] = useState<SignupValues>(EMPTY_SIGNUP);
  const [signupErrors, setSignupErrors] = useState<Errors<SignupValues>>({});

  /* ---- Password recovery ------------------------------------------------ */
  const [recovery, dispatchRecovery] = useReducer(
    recoveryReducer,
    INITIAL_RECOVERY_STATE,
  );
  const [identifier, setIdentifier] = useState("");
  const [identifierError, setIdentifierError] = useState<string | undefined>();
  const [resetValues, setResetValues] = useState(EMPTY_RESET);
  const [resetErrors, setResetErrors] = useState<Errors<typeof EMPTY_RESET>>({});
  /** Dev/test convenience: only ever populated from the request response. */
  const [devResetToken, setDevResetToken] = useState<string | null>(null);

  const tokenFromUrl =
    new URLSearchParams(search ?? "").get("token")?.trim() ?? "";
  const resetToken = (resetTokenProp ?? tokenFromUrl).trim();

  const loginGuard = useSubmitGuard();
  const signupGuard = useSubmitGuard();
  const forgotGuard = useSubmitGuard();
  const resetGuard = useSubmitGuard();

  /* ---- Countdowns ------------------------------------------------------ */

  const retryRemaining = useRetryCountdown(
    banner?.tone === "error" ? (banner.retryAfterSec ?? null) : null,
  );
  const throttled = retryRemaining !== null && retryRemaining > 0;

  /* Resend cooldown ticker, driven through the reducer so the cooldown and the
     step can never disagree. */
  useEffect(() => {
    if (recovery.step !== "request-sent" || recovery.cooldownSec <= 0) return;
    const id = setTimeout(
      () => dispatchRecovery({ type: "cooldown-ticked" }),
      1000,
    );
    return () => clearTimeout(id);
  }, [recovery.step, recovery.cooldownSec]);

  /* ---- Error routing ---------------------------------------------------- */

  const goToLoginWithReason = useCallback(() => {
    setLocation(SESSION_EXPIRED_LOGIN_PATH);
  }, [setLocation]);

  /**
   * Turn a rejected request into a translated, coded banner.
   *
   * This is the single funnel every auth error path goes through — login, OTP
   * send, OTP verify, sign-up, recovery request, recovery confirm. Before this
   * each handler rendered `err.message`, i.e. the backend's English string,
   * which is why the whole screen spoke English in Arabic.
   */
  const reportAuthError = useCallback(
    (err: unknown, opts: { failSound?: boolean } = {}) => {
      const resolved: ResolvedAuthError = authErrorFromThrown(err, t);

      // A contract-shaped `AUTH_MFA_REQUIRED` may still carry the `loginToken`
      // the second-factor step needs. Take the step instead of dead-ending.
      if (
        resolved.code === "AUTH_MFA_REQUIRED" &&
        err instanceof AuthApiError &&
        typeof err.payload.loginToken === "string"
      ) {
        setLoginOtpToken(err.payload.loginToken);
        setLoginOtpTo(
          typeof err.payload.emailMasked === "string"
            ? err.payload.emailMasked
            : undefined,
        );
        setLoginOtpStep(true);
        setBanner(null);
        return;
      }

      if (opts.failSound !== false) play("login-fail");

      if (resolved.sessionEnded) {
        // Never a dead end: explain, and offer the way back.
        setBanner({
          tone: "notice",
          message: resolved.message,
          kind: resolved.kind,
          action: {
            label: t("auth.signInAgain", "Sign in again"),
            onClick: goToLoginWithReason,
          },
        });
        return;
      }

      setBanner({
        tone: "error",
        message: resolved.message,
        retryAfterSec: resolved.retryAfterSec,
        kind: resolved.kind,
      });
    },
    [goToLoginWithReason, play, t],
  );

  /* A session that dies while this screen is mounted — or an arrival on
     `/login?reason=session-expired` from anywhere in the app — gets an
     explanation instead of a bare redirect. */
  const sessionExpiredNotice = useCallback(() => {
    setBanner({
      tone: "notice",
      message: t("auth.errSessionExpired",
        "Your session expired, so you were signed out. Sign in again to carry on where you left off.",
      ),
      kind: "session",
    });
  }, [t]);

  useEffect(() => {
    if (isSessionExpiredReason(new URLSearchParams(search ?? "").get("reason"))) {
      sessionExpiredNotice();
    }
    // Only on mount / URL change: a notice must not re-announce on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!sessionExpired) return;
    sessionExpiredNotice();
    dismissSessionExpiry();
  }, [dismissSessionExpiry, sessionExpired, sessionExpiredNotice]);

  /* ---- Mode switching --------------------------------------------------- */

  /* Switching mode clears transient errors but keeps typed values, so an
     accidental toggle does not destroy the user's input. */
  const switchTo = useCallback(
    (next: AuthMode) => {
      if (loginGuard.pending || signupGuard.pending) return;
      setBanner(null);
      setMode(next);
      setOtpStep(false);
      setOtpVerified(false);
      setLoginOtpStep(false);
      setLoginOtpToken(undefined);
      setLoginOtpTo(undefined);
    },
    [loginGuard.pending, signupGuard.pending],
  );

  /*
   * Cross-flow jumps go through the ROUTER, not `switchTo`, even though both
   * are modes of this component.
   *
   * Reason: `/reset-password` and `/forgot-password` have to survive a
   * refresh, a bookmark and the back button. Switching the mode in place would
   * leave the URL pointing at the previous flow, so reloading would show the
   * wrong form — a much worse failure than a page transition. The in-place
   * switch is kept for login <-> signup, where there is no URL to keep honest.
   */
  const goForgot = useCallback(() => {
    setBanner(null);
    setLocation("/forgot-password");
  }, [setLocation]);

  const goLogin = useCallback(() => {
    setBanner(null);
    dismissSessionExpiry();
    setLocation("/login");
  }, [dismissSessionExpiry, setLocation]);

  const setLoginField = useCallback(
    (key: keyof LoginValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target;
      setLoginValues((prev) => ({ ...prev, [key]: value }));
      setLoginErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    },
    [],
  );

  const setSignupField = useCallback(
    (key: keyof SignupValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target;
      setSignupValues((prev) => ({ ...prev, [key]: value }));
      setSignupErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    },
    [],
  );

  const setResetField = useCallback(
    (key: keyof typeof EMPTY_RESET) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target;
      setResetValues((prev) => ({ ...prev, [key]: value }));
      setResetErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    },
    [],
  );

  /* ---- Login ----------------------------------------------------------- */

  async function performLogin() {
    setBanner(null);
    const errors = validateLogin(loginValues, t);
    setLoginErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      // Password step. The backend either opens a session directly (accounts
      // without an email) or returns otpRequired + a loginToken, in which case
      // we show the OTP step as a required second factor.
      const res = await login({
        username: loginValues.username,
        password: loginValues.password,
      });
      if (!res || !(res as { otpRequired?: boolean }).otpRequired) return;
      const r = res as { loginToken?: string; emailMasked?: string };
      setLoginOtpToken(r.loginToken);
      setLoginOtpTo(r.emailMasked ?? undefined);
      setLoginOtpStep(true);
    } catch (err) {
      reportAuthError(err);
    }
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    void loginGuard.run(performLogin);
  }

  async function performLoginOtpResend() {
    if (!loginOtpToken) return;
    setBanner(null);
    try {
      const res = await sendLoginOtp({
        username: loginValues.username,
        loginToken: loginOtpToken,
      });
      if (res.emailMasked) setLoginOtpTo(res.emailMasked);
    } catch (err) {
      reportAuthError(err);
      throw err;
    }
  }

  async function performLoginOtpVerify(code: string): Promise<boolean> {
    if (!loginOtpToken) return false;
    setBanner(null);
    try {
      // On success the backend establishes the session; the auth gate in
      // App.tsx will flip /api/auth/me and redirect, unmounting this screen.
      await verifyLoginOtp({
        username: loginValues.username,
        loginToken: loginOtpToken,
        code,
      });
      play("login-success");
      return true;
    } catch (err) {
      reportAuthError(err);
      return false;
    }
  }

  /* ---- Sign-up --------------------------------------------------------- */

  async function performSignup() {
    setBanner(null);
    const errors = validateSignup(signupValues, t);
    setSignupErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const email = signupValues.email.trim() || undefined;
    try {
      // Unchanged API contract: POST /api/auth/signup via useAuth().
      // Optional fields are omitted when blank, exactly as before.
      await signup({
        username: signupValues.username,
        password: signupValues.password,
        fullName: signupValues.fullName.trim() || undefined,
        email,
        reason: signupValues.reason.trim() || undefined,
      });
      // No email -> nothing to verify; go straight to the pending-approval screen.
      if (!email) {
        setSubmitted(true);
        return;
      }
      // Email provided -> ask the server to send a real verification code,
      // then show the OTP step.
      setOtpTo(undefined);
      await sendSignupOtp({ username: signupValues.username, email });
      setOtpStep(true);
    } catch (err) {
      reportAuthError(err);
    }
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    void signupGuard.run(performSignup);
  }

  async function performOtpResend() {
    const email = signupValues.email.trim();
    if (!email) return;
    setBanner(null);
    try {
      const res = await sendSignupOtp({ username: signupValues.username, email });
      if (res.emailMasked) setOtpTo(res.emailMasked);
    } catch (err) {
      reportAuthError(err);
      throw err;
    }
  }

  async function performOtpVerify(code: string): Promise<boolean> {
    const email = signupValues.email.trim();
    if (!email) return false;
    setBanner(null);
    try {
      const res = await verifySignupOtp({
        username: signupValues.username,
        email,
        code,
      });
      if (res.verified) {
        // Let the UI show the "Verified!" state briefly before advancing.
        setOtpVerified(true);
        await new Promise((r) => setTimeout(r, 900));
        setOtpStep(false);
        setSubmitted(true);
        return true;
      }
      return false;
    } catch (err) {
      reportAuthError(err);
      return false;
    }
  }

  /* ---- Password recovery: request -------------------------------------- */

  async function performForgotRequest() {
    setBanner(null);
    setIdentifierError(undefined);
    const value = identifier.trim();
    if (!value) {
      setIdentifierError(
        t("auth.errIdentifierRequired",
          "Enter the email or username on your account.",
        ),
      );
      return;
    }
    try {
      const res = await requestPasswordReset({ identifier: value });
      // The response is neutral by design: we learn nothing about whether the
      // account exists, so there is exactly one "sent" state either way.
      dispatchRecovery({ type: "requested" });
      // Some dev/test deployments hand back a token so the flow can be
      // completed without an inbox. Shown as a convenience link, never as
      // evidence that the account exists.
      if (!resetToken && typeof res?.token === "string" && res.token) {
        setDevResetToken(res.token);
      }
    } catch (err) {
      // A throttled request still has to show the countdown, and it is NOT a
      // neutral success — the user did not actually get a link.
      reportAuthError(err);
      dispatchRecovery({ type: "request-failed" });
    }
  }

  function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    void forgotGuard.run(performForgotRequest);
  }

  function handleForgotResend() {
    if (!recovery.canResend) return;
    void forgotGuard.run(async () => {
      try {
        await requestPasswordReset({ identifier: identifier.trim() });
        dispatchRecovery({ type: "resend-sent" });
      } catch (err) {
        reportAuthError(err);
      }
    });
  }

  /* ---- Password recovery: confirm -------------------------------------- */

  async function performResetConfirm() {
    setBanner(null);
    const errors = validateReset(resetValues, t);
    setResetErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!resetToken && !devResetToken) {
      dispatchRecovery({ type: "token-missing" });
      return;
    }
    try {
      await confirmPasswordReset({
        token: resetToken || (devResetToken as string),
        password: resetValues.password,
      });
      dispatchRecovery({ type: "reset-succeeded" });
      play("login-success");
    } catch (err) {
      // Expired / used / invalid are genuinely different dead ends and get
      // different copy plus different actions — see `tokenProblemCopy`.
      const resolved = authErrorFromThrown(err, t);
      dispatchRecovery({ type: "reset-failed", code: resolved.code });
      play("login-fail");
    }
  }

  function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    void resetGuard.run(performResetConfirm);
  }

  /**
   * The step the RESET half is actually in.
   *
   * A deep link with no `?token=` cannot be confirmed at all, so it says so on
   * arrival rather than letting the user type a password that is guaranteed to
   * be rejected. `reset-done` is the one state that must survive this — after a
   * successful confirm there is no token in play any more, and the form must
   * not fall back to "your link is incomplete".
   */
  const recoveryStep: RecoveryStep = useMemo(() => {
    if (mode !== "reset") return recovery.step;
    if (recovery.step === "reset-done") return "reset-done";
    return resetToken || devResetToken ? recovery.step : "token-missing";
  }, [devResetToken, mode, recovery.step, resetToken]);

  /* ---- Height animation ------------------------------------------------ */
  /* The modes have different form heights. We measure a hidden mirror of the
     active panel and animate the card height so nothing jumps or clips. This
     is the ONLY layout animation in this file and it is measured, not guessed. */
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => setPanelHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Move focus to the first field of the newly revealed form so keyboard and
     screen-reader users follow the transition. Panels with no input (the
     confirmation, the token problems, the success states) mark their heading
     with `data-autofocus` so focus lands on the copy instead of on <body>. */
  const formRegionRef = useRef<HTMLDivElement | null>(null);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (submitted) return;
    const target = formRegionRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, [data-autofocus]',
    );
    target?.focus();
  }, [mode, recoveryStep, submitted]);

  /* ---- Copy ------------------------------------------------------------ */

  const welcomeCopy = useMemo(() => {
    switch (mode) {
      case "login":
        return {
          title: t("auth.welcomeBackTitle", "WELCOME BACK!"),
          body: t("auth.welcomeBackBody",
            "Sign in to pick up where you left off — your studies, cohorts and patient records are right where you left them.",
          ),
          prompt: t("auth.welcomeBackPrompt", "Don't have an account?"),
          action: t("auth.signupCta", "Sign Up"),
        };
      case "signup":
        return {
          title: t("auth.helloTitle", "HELLO, FRIEND!"),
          body: t("auth.helloBody",
            "Request access to the research platform. An administrator reviews every request before an account is activated.",
          ),
          prompt: t("auth.helloPrompt", "Already have an account?"),
          action: t("auth.loginCta", "Login"),
        };
      case "forgot":
        return {
          title: t("auth.forgotTitle", "FORGOT YOUR PASSWORD?"),
          body: t("auth.forgotBody",
            "Enter the email or username on your account and we'll send a link to set a new password.",
          ),
          prompt: t("auth.forgotPrompt", "Remembered it after all?"),
          action: t("auth.backToLogin", "Back to login"),
        };
      case "reset":
      default:
        return {
          title: t("auth.resetTitle", "CHOOSE A NEW PASSWORD"),
          body: t("auth.resetBody",
            "Pick something you have not used before. You will use it every time you sign in.",
          ),
          prompt: t("auth.resetPrompt", "Already updated your password?"),
          action: t("auth.backToLogin", "Back to login"),
        };
    }
  }, [mode, t]);

  const headerCopy = useMemo(() => {
    switch (mode) {
      case "signup":
        return {
          title: t("auth.createAccount", "Create an account"),
          sub: t("auth.createAccountSub",
            "Request access — an administrator will review it.",
          ),
        };
      case "forgot":
        return {
          title: t("auth.forgotHeading", "Reset your password"),
          sub: t("auth.forgotSub",
            "We will email a reset link if the details match an account.",
          ),
        };
      case "reset":
        return {
          title: t("auth.resetHeading", "Set a new password"),
          sub: t("auth.resetSub",
            "This replaces the password you use to sign in.",
          ),
        };
      case "login":
      default:
        return {
          title: t("auth.signIn", "Sign in"),
          sub: t("auth.signInSub",
            "Access your research workspace and patient records.",
          ),
        };
    }
  }, [mode, t]);

  const liveRegionCopy = useMemo(() => {
    if (submitted)
      return t("auth.a11ySubmitted", "Sign-up request submitted");
    switch (mode) {
      case "signup":
        return t("auth.a11ySignupForm", "Sign up form");
      case "forgot":
        return t("auth.a11yForgotForm", "Password reset request form");
      case "reset":
        return t("auth.a11yResetForm", "Set a new password form");
      case "login":
      default:
        return t("auth.a11yLoginForm", "Login form");
    }
  }, [mode, submitted, t]);

  /* ---- Panels ---------------------------------------------------------- */

  const submitLabel = throttled
    ? t("auth.btnRetryIn", "Try again in {{time}}", {
        time: formatCountdown(retryRemaining),
      })
    : null;

  const loginPanel = (
    <form onSubmit={handleLogin} noValidate className="space-y-4">
      <FieldStagger className="space-y-4">
        <Field
          label={t("auth.fUsername", "Username")}
          name="username"
          autoComplete="username"
          placeholder={t("auth.phUsername", "Enter your username")}
          value={loginValues.username}
          onChange={setLoginField("username")}
          disabled={loginGuard.pending}
          error={loginErrors.username}
        />
        <AuthPasswordField
          label={t("auth.fPassword", "Password")}
          name="password"
          autoComplete="current-password"
          placeholder={t("auth.phPassword", "Enter your password")}
          value={loginValues.password}
          onChange={setLoginField("password")}
          disabled={loginGuard.pending}
          error={loginErrors.password}
        />
      </FieldStagger>

      <div className="-mt-1 flex justify-end">
        <button
          type="button"
          onClick={goForgot}
          className="text-xs font-medium text-white/75 underline underline-offset-4 transition-colors hover:text-white hover:no-underline"
        >
          {t("auth.forgotPassword", "Forgot password?")}
        </button>
      </div>

      <FormBanner banner={banner} retryRemaining={retryRemaining} t={t} />

      <div className="flex justify-center pt-2">
        <AuthSubmit
          busy={loginGuard.pending || isLoggingIn}
          busyLabel={t("auth.btnSigningIn", "Signing in…")}
          disabled={throttled}
          className="auth-submit"
        >
          {submitLabel ?? t("auth.btnLogin", "Login")}
        </AuthSubmit>
      </div>

      <SocialProviders />
    </form>
  );

  const signupPanel = (
    <form onSubmit={handleSignup} noValidate className="space-y-4">
      <FieldStagger className="space-y-4">
        <Field
          label={t("auth.fUsername", "Username")}
          name="username"
          autoComplete="username"
          placeholder={t("auth.phUsernameNew", "Choose a username")}
          value={signupValues.username}
          onChange={setSignupField("username")}
          disabled={signupGuard.pending}
          error={signupErrors.username}
        />
        <AuthPasswordField
          label={t("auth.fPassword", "Password")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("auth.phPasswordNew", "Create a password")}
          value={signupValues.password}
          onChange={setSignupField("password")}
          disabled={signupGuard.pending}
          showStrength
          showRules
          error={signupErrors.password}
        />
        <AuthPasswordField
          label={t("auth.fConfirmPassword", "Confirm password")}
          name="confirm-password"
          autoComplete="new-password"
          placeholder={t("auth.phPasswordConfirm", "Re-enter your password")}
          value={signupValues.confirmPassword}
          onChange={setSignupField("confirmPassword")}
          disabled={signupGuard.pending}
          error={signupErrors.confirmPassword}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("auth.fFullName", "Full name")}
            hint={t("common.optional", "Optional")}
            name="name"
            autoComplete="name"
            placeholder={t("auth.phFullName", "Your name")}
            value={signupValues.fullName}
            onChange={setSignupField("fullName")}
            disabled={signupGuard.pending}
            error={signupErrors.fullName}
          />
          <Field
            label={t("auth.fEmail", "Email")}
            required
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t("auth.phEmail", "you@example.com")}
            value={signupValues.email}
            onChange={setSignupField("email")}
            disabled={signupGuard.pending}
            error={signupErrors.email}
          />
        </div>
        <Field
          label={t("auth.fReason", "Reason for access")}
          hint={t("common.optional", "Optional")}
          name="reason"
          placeholder={t("auth.phReason", "Briefly describe your use")}
          value={signupValues.reason}
          onChange={setSignupField("reason")}
          disabled={signupGuard.pending}
          error={signupErrors.reason}
        />
      </FieldStagger>

      <FormBanner banner={banner} retryRemaining={retryRemaining} t={t} />

      <div className="flex justify-center pt-2">
        <AuthSubmit
          busy={signupGuard.pending || isSigningUp || isSendingSignupOtp}
          busyLabel={t("auth.btnSubmitting", "Submitting…")}
          disabled={throttled}
        >
          {submitLabel ?? t("auth.btnSignup", "Sign Up")}
        </AuthSubmit>
      </div>
    </form>
  );

  /**
   * POST-RESET-REQUEST CONFIRMATION.
   *
   * The copy is deliberately identical whether or not the account exists — that
   * is the whole security property of the neutral endpoint. It says what we
   * DID ("if an account matches…") and never what we FOUND.
   */
  const requestSentPanel = (
    <div className="mx-auto w-full max-w-sm space-y-4 text-center" role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-400/25 bg-sky-400/10">
        <MailCheck className="h-7 w-7 text-sky-300" aria-hidden="true" />
      </span>
      <h2
        tabIndex={-1}
        data-autofocus
        className="text-xl font-semibold text-white outline-none"
      >
        {t("auth.resetSentTitle", "Check your inbox")}
      </h2>
      <p className="text-sm leading-relaxed text-white/70">
        {t("auth.resetSentBody",
          "If an account matches those details, a reset link is on its way. The link expires in a short time, so use it soon.",
        )}
      </p>
      {devResetToken ? (
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {t("auth.resetDevToken",
            "Development mode: the server returned a reset link directly.",
          )}{" "}
          <a
            href={`/reset-password?token=${encodeURIComponent(devResetToken)}`}
            className="font-semibold underline underline-offset-2"
          >
            {t("auth.resetDevTokenOpen", "Open the reset form")}
          </a>
        </p>
      ) : null}
      <div className="flex flex-col items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={handleForgotResend}
          disabled={!recovery.canResend || forgotGuard.pending}
          className="auth-ghost h-10 w-full max-w-xs rounded-xl bg-transparent px-6 text-sm font-semibold"
        >
          {recovery.cooldownSec > 0
            ? t("auth.resendIn", "Resend in {{time}}", {
                time: formatCountdown(recovery.cooldownSec),
              })
            : t("auth.resendLink", "Send it again")}
        </Button>
        <button
          type="button"
          onClick={() => dispatchRecovery({ type: "start-over" })}
          className="text-xs font-medium text-white/70 underline underline-offset-4 hover:text-white hover:no-underline"
        >
          {t("auth.resetTryDifferent",
            "Use a different email or username",
          )}
        </button>
      </div>
    </div>
  );

  const forgotPanel = (
    <form onSubmit={handleForgotSubmit} noValidate className="space-y-4">
      <FieldStagger className="space-y-4">
        <Field
          label={t("auth.fIdentifier", "Email or username")}
          name="username"
          // Managers key off `username` to offer the stored identity; this is
          // the only field on the page that can take either form.
          autoComplete="username"
          placeholder={t("auth.phIdentifier", "you@example.com or your username")}
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setIdentifierError(undefined);
          }}
          disabled={forgotGuard.pending}
          error={identifierError}
        />
      </FieldStagger>

      <p className="text-xs leading-relaxed text-white/55">
        {t("auth.resetNeutralHint",
          "For your privacy we answer the same way whether or not the details match an account.",
        )}
      </p>

      <FormBanner banner={banner} retryRemaining={retryRemaining} t={t} />

      <div className="flex justify-center pt-2">
        <AuthSubmit
          busy={forgotGuard.pending || isRequestingPasswordReset}
          busyLabel={t("auth.btnSending", "Sending…")}
          disabled={throttled}
        >
          {submitLabel ?? t("auth.btnSendResetLink", "Send reset link")}
        </AuthSubmit>
      </div>
    </form>
  );

  /**
   * Token-problem copy. Four genuinely different states, because an expired
   * link (by far the most common) has a completely different remedy from a
   * used one, and "request failed" tells the user nothing they can act on.
   */
  const tokenProblemCopy = useMemo(() => {
    switch (recoveryStep) {
      case "token-missing":
        return {
          title: t("auth.resetLinkMissingTitle", "That link is incomplete"),
          body: t("auth.resetLinkMissingBody",
            "The reset link did not include a token, so there is nothing to verify. Open the link straight from your email, or request a new one.",
          ),
        };
      case "token-invalid":
        return {
          title: t("auth.errResetTokenInvalid", "This password-reset link is not valid. It may have been altered in transit — request a new one."),
          body: t("auth.resetLinkInvalidBody",
            "Request a new link below and it will work straight away.",
          ),
        };
      case "token-expired":
        return {
          title: t("auth.errResetTokenExpired",
            "This password-reset link has expired. Reset links are deliberately short-lived to protect your account — request a new link and it will work immediately.",
          ),
          body: t("auth.resetLinkExpiredBody",
            "Nothing is lost: your account and your old password are untouched. Request a new link and set a new password.",
          ),
        };
      case "token-used":
        return {
          title: t("auth.errResetTokenUsed",
            "This password-reset link has already been used. If that was you, sign in with your new password; otherwise request a new link.",
          ),
          body: t("auth.resetLinkUsedBody",
            "A reset link only works once, so it cannot be reused. If you did not do this, request a new link and change your password again.",
          ),
        };
      default:
        return null;
    }
  }, [recoveryStep, t]);

  const tokenProblemPanel = tokenProblemCopy ? (
    <div className="mx-auto w-full max-w-sm space-y-4 text-center" role="alert">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10">
        <LockKeyhole className="h-7 w-7 text-amber-300" aria-hidden="true" />
      </span>
      <h2
        tabIndex={-1}
        data-autofocus
        className="text-lg font-semibold leading-snug text-white outline-none"
      >
        {tokenProblemCopy.title}
      </h2>
      <p className="text-sm leading-relaxed text-white/70">{tokenProblemCopy.body}</p>
      <div className="flex flex-col items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={goForgot}
          className="auth-submit h-10 w-full max-w-xs rounded-xl text-sm font-semibold"
        >
          {t("auth.resetRequestNew", "Request a new link")}
        </Button>
        {recoveryStep === "token-used" ? (
          <button
            type="button"
            onClick={goLogin}
            className="text-xs font-medium text-white/70 underline underline-offset-4 hover:text-white hover:no-underline"
          >
            {t("auth.backToLogin", "Back to login")}
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  const resetPanel = (
    <form onSubmit={handleResetSubmit} noValidate className="space-y-4">
      <FieldStagger className="space-y-4">
        <AuthPasswordField
          label={t("auth.fNewPassword", "New password")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("auth.phPasswordNew", "Create a password")}
          value={resetValues.password}
          onChange={setResetField("password")}
          disabled={resetGuard.pending || isConfirmingPasswordReset}
          showStrength
          showRules
          error={resetErrors.password}
        />
        <AuthPasswordField
          label={t("auth.fConfirmPassword", "Confirm password")}
          name="confirm-password"
          autoComplete="new-password"
          placeholder={t("auth.phPasswordConfirm", "Re-enter your password")}
          value={resetValues.confirmPassword}
          onChange={setResetField("confirmPassword")}
          disabled={resetGuard.pending || isConfirmingPasswordReset}
          error={resetErrors.confirmPassword}
        />
      </FieldStagger>

      <FormBanner banner={banner} retryRemaining={retryRemaining} t={t} />

      <div className="flex justify-center pt-2">
        <AuthSubmit
          busy={resetGuard.pending || isConfirmingPasswordReset}
          busyLabel={t("auth.btnSaving", "Saving…")}
          disabled={throttled}
        >
          {submitLabel ?? t("auth.btnSavePassword", "Save new password")}
        </AuthSubmit>
      </div>
    </form>
  );

  /**
   * Success after a reset.
   *
   * The confirmation occupies the SAME box the user just pressed Submit from —
   * same width, radius and `auth-submit` treatment — and the check springs into
   * the spinner's place. That continuity is the point: a spinner that vanishes
   * and is replaced by a card elsewhere on screen forces the eye to re-acquire
   * a target, and users read that gap as "did it work?". The route onward is a
   * secondary link, because the primary action is finished.
   */
  const resetDonePanel = (
    <div className="mx-auto w-full max-w-sm space-y-4 text-center" role="status">
      <h2
        tabIndex={-1}
        data-autofocus
        className="text-xl font-semibold text-white outline-none"
      >
        {t("auth.resetDoneTitle", "Password updated")}
      </h2>
      <p className="text-sm leading-relaxed text-white/70">
        {t("auth.resetDoneBody",
          "Your new password is live. Use it the next time you sign in.",
        )}
      </p>
      <div className="flex justify-center pt-2">
        <AuthSubmit
          succeeded
          successLabel={t("auth.resetDoneTitle", "Password updated")}
          className="auth-submit"
        >
          {t("auth.btnSavePassword", "Save new password")}
        </AuthSubmit>
      </div>
      <button
        type="button"
        onClick={goLogin}
        className="text-xs font-medium text-white/75 underline underline-offset-4 hover:text-white hover:no-underline"
      >
        {t("auth.backToLogin", "Back to login")}
      </button>
    </div>
  );

  /* Success state for the pending-approval sign-up flow (behaviour unchanged). */
  const successPanel = (
    <div className="mx-auto w-full max-w-sm space-y-4 text-center" role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10">
        <CheckCircle2 className="h-7 w-7 text-emerald-300" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-semibold text-white">
        {t("auth.requestSubmitted", "Request submitted")}
      </h2>
      <p className="max-w-sm text-center text-sm leading-relaxed text-white/60">
        {otpVerified
          ? t("auth.requestSubmittedBodyVerified",
              "Your email is confirmed. Your sign-up request is pending admin approval. You'll be able to log in once an administrator confirms it (website access only).",
            )
          : t("auth.requestSubmittedBody",
              "Your sign-up request is pending admin approval. You'll be able to log in once an administrator confirms it (website access only).",
            )}
      </p>
      {/* Same geometry the user just pressed, confirming in place rather than
          vanishing and being replaced somewhere else on the card. */}
      <div className="flex justify-center pt-2">
        <AuthSubmit
          succeeded
          successLabel={t("auth.requestSubmitted", "Request submitted")}
          className="auth-submit"
        >
          {t("auth.btnSignup", "Sign Up")}
        </AuthSubmit>
      </div>
      <button
        type="button"
        onClick={() => {
          setSubmitted(false);
          setOtpStep(false);
          setOtpVerified(false);
          setSignupValues(EMPTY_SIGNUP);
          setSignupErrors({});
          switchTo("login");
        }}
        className="text-xs font-medium text-white/75 underline underline-offset-4 hover:text-white hover:no-underline"
      >
        {t("auth.backToLogin", "Back to login")}
      </button>
    </div>
  );

  /* OTP email-verification step — sits between the sign-up form and the
     pending-approval screen. Only reached when the user supplied an email. */
  const otpPanel = (
    <div className="flex w-full justify-center py-1">
      <OtpVerification
        length={6}
        toLabel={otpTo}
        title={t("auth.otpTitle", "Verify your email")}
        subtitle={
          otpTo
            ? t("auth.otpSubtitleTo",
                "We sent a 6-digit code to {{to}}. It auto-verifies once entered.",
                { to: otpTo },
              )
            : t("auth.otpSubtitle",
                "We sent a 6-digit code to your email. It auto-verifies once entered.",
              )
        }
        onVerify={performOtpVerify}
        onResend={performOtpResend}
        resendCooldownSeconds={OTP_RESEND_COOLDOWN_SEC}
      />
    </div>
  );

  /* Login 2FA step — shown after a correct password when the account has an
     email on file. Required second factor before the session is created. */
  const loginOtpPanel = (
    <div className="flex w-full justify-center py-1">
      <OtpVerification
        length={6}
        toLabel={loginOtpTo}
        title={t("auth.loginOtpTitle", "Verify it's you")}
        subtitle={
          loginOtpTo
            ? t("auth.loginOtpSubtitleTo",
                "Enter the 6-digit code we sent to {{to}}.",
                { to: loginOtpTo },
              )
            : t("auth.loginOtpSubtitle",
                "Enter the 6-digit code we emailed you.",
              )
        }
        onVerify={performLoginOtpVerify}
        onResend={performLoginOtpResend}
        resendCooldownSeconds={OTP_RESEND_COOLDOWN_SEC}
      />
      <RecoveryCodeEntry
        // Rejects on failure so the component can retire that exact code (a
        // recovery code is single-use) while still allowing a different one, so
        // a typo stays recoverable.
        // Returns void: the server establishes the session, so there is nothing
        // for the caller to do with the response body. Rejections propagate —
        // that is how the component retires a spent code.
        onRedeem={async (code) => {
          await redeemRecoveryCode({ code });
        }}
        username={loginValues.username}
        loginToken={loginOtpToken}
        variant="inline"
        collapsedByDefault
      />
    </div>
  );

  /** The reset link is unusable: show the explanation alone, not the form. */
  const showTokenProblem =
    mode === "reset" && isTokenProblem({ ...recovery, step: recoveryStep });

  const formContent = submitted
    ? successPanel
    : loginOtpStep
      ? loginOtpPanel
      : otpStep
        ? otpPanel
        : mode === "forgot"
          ? recovery.step === "request-sent"
            ? requestSentPanel
            : forgotPanel
          : mode === "reset"
            ? recoveryStep === "reset-done"
              ? resetDonePanel
              : showTokenProblem
                ? tokenProblemPanel
                : resetPanel
            : mode === "login"
              ? loginPanel
              : signupPanel;

  const hidesHeader =
    submitted ||
    otpStep ||
    loginOtpStep ||
    recovery.step === "request-sent" ||
    showTokenProblem;

  const formHeader = hidesHeader ? null : (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        {headerCopy.title}
      </h1>
      <p className="text-sm text-white/75">{headerCopy.sub}</p>
    </div>
  );

  /** Compact single brand row for the mobile stacked layout. */
  const welcomeBrandRow = (
    <>
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 backdrop-blur">
        <ShieldCheck className="h-4 w-4 text-white" aria-hidden="true" />
      </span>
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/80">
        {t("auth.mobileWelcome", "MedResearch")}
      </span>
    </>
  );

  /* Welcome panel content, shared by the desktop side panel and the mobile
     header strip. The action is a route change for the recovery modes so the
     URL keeps matching the form on screen. */
  const welcomeContent = (
    <>
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur">
        {mode === "forgot" || mode === "reset" ? (
          <KeyRound className="h-5 w-5 text-white" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
        )}
      </span>
      <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-white/80">
        {t("auth.mobileWelcome", "MedResearch")}
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-white lg:text-4xl">
        {welcomeCopy.title}
      </h2>
      <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-white/70">
        {welcomeCopy.body}
      </p>
      <p className="mx-auto mt-7 max-w-sm text-center text-sm text-white/70">
        {welcomeCopy.prompt}
      </p>
      <Button
        type="button"
        onClick={() => {
          if (mode === "forgot" || mode === "reset") goLogin();
          else switchTo(mode === "login" ? "signup" : "login");
        }}
        disabled={loginGuard.pending || signupGuard.pending}
        className="auth-ghost mt-2.5 h-10 rounded-xl bg-transparent px-7 text-sm font-semibold uppercase tracking-wider"
      >
        {mode === "login" ? (
          <>
            {welcomeCopy.action}
            <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </>
        ) : (
          <>
            <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {welcomeCopy.action}
          </>
        )}
      </Button>
    </>
  );

  const panelVariants = reduced ? MODE_PANEL_REDUCED : MODE_PANEL;

  /**
   * The split panel was hardcoded LTR (`x: "100%"`), so in Arabic the form
   * slid in from the wrong edge and landed *over* the welcome panel. Derive
   * the direction from the active language instead of assuming English.
   */
  const isRtl = i18n.resolvedLanguage?.startsWith("ar") ?? false;
  /** Login keeps the welcome panel in place; every other mode shows the form. */
  const formInFront = mode !== "login";
  const slide = reduced ? { duration: 0, ease: EASE_OUT } : PANEL_SLIDE;

  return (
    // `auth-shell` sets `overflow: hidden`, which on a phone means focusing the
    // password field shrinks the visual viewport and the Submit button and OTP
    // inputs become unreachable with no way to scroll. `auth-shell-scroll`
    // overrides it locally; see the token report for the CSS-side fix.
    <main className="auth-shell auth-shell-scroll flex items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      {/* Decorative ambient glow — purely visual */}
      <div
        aria-hidden="true"
        className="auth-orb auth-orb-animate -left-24 top-[-10%] h-[26rem] w-[26rem]"
      />
      <div
        aria-hidden="true"
        className="auth-orb auth-orb-animate -right-28 bottom-[-14%] h-[30rem] w-[30rem]"
        style={{ animationDelay: "-11s" }}
      />

      <div className="w-full max-w-md lg:max-w-5xl">
        {/* Announce the current mode for screen readers */}
        <p className="sr-only" aria-live="polite">
          {liveRegionCopy}
        </p>

        {/* ---------------- Mobile / tablet: stacked layout ---------------- */}
        <div className="auth-card overflow-hidden lg:hidden">
          {/* Form first on mobile: the welcome panel used to render ABOVE the
              form, pushing the login form ~300px down the viewport. */}
          <div className="px-6 py-7 sm:px-8 order-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${mode}-${recovery.step}-${submitted}-mobile`}
                variants={panelVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {formHeader}
                {formContent}
              </motion.div>
            </AnimatePresence>
          </div>
          {/* Collapsed to a single brand row so it costs ~44px, not ~300px. */}
          <div className="auth-welcome flex items-center justify-center gap-3 px-6 py-4 text-center order-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                variants={panelVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {welcomeBrandRow}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ---------------- Desktop: sliding split panels ------------------ */}
        <motion.div
          className="auth-card relative hidden overflow-hidden lg:block"
          animate={{ height: panelHeight ?? undefined }}
          transition={{ duration: reduced ? 0 : DURATION.slow, ease: EASE_OUT }}
          style={{ minHeight: 460 }}
        >
          {/* Form panel — occupies the right half in login mode */}
          <motion.div
            className={cn("absolute inset-y-0 z-10 w-1/2", isRtl ? "right-0" : "left-0")}
            initial={false}
            animate={{ x: formInFront ? "0%" : isRtl ? "-100%" : "100%" }}
            transition={slide}
          >
            <div
              ref={formRegionRef}
              className="flex h-full flex-col justify-center px-10 py-10 xl:px-14"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${mode}-${recovery.step}-${submitted}`}
                  variants={panelVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  {formHeader}
                  {formContent}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Welcome panel — always slides the opposite way */}
          <motion.div
            className={cn(
              "auth-welcome absolute inset-y-0 w-1/2 overflow-hidden",
              isRtl ? "right-0" : "left-0",
            )}
            initial={false}
            animate={{ x: formInFront ? (isRtl ? "-100%" : "100%") : "0%" }}
            transition={slide}
          >
            <div className="flex h-full flex-col items-center justify-center px-10 py-12 text-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode}
                  variants={panelVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  {welcomeContent}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Hidden measurer: mirrors the active form so the card height can be
              animated without ever clipping content or jumping. `inert` keeps
              this copy out of the tab order, the a11y tree and autofill. */}
          <div
            aria-hidden="true"
            ref={(el) => el?.setAttribute("inert", "")}
            className="pointer-events-none invisible absolute left-0 top-0 w-1/2"
          >
            <div ref={measureRef} className="px-10 py-10 xl:px-14">
              {formHeader}
              {formContent}
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
