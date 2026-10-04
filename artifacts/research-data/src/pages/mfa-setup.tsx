/**
 * Two-factor authentication setup / management.
 *
 * ===========================================================================
 * THE FLOW, AND WHY IT IS A FLOW AND NOT A FORM
 * ===========================================================================
 * Enrolling a TOTP secret is four steps, three of which the server gates on a
 * fresh password re-entry. Presenting it as one form means:
 *
 *   - a single "Save" that silently does three POSTs, so a failure halfway
 *     through leaves the user with a half-registered authenticator and no idea
 *     which half;
 *   - the secret and the recovery codes would exist at the same moment, and the
 *     codes are unrecoverable — so the user gets no chance to read the warning
 *     before they have to act on it;
 *   - nowhere to put a countdown when the server rate-limits, and nowhere to put
 *     "your password is needed again, so we sent you back".
 *
 * So each step is its own screen with an explicit transition, and step
 * transitions are directional: forward enters from the right, back from the
 * left. On a linear wizard direction is the only signal that tells a user
 * whether they advanced or retreated, and getting it wrong is how people
 * re-submit a step they already completed.
 *
 * ===========================================================================
 * WHAT THIS PAGE ASSUMES ABOUT THE BACKEND  (see `../components/auth/mfa/api`)
 * ===========================================================================
 * It may not be deployed. Every call degrades: an absent route becomes
 * `AUTH_ENDPOINT_MISSING`, which renders as an informational "not available on
 * this server yet" that explicitly states nothing was changed on the account.
 * Nothing here can render a broken half-state.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { useToast } from "@/hooks/use-toast";
import { DURATION, EASE_OUT, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  AuthErrorBanner,
  EnrollmentMediaSlot,
  PasswordReauthForm,
  RateLimitNotice,
  RecoveryCodesLeaveGuard,
  RecoveryCodesPanel,
  TotpCodeInput,
  TOTP_LENGTH,
  confirmEnrollment,
  disableMfa,
  fetchMfaStatus,
  isCodeComplete,
  joinCode,
  needsReauth,
  presentAuthError,
  reauthenticate,
  regenerateRecoveryCodes,
  startEnrollment,
  useCountdown,
  type AuthErrorPresentation,
  type EnrollmentSecret,
} from "@/components/auth/mfa";

/* -------------------------------------------------------------------------- */
/* Step machine                                                               */
/* -------------------------------------------------------------------------- */

type Step =
  | "intro"
  | "reauth"
  | "enroll"
  | "verify"
  | "recovery"
  | "done"
  | "disable-reauth"
  | "disable-confirm"
  | "regenerate-reauth";

/** What to do once a successful `POST /api/auth/reauth` comes back. */
type AfterReauth = "enroll" | "confirm" | "disable" | "regenerate";

const WIZARD: Step[] = ["intro", "reauth", "enroll", "verify", "recovery", "done"];

function stepIndex(step: Step): number {
  const i = WIZARD.indexOf(step);
  return i === -1 ? 0 : i;
}

/** Steps shown in the progress rail. The disable/regenerate paths are not in it. */
const RAIL: Array<{ step: Step; labelKey: string; labelFallback: string }> = [
  { step: "intro", labelKey: "mfa.step.intro", labelFallback: "Why" },
  { step: "reauth", labelKey: "mfa.step.reauth", labelFallback: "Confirm" },
  { step: "enroll", labelKey: "mfa.step.enroll", labelFallback: "Add app" },
  { step: "verify", labelKey: "mfa.step.verify", labelFallback: "Verify" },
  { step: "recovery", labelKey: "mfa.step.recovery", labelFallback: "Save codes" },
];

/**
 * Directional step transition.
 *
 * `custom` carries the direction because framer's `custom` is the only value
 * that survives into an exit — reading a variable captured in the exiting
 * element's closure would make "back" animate "forward".
 */
const stepVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir >= 0 ? -18 : 18,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  }),
};

function isDeadSessionCode(code: string): boolean {
  return code === "AUTH_SESSION_REVOKED" || code === "AUTH_SESSION_EXPIRED";
}

