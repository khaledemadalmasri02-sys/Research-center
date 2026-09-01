import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { OtpVerification } from "@/components/auth/OtpVerification";

export type AuthMode = "login" | "signup";

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/*                                                                            */
/* Mirrors the server rules (api-server/src/lib/security.ts isValidPassword +  */
/* routes/auth.ts) so users get instant feedback. The server stays the source  */
/* of truth — anything it rejects is surfaced through the error banner.        */
/* -------------------------------------------------------------------------- */

const PASSWORD_COMPLEXITY_MESSAGE =
  "Password must include lowercase, uppercase, a number, and a symbol.";

function validatePassword(pw: string): string | undefined {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    return PASSWORD_COMPLEXITY_MESSAGE;
  }
  return undefined;
}

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

type Errors<T> = Partial<Record<keyof T, string>>;

function validateLogin(v: LoginValues): Errors<LoginValues> {
  const errors: Errors<LoginValues> = {};
  if (!v.username.trim()) errors.username = "Enter your username.";
  if (!v.password) errors.password = "Enter your password.";
  return errors;
}

function validateSignup(v: SignupValues): Errors<SignupValues> {
  const errors: Errors<SignupValues> = {};
  if (v.username.trim().length < 3) errors.username = "Username must be at least 3 characters.";
  const pw = validatePassword(v.password);
  if (pw) errors.password = pw;
  if (!v.confirmPassword) errors.confirmPassword = "Confirm your password.";
  else if (v.confirmPassword !== v.password) errors.confirmPassword = "Passwords do not match.";
  // Email is required — it is where the verification (OTP) code is sent.
  if (!v.email.trim()) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

/** Reserved-height inline field error, so validation never shifts the layout. */
function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p id={id} className="min-h-4 text-xs text-rose-300">
      {message ?? ""}
    </p>
  );
}

interface FieldProps extends Omit<React.ComponentProps<"input">, "id"> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

