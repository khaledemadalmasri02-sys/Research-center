/**
 * "Use a recovery code instead" — Task 2.
 *
 * ===========================================================================
 * WHERE THIS MOUNTS  (auth.tsx is owned by another agent — do not edit here)
 * ===========================================================================
 * The recovery affordance belongs to the LOGIN 2FA step, not to the MFA setup
 * page: it is what a user reaches when they have lost their authenticator, and
 * by then they are sitting in `AuthPage` staring at `<OtpVerification>`, not on
 * the settings page. `auth.tsx:693` builds `loginOtpPanel` — the component that
 * already renders the login OTP step — and that is where the "use a recovery
 * code instead" button belongs, immediately BELOW the `<OtpVerification>` inside
 * `loginOtpPanel`:
 *
 *     const loginOtpPanel = (
 *       <div className="flex w-full justify-center py-1">
 *         <OtpVerification ... />
 *         <RecoveryCodeEntry
 *           onRedeem={handleRedeemRecoveryCode}
 *           onCancel={() => setUseRecovery(false)}
 *           username={loginValues.username}
 *           loginToken={loginOtpToken}
 *           variant="inline"
 *         />
 *       </div>
 *     );
 *
 * Wire the `onRedeem` prop to the new `useAuth()` mutation that calls
 * `POST /api/auth/mfa/recovery/verify` (see `redeemRecoveryCode` in `./api` for
 * the assumed contract), and invalidate `["auth-me"]` on success exactly as
 * `verifyLoginOtp` does — the session is established by the server, so the auth
 * gate in `App.tsx` will flip and unmount this screen.
 *
 * Props are all optional except `onRedeem`, so the component is also usable from
 * a "locked out" screen that has no username to hand.
 *
 * ===========================================================================
 * SINGLE USE IS ENFORCED HERE, NOT ONLY SERVER-SIDE
 * ===========================================================================
 * A recovery code is valid exactly once. Once the server accepts one the account
 * is signed in and this component unmounts — but the failure mode we must design
 * against is the *user* pressing submit again on a code the server already
 * burned. So:
 *
 *   - On any server response (accepted OR refused) the submitted string is
 *     recorded in `spent` and can never be submitted again from this component.
 *     A typo is recoverable — the user just types the corrected code, which is a
 *     different string — but a code that has already been refused is not worth
 *     re-sending, and re-sending it is indistinguishable from a guess.
 *   - On acceptance the form is replaced by a terminal panel. There is no
 *     success animation, no green tick and no "try another code": the only
 *     action is to wait for the session to be established.
 *   - On `AUTH_RATE_LIMITED` the input locks for the server's `retryAfterSec`.
 *
 * Note the deliberate asymmetry: the failure path clears the field and keeps the
 * error on screen with `role="alert"`. Nothing in this component can render as
 * success for a rejected code.
 */
import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DURATION, EASE_OUT, slideUp, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AuthErrorBanner, RateLimitNotice, useCountdown } from "./feedback";
import { isAuthApiError, presentAuthError, type AuthErrorPresentation } from "./errors";

/**
 * Normalise a recovery code for comparison and submission.
 *
 * Recovery codes are conventionally `XXXXX-XXXXX` base32-ish. Users paste them
 * with spaces, lowercase, or no separator at all. Normalising on the way in
 * means the user cannot fail for a formatting reason, and it gives us a stable
 * identity for the `spent` set.
 */