const emptyDigits = () => Array.from({ length: TOTP_LENGTH }, () => "");

/* -------------------------------------------------------------------------- */

export default function MfaSetupPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const reduced = useMotionPrefs().reducedMotion;

  const [step, setStep] = useState<Step>("intro");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [afterReauth, setAfterReauth] = useState<AfterReauth>("enroll");
  const [secret, setSecret] = useState<EnrollmentSecret | null>(null);
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [invalidKey, setInvalidKey] = useState(0);
  const [codes, setCodes] = useState<string[]>([]);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [error, setError] = useState<AuthErrorPresentation | null>(null);
  const [rateLimit, setRateLimit] = useState<number | null>(null);
  /**
   * Which chained request is in flight. Tracked separately from the reauth
   * mutation because `runEnroll` / `runConfirm` / `runDisable` / `runRegenerate`
   * are plain async functions: react-query only owns the first leg, and a
   * button that disables on `reauth.isPending` alone would still be live while
   * the second leg runs.
   */
  const [busyAction, setBusyAction] = useState<"enroll" | "confirm" | "disable" | "regenerate" | null>(
    null,
  );
  /**
   * Optimistic truth about whether MFA is on.
   *
   * `GET /api/auth/me` is the authority, but it is not instantaneous and a
   * server that has just been told `AUTH_TOTP_ALREADY_SET` may still be serving
   * a cached `mfaEnabled: false`. Rendering the setup wizard at that moment
   * invites the user to enrol a second authenticator against an account that
   * already has one. So any server response that asserts the state wins
   * immediately, and the refetch is only allowed to agree.
   */
  const [mfaOverride, setMfaOverride] = useState<boolean | null>(null);

  const status = useQuery({
    queryKey: ["mfa-status"],
    queryFn: ({ signal }) => fetchMfaStatus(signal),
    retry: false,
    staleTime: 30_000,
  });

  /**
   * Single countdown for the whole page. The gate is `rateLimit !== null`, and
   * it is cleared by the timer reaching zero — never by anything the user does,
   * because the only thing that may decide when to retry against a rate-limited
   * endpoint is the server's own `retryAfterSec`.
   */
  const rateRemaining = useCountdown(
    rateLimit,
    useCallback(() => {
      setRateLimit(null);
      setError(null);
    }, []),
  );

  const go = useCallback(
    (next: Step, dir?: 1 | -1) => {
      setDirection(dir ?? (stepIndex(next) >= stepIndex(step) ? 1 : -1));
      setStep(next);
    },
    [step],
  );

  const invalidateStatus = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["mfa-status"] });
    void qc.invalidateQueries({ queryKey: ["auth-me"] });
  }, [qc]);

  /**
   * One place that decides what a thrown value means for the wizard.
   *
   * `reauth` is the intent to resume if the server says the password needs
   * re-entering. It is only passed by callers that are resuming a *specific*
   * action, so a failure on an unrelated call cannot bounce the user to a step
   * that then runs the wrong request.
   */
  const fail = useCallback((e: unknown, resume?: AfterReauth) => {
    const mapped = presentAuthError(e);
    setError(mapped);
    if (mapped.retryAfterSec != null) {
      setRateLimit(mapped.retryAfterSec);
      return;
    }
    if (resume && needsReauth(e)) {
      setAfterReauth(resume);
      setError(null);
      setDirection(-1);
      setStep("reauth");
    }
  }, []);

  /* ---- mutations -------------------------------------------------------- */

  const reauth = useMutation({
    mutationFn: (password: string) => reauthenticate(password),
    onSuccess: () => {
      setError(null);
      setRateLimit(null);
    },
    onError: (e) => setError(presentAuthError(e)),
  });

  const runEnroll = useCallback(async () => {
    setError(null);
    setRateLimit(null);
    setBusyAction("enroll");
    try {
      const data = await startEnrollment();
      setSecret(data);
      setDigits(emptyDigits());
      setDirection(1);
      setStep("enroll");
    } catch (e) {
      const mapped = presentAuthError(e);
      if (mapped.code === "AUTH_TOTP_ALREADY_SET") {
        // The server is authoritative: MFA is on. Show the enabled panel rather
        // than a dead end, and offer the only way forward (turn it off first).
        setMfaOverride(true);
        invalidateStatus();
        setDirection(-1);
        setStep("intro");
        setError(mapped);
        return;
      }
      fail(e, "enroll");
    } finally {
      setBusyAction(null);
    }
  }, [fail, invalidateStatus]);

  const runConfirm = useCallback(
    async (code: string) => {
      setError(null);
      setRateLimit(null);
      setBusyAction("confirm");
      try {
        const recoveryCodes = await confirmEnrollment(code);
        setCodes(recoveryCodes);
        setCodesAcknowledged(false);
        setMfaOverride(true);
        invalidateStatus();
        setDirection(1);
        setStep("recovery");
      } catch (e) {
        const mapped = presentAuthError(e);
        // ALWAYS wipe the boxes on a rejected code. Leaving them filled means
        // the user can press submit again on a code the server already refused,
        // which both burns a rate-limit slot and looks like the form accepted
        // something it did not.
        setDigits(emptyDigits());
        setInvalidKey((k) => k + 1);
        if (mapped.code === "AUTH_TOTP_NOT_CONFIGURED") {
          // The secret was never registered — a discarded or replaced enrolment.
          // Retyping a code against a dead secret would just burn attempts.
          setSecret(null);
          setDirection(-1);
          setStep("intro");
          setError(mapped);
          return;
        }
        if (isDeadSessionCode(mapped.code)) invalidateStatus();
        fail(e, "confirm");
      } finally {
        setBusyAction(null);
      }
    },
    [fail, invalidateStatus],
  );

  const runDisable = useCallback(async () => {
    setError(null);
    setRateLimit(null);
    setBusyAction("disable");
    try {
      await disableMfa();
      setMfaOverride(false);
      invalidateStatus();
      setSecret(null);
      toast({ title: t("mfa.disable.done", "Two-factor authentication is off.") });
      setDirection(-1);
      setStep("intro");
    } catch (e) {
      fail(e, "disable");
    } finally {
      setBusyAction(null);
    }
  }, [fail, invalidateStatus, t, toast]);

  const runRegenerate = useCallback(async () => {
    setError(null);
    setRateLimit(null);
    setBusyAction("regenerate");
    try {
      const next = await regenerateRecoveryCodes();
      setCodes(next);
      setCodesAcknowledged(false);
      setDirection(1);
      setStep("recovery");
    } catch (e) {
      fail(e, "regenerate");
    } finally {
      setBusyAction(null);
    }
  }, [fail]);

  /* ---- the one place password re-entry is wired ------------------------- */

  const submitPassword = useCallback(
    async (password: string, resume: AfterReauth) => {
      try {
        await reauth.mutateAsync(password);
      } catch {
        // `onError` has already surfaced it. Swallowing here keeps the rejection
        // from becoming an unhandled promise in the form's `void onSubmit()`.
        return;
      }
      if (resume === "enroll") await runEnroll();
      else if (resume === "confirm") {
        // Deliberately does NOT re-enrol. Calling `/mfa/enroll` again here would
        // rotate the secret and invalidate the app the user just added, and they
        // would have no way to learn the new one without starting over.
        setDirection(-1);
        setStep("verify");
      } else if (resume === "disable") {
        setDirection(1);
        setStep("disable-confirm");
      } else {
        await runRegenerate();
      }
    },
    [reauth, runEnroll, runRegenerate],
  );

  /* ---- derived ---------------------------------------------------------- */

  const enabled = mfaOverride ?? status.data?.mfaEnabled;
  const statusUnknown = enabled === undefined;
  const codeComplete = isCodeComplete(digits, TOTP_LENGTH);
  const busy = reauth.isPending || busyAction !== null;
  const gated = rateLimit !== null;

  const railStep = useMemo<Step>(() => {
    if (step === "done") return "recovery";
    if (step === "disable-reauth" || step === "disable-confirm" || step === "regenerate-reauth") {
      return "reauth";
    }
    return step;
  }, [step]);

  const onRail = step !== "disable-reauth" && step !== "disable-confirm" && step !== "regenerate-reauth";

  /* ---- render ----------------------------------------------------------- */

  return (
    <Layout>
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
            <h1 className="text-3xl font-bold tracking-tight">
              {t("mfa.title", "Two-factor authentication")}
            </h1>
            {enabled === true && <Badge>{t("mfa.badge.on", "On")}</Badge>}
            {enabled === false && <Badge variant="outline">{t("mfa.badge.off", "Off")}</Badge>}
          </div>
          <p className="text-muted-foreground">
            {t(
              "mfa.subtitle",
              "Require a code from your phone as well as your password.",
            )}
          </p>
        </header>

        {/*
          Step rail. Hidden on the disable / regenerate paths, where a "step 3 of
          5" indicator would be a lie — those flows are one step, not a wizard.
        */}
        {onRail && (
          <nav aria-label={t("mfa.progressLabel", "Setup progress")}>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {RAIL.map((r, i) => {
                const active = railStep === r.step;
                const passed = stepIndex(railStep) > i;
                return (
                  <li key={r.step} className="flex items-center gap-2">
                    <span
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium",
                        active && "bg-primary text-primary-foreground",
                        !active && passed && "text-muted-foreground line-through",
                        !active && !passed && "text-muted-foreground/60",
                      )}
                    >
                      {i + 1}. {t(r.labelKey, r.labelFallback)}
                    </span>
                    {i < RAIL.length - 1 && (
                      <span aria-hidden="true" className="text-muted-foreground">
                        →
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        <AuthErrorBanner error={error} />

        {rateRemaining > 0 && <RateLimitNotice remaining={rateRemaining} />}

        {error && isDeadSessionCode(error.code) && (
          <p className="text-sm">
            <Link href="/" className="font-semibold text-primary underline underline-offset-4">
              {t("mfa.signInAgain", "Sign in again")}
            </Link>
          </p>
        )}

        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial={reduced ? false : "enter"}
            animate="center"
            exit={reduced ? undefined : "exit"}
          >
            {step === "intro" && (
              <IntroStep
                statusLoading={status.isLoading}
                statusError={status.isError}
                statusUnknown={statusUnknown}
                enabled={enabled === true}
                busy={busy}
                onRetryStatus={() => void status.refetch()}
                onStart={() => {
                  setError(null);
                  setRateLimit(null);
                  setAfterReauth("enroll");
                  go("reauth", 1);
                }}
                onDisable={() => {
                  setError(null);
                  setRateLimit(null);
                  setAfterReauth("disable");
                  go("disable-reauth", 1);
                }}
                onRegenerate={() => {
                  setError(null);
                  setRateLimit(null);
                  setAfterReauth("regenerate");
                  go("regenerate-reauth", 1);
                }}
              />
            )}

            {step === "reauth" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t("mfa.reauth.stepTitle", "Step 1 — confirm your password")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PasswordReauthForm
                    onSubmit={(password) => submitPassword(password, afterReauth)}
                    pending={busy}
                    purpose="enroll"
                    onCancel={() => go("intro", -1)}
                  />
                </CardContent>
              </Card>
            )}

            {step === "enroll" && secret && (
              <EnrollStep
                secret={secret}
                busy={busy}
                onBack={() => go("intro", -1)}
                onRestart={runEnroll}
                onContinue={() => {
                  setError(null);
                  go("verify", 1);
                }}
              />
            )}

            {step === "verify" && secret && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t("mfa.verify.title", "Step 3 — confirm it works")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "mfa.verify.body",
                      "Open your authenticator app and enter the 6-digit code it shows for this account.",
                    )}
                  </p>
                  {/*
                    `aria-describedby` must point at an element that EXISTS in
                    every render, including the first one with no error — an
                    IDREF that resolves to nothing is an axe violation, and a
                    conditionally-inserted description is worse than none.
                  */}
                  <p id="mfa-verify-hint" className="sr-only">
                    {t(
                      "mfa.verify.hint",
                      "Six digits. Codes change every 30 seconds; an expired code is refused.",
                    )}
                  </p>
                  <TotpCodeInput
                    value={digits}
                    onChange={(next) => {
                      setDigits(next);
                      if (error) setError(null);
                    }}
                    /* Only a REJECTED code marks the boxes invalid. A rate-limit
                     * warning is about waiting, not about what was typed. */
                    invalid={error?.severity === "danger"}
                    invalidKey={invalidKey}
                    disabled={gated}
                    describedBy="mfa-verify-hint"
                    label={t("mfa.verify.groupLabel", "6-digit authenticator code")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        if (!codeComplete || gated) return;
                        void runConfirm(joinCode(digits, TOTP_LENGTH));
                      }}
                      disabled={!codeComplete || gated}
                      data-testid="mfa-verify-submit"
                    >
                      {t("mfa.verify.submit", "Verify and turn on")}
                    </Button>
                    <Button variant="ghost" onClick={() => go("enroll", -1)}>
                      <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                      {t("mfa.verify.back", "Back to the setup key")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "recovery" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t("mfa.recovery.title", "Step 4 — save your recovery codes")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RecoveryCodesPanel
                    codes={codes}
                    acknowledgeLabel="mfa.recovery.acknowledge"
                    onAcknowledge={() => {
                      setCodesAcknowledged(true);
                      go("done", 1);
                    }}
                  />
                </CardContent>
              </Card>
            )}

            {step === "done" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                    {t("mfa.done.title", "Two-factor authentication is on")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "mfa.done.body",
                      "Signing in now needs your password and a code from your authenticator app.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link href="/sessions">
                        {t("mfa.done.reviewSessions", "Review signed-in devices")}
                      </Link>
                    </Button>
                    <Button variant="outline" onClick={() => go("intro", -1)}>
                      {t("mfa.done.back", "Back to security settings")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "disable-reauth" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t(
                      "mfa.disable.confirmPasswordTitle",
                      "Confirm your password to turn it off",
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PasswordReauthForm
                    onSubmit={(password) => submitPassword(password, "disable")}
                    pending={busy}
                    purpose="disable"
                    onCancel={() => go("intro", -1)}
                  />
                </CardContent>
              </Card>
            )}

            {step === "regenerate-reauth" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {t(
                      "mfa.regenerate.confirmPasswordTitle",
                      "Confirm your password for new recovery codes",
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="flex gap-2 rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t(
                      "mfa.regenerate.warning",
                      "Your existing recovery codes will stop working immediately. Make sure you can still get into your account another way first.",
                    )}
                  </p>
                  <PasswordReauthForm
                    onSubmit={(password) => submitPassword(password, "regenerate")}
                    pending={busy}
                    purpose="regenerate"
                    onCancel={() => go("intro", -1)}
                  />
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>

        {step === "disable-confirm" && (
          <ConfirmDestructive
            open
            onOpenChange={(v) => {
              if (!v) go("intro", -1);
            }}
            title={t("mfa.disable.title", "Turn off two-factor authentication?")}
            description={t(
              "mfa.disable.body",
              "Anyone who has your password will be able to sign in without a code. Your authenticator app stops working immediately and your recovery codes are deleted.",
            )}
            confirmLabel={t("mfa.disable.confirm", "Turn off two-factor authentication")}
            busyLabel={t("mfa.disable.working", "Turning off…")}
            onConfirm={runDisable}
          />
        )}
      </div>

      {/*
        Leaving is blocked for exactly as long as the codes are on screen and
        unacknowledged. Once acknowledged, these props make the guard inert.
      */}
      <RecoveryCodesLeaveGuard
        locked={step === "recovery" && !codesAcknowledged && codes.length > 0}
        title={t("mfa.recovery.guardTitle", "Save your recovery codes first")}
        body={t(
          "mfa.recovery.guardBody",
          "If you leave now these codes are gone for good. Copy or download them, then come back.",
        )}
        stayLabel={t("mfa.recovery.guardStay", "Back to my codes")}
        leaveLabel={t("mfa.recovery.guardLeave", "I've saved them — leave")}
      />
    </Layout>
  );
}

/* -------------------------------------------------------------------------- */
/* Step panels                                                                */
/* -------------------------------------------------------------------------- */

function IntroStep({
  statusLoading,
  statusError,
  statusUnknown,
  enabled,
  busy,
  onRetryStatus,
  onStart,
  onDisable,
  onRegenerate,
}: {
  statusLoading: boolean;
  statusError: boolean;
  statusUnknown: boolean;
  enabled: boolean;
  busy: boolean;
  onRetryStatus: () => void;
  onStart: () => void;
  onDisable: () => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();

  if (statusError) {
    return (
      <ErrorState
        title={t("mfa.status.loadFailedTitle", "Could not check your security settings")}
        description={t(
          "mfa.status.loadFailedBody",
          "We could not confirm whether two-factor authentication is on. Nothing was changed.",
        )}
        action={<Button onClick={onRetryStatus}>{t("common.retry", "Retry")}</Button>}
      />
    );
  }

  if (statusLoading) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">{t("mfa.status.loading", "Checking your security settings…")}</span>
      </div>
    );
  }

  if (enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
            {t("mfa.on.title", "Two-factor authentication is on")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              "mfa.on.body",
              "Signing in needs your password and a 6-digit code from your authenticator app.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onRegenerate} disabled={busy}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("mfa.on.regenerate", "New recovery codes")}
            </Button>
            <Button variant="destructive" onClick={onDisable} disabled={busy}>
              <ShieldOff className="h-4 w-4" aria-hidden="true" />
              {t("mfa.on.disable", "Turn off two-factor authentication")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("mfa.intro.title", "Add a second factor")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusUnknown && (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
            data-testid="mfa-status-unknown"
          >
            {t(
              "mfa.intro.statusUnknown",
              "This server did not tell us whether two-factor authentication is already on. You can continue — if it is already on we will tell you before anything changes.",
            )}
          </p>
        )}

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            {t(
              "mfa.intro.p1",
              "Your password is the first factor. Two-factor authentication adds a second, independent proof: a 6-digit code that changes every 30 seconds and exists only on one device — your phone.",
            )}
          </p>
          <p>
            {t(
              "mfa.intro.p2",
              "If someone gets your password — reused from another site, phished, or guessed on a shared workstation — they still cannot sign in without your phone.",
            )}
          </p>
          <p>
            {t(
              "mfa.intro.p3",
              "You will need an authenticator app. If you do not have one, install one from your phone's app store before you start.",
            )}
          </p>
        </div>

        <p className="rounded-md border p-3 text-sm">
          <strong className="font-semibold">{t("mfa.intro.headsUp", "Before you start:")}</strong>{" "}
          {t(
            "mfa.intro.headsUpBody",
            "at the end you will be shown recovery codes exactly once. They are your only way back in if you lose your phone, and they cannot be shown again.",
          )}
        </p>

        <Button onClick={onStart} disabled={busy} data-testid="mfa-intro-start">
          {t("mfa.intro.start", "Set up two-factor authentication")}
        </Button>
      </CardContent>
    </Card>
  );
}

function EnrollStep({
  secret,
  busy,
  onBack,
  onRestart,
  onContinue,
}: {
  secret: EnrollmentSecret;
  busy: boolean;
  onBack: () => void;
  onRestart: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {t("mfa.enroll.title", "Step 2 — add your authenticator app")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "mfa.enroll.body",
            "Link this account to your authenticator app using the setup key below.",
          )}
        </p>

        <EnrollmentMediaSlot secret={secret.secret} otpauthUri={secret.otpauthUri} />

        <div className="flex flex-wrap gap-2">
          <Button onClick={onContinue} disabled={busy} data-testid="mfa-enroll-continue">
            {t("mfa.enroll.continue", "I've added it — continue")}
          </Button>
          <Button variant="outline" onClick={onRestart} disabled={busy} data-testid="mfa-enroll-restart">
            {t("mfa.enroll.restart", "Generate a different key")}
          </Button>
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t("common.cancel", "Cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}