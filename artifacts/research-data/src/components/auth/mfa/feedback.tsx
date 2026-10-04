/**
 * Rate-limit countdown and the shared "step error" banner.
 *
 * The countdown is the only thing in this flow allowed to decide when to retry.
 * Nothing else polls or backs off, because a retry against a rate-limited
 * endpoint is precisely what the limit exists to stop.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert } from "@/components/ui/alert";
import { DURATION, EASE_OUT, slideUp, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AuthErrorPresentation } from "./errors";

/**
 * Ticks `seconds` down to 0 and calls `onDone` once.
 *
 * Uses an interval rather than N chained timeouts so a re-render or a paused tab
 * cannot desynchronise it, and clamps negatives so a stale timer cannot walk past
 * zero.
 */
export function useCountdown(seconds: number | null, onDone?: () => void) {
  const [remaining, setRemaining] = useState(seconds ?? 0);

  useEffect(() => {
    setRemaining(seconds ?? 0);
  }, [seconds]);

  useEffect(() => {
    if (!seconds || seconds <= 0) return;
    const id = setInterval(() => {
      setRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) onDone?.();
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, onDone]);

  return remaining;
}

/** `95` -> `1:35`. Always `m:ss` so the width does not jump at 60. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Rate-limit notice.
 *
 * Takes the ALREADY-DECREMENTING `remaining` value rather than a total, and
 * does not run a timer of its own. The owner owns the single countdown: two
 * independent intervals counting the same window down would drift, and the
 * number the user reads is the number that decides whether the submit button
 * unlocks. One clock, one source of truth.
 */
export function RateLimitNotice({ remaining, className }: { remaining: number; className?: string }) {
  const { t } = useTranslation();
  const blocked = remaining > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mfa-rate-limit"
      data-remaining-seconds={remaining}
      className={cn(
        "rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm",
        className,
      )}
    >
      <p className="font-medium text-destructive">
        {t("mfa.rateLimited.heading", "Too many attempts — wait before trying again.")}
      </p>
      <p className="text-destructive/90">
        {blocked
          ? t(
              "mfa.rateLimited.countdown",
              "You can try again in {{seconds}}.",
            )
          : t("mfa.rateLimited.ready", "You can try again now.")}
        {blocked && (
          <span className="ms-1 font-mono font-semibold tabular-nums" data-testid="mfa-rate-limit-seconds">
            {formatCountdown(remaining)}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The mapped error banner for a failed step.
 *
 * `severity` drives colour AND icon AND how it is announced:
 *
 *   - `danger`  -> `role="alert"` (assertive). The user must not be able to miss
 *                  a rejected code. This is the "fail loudly" requirement.
 *   - `warning` -> `role="status"` (polite). Recoverable, and the recovery is
 *                  usually visible next to it.
 *   - `info`    -> `role="status"` (polite). Nothing is wrong and nothing
 *                  changed on the account.
 *
 * The server's raw English `error` string is shown under the mapped copy. We
 * cannot translate a string we have no key for, and hiding it would lose the one
 * piece of information that says exactly what the server objected to.
 */
export function AuthErrorBanner({
  error,
  className,
  onRetry,
  retryLabel,
}: {
  error: AuthErrorPresentation | null;
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { t } = useTranslation();
  const reduced = useMotionPrefs().reducedMotion;

  if (!error) return null;

  const Icon =
    error.severity === "info" ? Info : error.severity === "warning" ? AlertTriangle : TriangleAlert;
  const assertive = error.severity === "danger";

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={`${error.code}-${error.titleKey}`}
        variants={slideUp}
        initial={reduced ? false : "hidden"}
        animate="show"
        exit={reduced ? undefined : { opacity: 0 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
        className={className}
      >
        <Alert
          variant={error.severity === "info" ? "default" : "destructive"}
          role={assertive ? "alert" : "status"}
          aria-live={assertive ? "assertive" : "polite"}
          data-testid="mfa-error"
          data-error-code={error.code}
          data-error-severity={error.severity}
        >
          <Icon aria-hidden="true" />
          {/*
            Title and body in ONE div, not two `AlertTitle` /
            `AlertDescription` siblings.

            Two reasons, both load-bearing:
              - `Alert`'s padding rule is `[&>svg+div]:pl-7`, i.e. it expects
                the icon to be followed by a single wrapper div. Two siblings
                means the description never gets the indent.
              - `AlertTitle` renders an `<h5>`. Mounted after the page `<h1>`
                that is a skipped heading level, which axe reports as
                `heading-order`. `src/components/ui/**` is not ours to change,
                so the banner renders its own title at `<p>` level instead.
          */}
          <div className="space-y-1">
            <p className="font-medium leading-none">{t(error.titleKey, error.titleFallback)}</p>
            <div className="text-sm [&_p]:leading-relaxed">
              <p>{t(error.bodyKey, error.bodyFallback)}</p>
              {error.serverMessage && error.serverMessage !== error.titleFallback && (
                <p className="mt-1 font-mono text-xs opacity-80">{error.serverMessage}</p>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 text-xs font-semibold underline underline-offset-2"
                >
                  {retryLabel ?? t("common.retry", "Retry")}
                </button>
              )}
            </div>
          </div>
        </Alert>
      </motion.div>
    </AnimatePresence>
  );
}