export function normaliseRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Render as `XXXXX-XXXXX` while typing. Falls back to the raw value if short. */
export function formatRecoveryCode(raw: string): string {
  const clean = normaliseRecoveryCode(raw);
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 10)}`;
}

export interface RecoveryCodeEntryProps {
  /**
   * Redeem ONE code. Must resolve when the server accepts it and reject
   * otherwise — including for `AUTH_RECOVERY_INVALID`, `AUTH_RATE_LIMITED` and
   * dead-session errors. The component maps the rejection onto its banner; do
   * not swallow it.
   */
  onRedeem: (code: string) => Promise<void>;
  /**
   * Called when the user backs out. Omit to render no cancel affordance (e.g.
   * when this is the only path available on a locked-out screen).
   */
  onCancel?: () => void;
  /** Forwarded to the redemption call when the endpoint needs them. */
  username?: string | null;
  loginToken?: string | null;
  /** `inline` sits under the OTP box; `panel` is a standalone card. */
  variant?: "inline" | "panel";
  /** Collapsed to just the trigger button until asked for. */
  collapsedByDefault?: boolean;
  disabled?: boolean;
  /** i18n key overrides for hosts that want different framing. */
  labels?: Partial<{
    trigger: string;
    title: string;
    description: string;
    fieldLabel: string;
    submit: string;
    cancel: string;
    acceptedTitle: string;
    acceptedBody: string;
  }>;
}

type Status = "idle" | "submitting" | "accepted";

export function RecoveryCodeEntry({
  onRedeem,
  onCancel,
  variant = "panel",
  collapsedByDefault = true,
  disabled = false,
  labels,
}: RecoveryCodeEntryProps) {
  const { t } = useTranslation();
  const reduced = useMotionPrefs().reducedMotion;

  const [open, setOpen] = useState(!collapsedByDefault);
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<AuthErrorPresentation | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  /**
   * Every string that has already been sent to the server, accepted or not.
   * A `Set` in a ref, not state: re-rendering on this is pointless and would
   * fight the input's own value state.
   */
  const spent = useRef<Set<string>>(new Set());

  const remaining = useCountdown(retryAfter, () => {
    setRetryAfter(null);
    setError(null);
  });
  const rateLimited = remaining > 0;

  const code = normaliseRecoveryCode(raw);
  const alreadySpent = spent.current.has(code);
  const canSubmit =
    code.length >= 6 && !alreadySpent && status !== "submitting" && status !== "accepted" && !rateLimited;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    // Claim the code BEFORE awaiting. If the promise resolves after the user
    // navigated away, this still prevents a second submission on return.
    spent.current.add(code);
    setStatus("submitting");
    setError(null);
    setRetryAfter(null);
    try {
      await onRedeem(code);
      setStatus("accepted");
      // Deliberately no success animation, tick, or colour change: the only
      // thing that happens is a plain status panel telling the user to wait.
    } catch (e) {
      setStatus("idle");
      if (isAuthApiError(e) && e.code === "AUTH_RATE_LIMITED" && e.retryAfterSec != null) {
        setRetryAfter(e.retryAfterSec);
      } else {
        setError(presentAuthError(e));
      }
      setRaw("");
    }
  }, [canSubmit, code, onRedeem]);

  /* Terminal state — the code was accepted. No way back into the form. */
  if (status === "accepted") {
    return (
      <motion.div
        variants={slideUp}
        initial={reduced ? false : "hidden"}
        animate="show"
        role="status"
        aria-live="polite"
        data-testid="mfa-recovery-accepted"
        className={cn(
          "space-y-2 rounded-lg border p-4 text-sm",
          variant === "panel" && "w-full max-w-sm",
        )}
      >
        <p className="font-semibold">
          {t(labels?.acceptedTitle ?? "mfa.recoveryEntry.acceptedTitle", "Recovery code accepted")}
        </p>
        <p className="text-muted-foreground">
          {t(
            labels?.acceptedBody ?? "mfa.recoveryEntry.acceptedBody",
            "Signing you in. This code cannot be used again.",
          )}
        </p>
      </motion.div>
    );
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      disabled={disabled || status === "submitting"}
      aria-expanded={open}
      aria-controls="mfa-recovery-code-form"
      data-testid="mfa-recovery-trigger"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-4"
    >
      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
      {t(labels?.trigger ?? "mfa.recoveryEntry.trigger", "Use a recovery code instead")}
    </button>
  );

  if (!open) {
    return (
      <div className={cn("text-center", variant === "inline" && "mt-3")} data-testid="mfa-recovery-entry">
        {trigger}
      </div>
    );
  }

  return (
    <div
      data-testid="mfa-recovery-entry"
      className={cn("space-y-3", variant === "panel" && "w-full max-w-sm rounded-lg border p-4")}
    >
      {variant === "panel" && (
        <div className="space-y-1">
          {/*
            `h2`, not `h3`. Mounted inside `auth.tsx`'s login panel the nearest
            ancestor heading is the page `h1`, and a skipped level is an
            `heading-order` violation — so the component claims the level
            directly below the page title.
          */}
          <h2 className="text-base font-semibold tracking-tight">
            {t(labels?.title ?? "mfa.recoveryEntry.title", "Sign in with a recovery code")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              labels?.description ??
                "mfa.recoveryEntry.description",
              "Use one of the recovery codes you saved when you set up two-factor authentication. Each code works once.",
            )}
          </p>
        </div>
      )}

      {rateLimited && <RateLimitNotice remaining={remaining} />}

      <AuthErrorBanner error={error} />

      <form
        id="mfa-recovery-code-form"
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="mfa-recovery-code">{t(labels?.fieldLabel ?? "mfa.recoveryEntry.fieldLabel", "Recovery code")}</Label>
          <Input
            id="mfa-recovery-code"
            data-testid="mfa-recovery-code"
            name="recoveryCode"
            /* `one-time-code` would offer SMS autofill, which is wrong here: a
               recovery code is not an SMS. `off` keeps it out of the way. */
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            inputMode="text"
            value={raw}
            disabled={status === "submitting" || rateLimited}
            placeholder="XXXXX-XXXXX"
            aria-describedby="mfa-recovery-code-hint"
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setRaw(formatRecoveryCode(e.target.value))}
          />
          <p id="mfa-recovery-code-hint" className="text-xs text-muted-foreground">
            {t(
              "mfa.recoveryEntry.hint",
              "Letters and digits only. Spacing and case do not matter.",
            )}
          </p>
        </div>

        {alreadySpent && code.length >= 6 && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(
              "mfa.recoveryEntry.alreadyTried",
              "That code was already refused. Check it, or use a different one from your list.",
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canSubmit} data-testid="mfa-recovery-submit">
            {status === "submitting" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t(labels?.submit ?? "mfa.recoveryEntry.submit", "Use this code")}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              disabled={status === "submitting"}
              onClick={onCancel}
              data-testid="mfa-recovery-cancel"
            >
              {t(labels?.cancel ?? "common.cancel", "Cancel")}
            </Button>
          )}
        </div>
      </form>

      {/* Keeps the panel on screen when the host collapses it. */}
      <div className={cn(variant === "inline" && "hidden")}>{trigger}</div>

      {/* `end` transition on the panel so a collapse is not a hard cut. */}
      <AnimatePresence>
        {status === "submitting" && (
          <motion.p
            key="pending"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="text-xs text-muted-foreground"
          >
            {t("mfa.recoveryEntry.checking", "Checking your code…")}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export default RecoveryCodeEntry;