/** Labelled text input wired up for a11y (label, describedby, aria-invalid). */
function Field({ label, hint, error, required, className, ...props }: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs font-medium text-white/70">
          {label}
          {required && <span className="ml-0.5 text-rose-400" aria-hidden="true">*</span>}
        </Label>
        {hint && (
          <span id={hintId} className="text-[11px] text-white/35">
            {hint}
          </span>
        )}
      </div>
      <Input
        id={inputId}
        className={cn("auth-field h-11 rounded-xl px-3.5 text-sm shadow-none", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        {...props}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** Password input with a visibility toggle. */
function PasswordField({ label, hint, error, ...props }: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs font-medium text-white/70">
          {label}
        </Label>
        {hint && (
          <span id={hintId} className="text-[11px] text-white/35">
            {hint}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          className="auth-field h-11 rounded-xl pl-3.5 pr-11 text-sm shadow-none"
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(error && errorId, hint && hintId) || undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={props.disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-white/45 transition-colors hover:text-white/85 disabled:opacity-40"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** Server/submit error banner — assertive so it is announced immediately. */
function FormAlert({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" role="alert">
      <AnimatePresence initial={false}>
        {message && (
          <motion.p
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="overflow-hidden rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Copy for the two welcome panels                                            */
/* -------------------------------------------------------------------------- */

const WELCOME_COPY = {
  login: {
    title: "WELCOME BACK!",
    body: "Sign in to pick up where you left off — your studies, cohorts and patient records are right where you left them.",
    prompt: "Don't have an account?",
    action: "Sign Up",
  },
  signup: {
    title: "HELLO, FRIEND!",
    body: "Request access to the research platform. An administrator reviews every request before an account is activated.",
    prompt: "Already have an account?",
    action: "Login",
  },
} as const;

const EMPTY_LOGIN: LoginValues = { username: "", password: "" };
const EMPTY_SIGNUP: SignupValues = {
  username: "",
  password: "",
  confirmPassword: "",
  fullName: "",
  email: "",
  reason: "",
};

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function AuthPage({ initialMode = "login" }: { initialMode?: AuthMode }) {
  const {
    login,
    isLoggingIn,
    signup,
    isSigningUp,
    sendSignupOtp,
    verifySignupOtp,
    sendLoginOtp,
    verifyLoginOtp,
  } = useAuth();
  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [serverError, setServerError] = useState<string | null>(null);
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

  const busy = isLoggingIn || isSigningUp;
  const isLogin = mode === "login";

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

  /* Switching mode clears transient errors but keeps typed values, so an
     accidental toggle does not destroy the user's input. */
  const switchTo = useCallback(
    (next: AuthMode) => {
      if (busy) return;
      setServerError(null);
      setMode(next);
      // Reset any in-progress OTP steps when switching modes.
      setOtpStep(false);
      setOtpVerified(false);
      setLoginOtpStep(false);
      setLoginOtpToken(undefined);
      setLoginOtpTo(undefined);
    },
    [busy],
  );

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const errors = validateLogin(loginValues);
    setLoginErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      // Password step. The backend either opens a session directly (accounts
      // without an email) or returns otpRequired + a loginToken, in which case
      // we show the OTP step as a required second factor.
      const res = await login({ username: loginValues.username, password: loginValues.password });
      if (!res || !(res as any).otpRequired) return; // session already established
      const r = res as any;
      setLoginOtpToken(r.loginToken);
      setLoginOtpTo(r.emailMasked ?? undefined);
      setLoginOtpStep(true);
    } catch (err) {
      setServerError((err as Error)?.message ?? "Invalid credentials");
    }
  }

  async function handleLoginOtpResend() {
    if (!loginOtpToken) return;
    setServerError(null);
    try {
      const res = await sendLoginOtp({ username: loginValues.username, loginToken: loginOtpToken });
      if (res.emailMasked) setLoginOtpTo(res.emailMasked);
    } catch (err) {
      setServerError((err as Error)?.message ?? "Could not send code");
      throw err;
    }
  }

  async function handleLoginOtpVerify(code: string): Promise<boolean> {
    if (!loginOtpToken) return false;
    setServerError(null);
    try {
      // On success the backend establishes the session; the auth gate in App.tsx
      // will flip /api/auth/me and redirect, unmounting this screen.
      await verifyLoginOtp({ username: loginValues.username, loginToken: loginOtpToken, code });
      return true;
    } catch (err) {
      setServerError((err as Error)?.message ?? "Verification failed");
      return false;
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const errors = validateSignup(signupValues);
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
      // No email → nothing to verify; go straight to the pending-approval screen.
      if (!email) {
        setSubmitted(true);
        return;
      }
      // Email provided → ask the server to send a real verification code, then
      // show the OTP step. Uses existing sendSignupOtp mutation (real email).
      setServerError(null);
      setOtpTo(undefined);
      await sendSignupOtp({ username: signupValues.username, email });
      setOtpStep(true);
    } catch (err) {
      setServerError((err as Error)?.message ?? "Sign-up failed");
    }
  }

  async function handleOtpResend() {
    const email = signupValues.email.trim();
    if (!email) return;
    setServerError(null);
    try {
      const res = await sendSignupOtp({ username: signupValues.username, email });
      if (res.emailMasked) setOtpTo(res.emailMasked);
    } catch (err) {
      setServerError((err as Error)?.message ?? "Could not send code");
      throw err;
    }
  }

  async function handleOtpVerify(code: string): Promise<boolean> {
    const email = signupValues.email.trim();
    if (!email) return false;
    setServerError(null);
    try {
      const res = await verifySignupOtp({ username: signupValues.username, email, code });
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
      setServerError((err as Error)?.message ?? "Verification failed");
      return false;
    }
  }

  /* ---- Height animation ------------------------------------------------ */
  /* The two modes have different form heights. We measure a hidden mirror of
     the active panel and animate the card height so nothing jumps or clips. */
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
     screen-reader users follow the transition. */
  const formRegionRef = useRef<HTMLDivElement | null>(null);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (submitted) return;
    const first = formRegionRef.current?.querySelector<HTMLInputElement>(
      "input:not([type=hidden])",
    );
    first?.focus();
  }, [mode, submitted]);

  const copy = WELCOME_COPY[mode];
  const slide = { duration: reduceMotion ? 0 : 0.62, ease: EASE_OUT };

  /* ---- Panels ---------------------------------------------------------- */

  const loginPanel = (
    <form onSubmit={handleLogin} noValidate className="space-y-4">
      <Field
        label="Username"
        name="username"
        autoComplete="username"
        placeholder="Enter your username"
        value={loginValues.username}
        onChange={setLoginField("username")}
        disabled={busy}
        error={loginErrors.username}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        value={loginValues.password}
        onChange={setLoginField("password")}
        disabled={busy}
        error={loginErrors.password}
      />

      <FormAlert message={serverError} />

      <Button
        type="submit"
        disabled={busy}
        className="auth-submit h-11 w-full rounded-xl text-sm font-semibold"
      >
        {isLoggingIn ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          "Login"
        )}
      </Button>
    </form>
  );

  const signupPanel = (
    <form onSubmit={handleSignup} noValidate className="space-y-4">
      <Field
        label="Username"
        name="username"
        autoComplete="username"
        placeholder="Choose a username"
        value={signupValues.username}
        onChange={setSignupField("username")}
        disabled={busy}
        error={signupErrors.username}
      />
      <PasswordField
        label="Password"
        hint="12+ chars, mixed case, number, symbol"
        name="new-password"
        autoComplete="new-password"
        placeholder="Create a password"
        value={signupValues.password}
        onChange={setSignupField("password")}
        disabled={busy}
        error={signupErrors.password}
      />
      <PasswordField
        label="Confirm password"
        name="confirm-password"
        autoComplete="new-password"
        placeholder="Re-enter your password"
        value={signupValues.confirmPassword}
        onChange={setSignupField("confirmPassword")}
        disabled={busy}
        error={signupErrors.confirmPassword}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          hint="Optional"
          name="name"
          autoComplete="name"
          placeholder="Your name"
          value={signupValues.fullName}
          onChange={setSignupField("fullName")}
          disabled={busy}
          error={signupErrors.fullName}
        />
        <Field
          label="Email"
          required
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={signupValues.email}
          onChange={setSignupField("email")}
          disabled={busy}
          error={signupErrors.email}
        />
      </div>
      <Field
        label="Reason for access"
        hint="Optional"
        name="reason"
        placeholder="Briefly describe your use"
        value={signupValues.reason}
        onChange={setSignupField("reason")}
        disabled={busy}
        error={signupErrors.reason}
      />

      <FormAlert message={serverError} />

      <Button
        type="submit"
        disabled={busy}
        className="auth-submit h-11 w-full rounded-xl text-sm font-semibold"
      >
        {isSigningUp ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Submitting…
          </>
        ) : (
          "Sign Up"
        )}
      </Button>
    </form>
  );

  /* Success state for the pending-approval sign-up flow (behaviour unchanged). */
  const successPanel = (
    <div className="space-y-4 text-center" role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10">
        <CheckCircle2 className="h-7 w-7 text-emerald-300" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-semibold text-white">Request submitted</h2>
      <p className="text-sm leading-relaxed text-white/60">
        {otpVerified
          ? "Your email is confirmed. Your sign-up request is pending admin approval. You'll be able to log in once an administrator confirms it (website access only)."
          : "Your sign-up request is pending admin approval. You'll be able to log in once an administrator confirms it (website access only)."}
      </p>
      <Button
        type="button"
        onClick={() => {
          setSubmitted(false);
          setOtpStep(false);
          setOtpVerified(false);
          setSignupValues(EMPTY_SIGNUP);
          setSignupErrors({});
          switchTo("login");
        }}
        className="auth-submit h-11 w-full rounded-xl text-sm font-semibold"
      >
        Back to login
      </Button>
    </div>
  );

  /* OTP email-verification step — sits between the sign-up form and the
     pending-approval screen. Only reached when the user supplied an email. */
  const otpPanel = (
    <div className="flex justify-center py-1">
      <OtpVerification
        length={4}
        toLabel={otpTo}
        title="Verify your email"
        subtitle={
          otpTo
            ? `We sent a 4-digit code to ${otpTo}. It auto-verifies once entered.`
            : "We sent a 4-digit code to your email. It auto-verifies once entered."
        }
        onVerify={handleOtpVerify}
        onResend={handleOtpResend}
        resendCooldownSeconds={30}
      />
    </div>
  );

  /* Login 2FA step — shown after a correct password when the account has an
     email on file. Required second factor before the session is created. */
  const loginOtpPanel = (
    <div className="flex justify-center py-1">
      <OtpVerification
        length={4}
        toLabel={loginOtpTo}
        title="Verify it's you"
        subtitle={
          loginOtpTo
            ? `Enter the 4-digit code we sent to ${loginOtpTo}.`
            : "Enter the 4-digit code we emailed you."
        }
        onVerify={handleLoginOtpVerify}
        onResend={handleLoginOtpResend}
        resendCooldownSeconds={30}
      />
    </div>
  );

  const formContent = submitted
    ? successPanel
    : loginOtpStep
      ? loginOtpPanel
      : otpStep
        ? otpPanel
        : isLogin
          ? loginPanel
          : signupPanel;

  const formHeader = submitted || otpStep || loginOtpStep ? null : (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        {isLogin ? "Sign in" : "Create an account"}
      </h1>
      <p className="text-sm text-white/50">
        {isLogin
          ? "Access your research workspace and patient records."
          : "Request access — an administrator will review it."}
      </p>
    </div>
  );

  /* Welcome panel content, shared by the desktop side panel and the mobile
     header strip. */
  const welcomeContent = (
    <>
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur">
        <ShieldCheck className="h-5 w-5 text-white" aria-hidden="true" />
      </span>
      <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-white/60">
        MedResearch
      </p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-white lg:text-4xl">
        {copy.title}
      </h2>
      <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-white/70">{copy.body}</p>
      <p className="mt-7 text-sm text-white/70">{copy.prompt}</p>
      <Button
        type="button"
        onClick={() => switchTo(isLogin ? "signup" : "login")}
        disabled={busy}
        className="auth-ghost mt-2.5 h-10 rounded-xl bg-transparent px-7 text-sm font-semibold uppercase tracking-wider"
      >
        {isLogin ? (
          <>
            {copy.action}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </>
        ) : (
          <>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.action}
          </>
        )}
      </Button>
    </>
  );

  return (
    <main className="auth-shell flex items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
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
          {submitted ? "Sign-up request submitted" : isLogin ? "Login form" : "Sign up form"}
        </p>

        {/* ---------------- Mobile / tablet: stacked layout ---------------- */}
        <div className="auth-card overflow-hidden lg:hidden">
          <div className="auth-welcome px-6 py-8 text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }}
                transition={{ duration: reduceMotion ? 0 : 0.32, ease: EASE_OUT }}
              >
                {welcomeContent}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="px-6 py-7 sm:px-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${mode}-${submitted}`}
                initial={{ opacity: 0, x: reduceMotion ? 0 : isLogin ? -24 : 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduceMotion ? 0 : isLogin ? 24 : -24 }}
                transition={{ duration: reduceMotion ? 0 : 0.34, ease: EASE_OUT }}
              >
                {formHeader}
                {formContent}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ---------------- Desktop: sliding split panels ------------------ */}
        <motion.div
          className="auth-card relative hidden overflow-hidden lg:block"
          animate={{ height: panelHeight ?? undefined }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: EASE_OUT }}
          style={{ minHeight: 460 }}
        >
          {/* Form panel — occupies the right half in login mode */}
          <motion.div
            className="absolute inset-y-0 left-0 z-10 w-1/2"
            animate={{ x: isLogin ? "100%" : "0%" }}
            transition={slide}
          >
            <div
              ref={formRegionRef}
              className="flex h-full flex-col justify-center px-10 py-10 xl:px-14"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${mode}-${submitted}`}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.3,
                    ease: EASE_OUT,
                    delay: reduceMotion ? 0 : 0.16,
                  }}
                >
                  {formHeader}
                  {formContent}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Welcome panel — always slides the opposite way */}
          <motion.div
            className="auth-welcome absolute inset-y-0 left-0 w-1/2 overflow-hidden"
            animate={{ x: isLogin ? "0%" : "100%" }}
            transition={slide}
          >
            <div className="flex h-full flex-col items-center justify-center px-10 py-12 text-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.97 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.3,
                    ease: EASE_OUT,
                    delay: reduceMotion ? 0 : 0.16,
                  }}
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
