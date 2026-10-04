import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  scorePassword,
  type PasswordStrength,
} from "@/components/ui/password-input";
import { SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PASSWORD_RULES } from "@/components/auth/password-rules";
import { useCapsLock } from "@/components/auth/use-caps-lock";
import { useAuthTranslate } from "@/components/auth/use-translate";

/**
 * ============================================================================
 * SHARED AUTH FIELD PRIMITIVES
 * ============================================================================
 *
 * Extracted out of `src/pages/auth.tsx` because the password-recovery screens
 * need exactly the same affordances as login/sign-up, and a second
 * hand-rolled password field is how you end up with two different a11y
 * stories on the same screen.
 *
 * The a11y contract every field here keeps, and which must not regress:
 *  - `useId()` for the control, `<Label htmlFor>` pointing at it.
 *  - `aria-invalid` only when invalid, and `aria-describedby` pointing at the
 *    ids of the hint / error / status text that is actually rendered.
 *  - A RESERVED-HEIGHT error slot (`min-h-4`) that is always mounted, so a
 *    validation message never reflows the form. This is why the slot is a
 *    plain `<p>` and not an animated element: animating its height would
 *    reintroduce exactly the layout shift the reservation exists to prevent.
 */

/** Reserved-height inline field error, so validation never shifts the layout. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p id={id} className="min-h-4 text-xs text-rose-300">
      {message ?? ""}
    </p>
  );
}

export interface FieldProps extends Omit<ComponentProps<"input">, "id"> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Rendered inside the label row on the trailing edge (e.g. a link). */
  trailing?: ReactNode;
}

/** Labelled text input wired up for a11y (label, describedby, aria-invalid). */
export function Field({
  label,
  hint,
  error,
  required,
  trailing,
  className,
  ...props
}: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs font-medium text-white/70">
          {label}
          {required && (
            <span className="ms-0.5 text-rose-400" aria-hidden="true">
              *
            </span>
          )}
        </Label>
        {hint ? (
          <span id={hintId} className="text-xs text-white/70">
            {hint}
          </span>
        ) : (
          trailing
        )}
      </div>
      <Input
        id={inputId}
        className={cn(
          "auth-field h-11 rounded-xl px-3.5 text-sm shadow-none",
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        {...props}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Password field                                                              */
/* -------------------------------------------------------------------------- */

const STRENGTH_SCORE: Record<PasswordStrength, number> = {
  empty: 0,
  weak: 1,
  fair: 2,
  good: 3,
  strong: 4,
};

const STRENGTH_COLOR: Record<PasswordStrength, string> = {
  empty: "bg-white/15",
  weak: "bg-rose-500",
  fair: "bg-amber-500",
  good: "bg-emerald-500",
  strong: "bg-emerald-400",
};

export interface AuthPasswordFieldProps extends FieldProps {
  /** Password managers key off `autoComplete`; never send a bare `password`. */
  autoComplete: "current-password" | "new-password";
  /** Render the 4-segment strength meter (announced via `role="status"`). */
  showStrength?: boolean;
  /** Render the live server-rule checklist. */
  showRules?: boolean;
}

/**
 * Password input with a visibility toggle, an optional strength meter, an
 * optional live rule checklist, and a non-blocking caps-lock warning.
 *
 * Every one of those status regions has a RESERVED slot, for the same reason
 * the error slot does: a meter that appears once the first character is typed
 * pushes the submit button down, and the user clicks the wrong thing.
 */
export function AuthPasswordField({
  label,
  hint,
  error,
  required,
  showStrength = false,
  showRules = false,
  className,
  ...props
}: AuthPasswordFieldProps) {
  const { t } = useAuthTranslate();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const capsId = `${inputId}-caps`;
  const strengthId = `${inputId}-strength`;
  const rulesId = `${inputId}-rules`;
  const [visible, setVisible] = useState(false);
  const caps = useCapsLock();
  const reduced = shouldReduceMotion(useMotionPrefs());

  const strength = scorePassword(String(props.value ?? ""));
  const score = STRENGTH_SCORE[strength];

  const describedBy = [
    error ? errorId : null,
    hint ? hintId : null,
    capsId,
    showStrength ? strengthId : null,
    showRules ? rulesId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs font-medium text-white/70">
          {label}
          {required && (
            <span className="ms-0.5 text-rose-400" aria-hidden="true">
              *
            </span>
          )}
        </Label>
        {hint ? (
          <span id={hintId} className="text-xs text-white/70">
            {hint}
          </span>
        ) : null}
      </div>

      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          className={cn(
            "auth-field h-11 rounded-xl ps-3.5 pe-11 text-sm shadow-none",
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onKeyDown={caps.onKeyDown}
          onKeyUp={caps.onKeyUp}
          onFocus={caps.onFocus}
          onBlur={caps.onBlur}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={props.disabled}
          aria-label={
            visible
              ? t("auth.hidePassword", "Hide password")
              : t("auth.showPassword", "Show password")
          }
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-white/75 transition-colors hover:text-white disabled:opacity-40"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Reserved slot: the caps-lock warning appears and disappears without
          moving anything, and it is advisory — the input stays typeable. */}
      <p id={capsId} className="min-h-4 text-xs text-amber-300">
        {caps.capsLockOn
          ? t("auth.capsLockOn", "Caps Lock is on. Your password may be wrong.")
          : ""}
      </p>

      <FieldError id={errorId} message={error} />

      {showStrength ? (
        <div
          id={strengthId}
          className="space-y-1"
          // `role="status"`: the strength changes on every keystroke, and this
          // is the one polite live region on the field. Polite, not assertive —
          // it must never interrupt the caps-lock warning or a server error.
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div
            className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/10"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={score}
            // `aria-label`, not `aria-labelledby`: the visible strength text
            // below is EMPTY until the user types anything, and a meter whose
            // only name comes from an empty element has no accessible name at
            // all (`aria-meter-name`, caught by axe). The label here is always
            // present regardless of what the field contains.
            aria-label={t("auth.strengthLabel", "Password strength")}
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                // Colour only, via the CSS `transition-colors` on the parent.
                // Animating width or transform here would reflow the form on
                // every keystroke, which is exactly what the auth panel's
                // reserved-height slots exist to prevent.
                className={cn(
                  "h-full flex-1 transition-colors",
                  i < score ? STRENGTH_COLOR[strength] : "bg-white/10",
                )}
              />
            ))}
          </div>
          {/* Reserved so the meter never appears/disappears as it goes 0 -> 4. */}
          <p className="min-h-4 text-xs text-white/70">
            {score > 0
              ? t("auth.strengthLabel", "Strength: {{level}}", {
                  level: t(`auth.strength.${strength}`,
                    strength === "strong"
                      ? "Strong"
                      : strength === "good"
                        ? "Good"
                        : strength === "fair"
                          ? "Fair"
                          : "Weak",
                  ),
                })
              : ""}
          </p>
        </div>
      ) : null}

      {showRules ? (
        <ul
          id={rulesId}
          className="space-y-0.5 pt-0.5"
          aria-label={t("auth.passwordRulesLabel", "Password requirements")}
        >
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(String(props.value ?? ""));
            return (
              <li
                key={rule.id}
                data-rule={rule.id}
                data-met={met ? "true" : "false"}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  met ? "text-emerald-300" : "text-white/60",
                )}
              >
                {met ? (
                  <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <span>{t(rule.key, rule.fallback)}</span>
                {/* Colour alone would hide the state from a screen reader. */}
                <span className="sr-only">
                  {" — "}
                  {met
                    ? t("auth.ruleMet", "met")
                    : t("auth.ruleNotMet", "not met yet")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Submit button                                                               */
/* -------------------------------------------------------------------------- */

export interface AuthSubmitProps extends ComponentProps<typeof Button> {
  /** A request is in flight: the button is disabled and shows progress. */
  busy?: boolean;
  /** Label while `busy`. Progress lives ON the button, never in a separate spinner. */
  busyLabel?: string;
  /** The request succeeded: the button stays put and confirms in place. */
  succeeded?: boolean;
  successLabel?: string;
}

/**
 * The one submit control for all four auth modes.
 *
 * TWO REASONS IT EXISTS:
 *
 *  1. **Submit -> success continuity.** The common failure of this flow is a
 *     spinner that vanishes and is replaced by a card somewhere else on
 *     screen, so the user's eye has to find a new target and the connection
 *     between "it worked" and "the thing I pressed" is lost. Here the button
 *     never moves: it goes busy, then confirms *in the same box* with a check
 *     that springs in. Only the surrounding copy cross-fades.
 *
 *  2. **Never a success signal for a failure.** `succeeded` is only ever set
 *     from a confirmed 2xx. Nothing about the busy state or the press state
 *     is green, and `play("error")`-style feedback is the caller's job. A
 *     rejected request leaves the button in its idle geometry with the
 *     failure banner announced above it.
 */
export function AuthSubmit({
  busy = false,
  busyLabel,
  succeeded = false,
  successLabel,
  children,
  className,
  disabled,
  ...props
}: AuthSubmitProps) {
  const reduced = shouldReduceMotion(useMotionPrefs());

  const isDisabled = Boolean(disabled) || busy || succeeded;
  const label = busy ? (busyLabel ?? children) : succeeded ? (successLabel ?? children) : children;

  return (
    <Button
      type="submit"
      disabled={isDisabled}
      aria-busy={busy || undefined}
      data-state={succeeded ? "success" : busy ? "busy" : "idle"}
      className={cn(
        "auth-submit h-11 w-full max-w-xs rounded-xl text-sm font-semibold",
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {busy ? (
          // `animate-spin` is neutralised by the global reduced-motion block
          // in index.css, so it needs no JS branch of its own.
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        {succeeded ? (
          <motion.span
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            // A spring is the right tool here: the check is interruptible and
            // the user can click straight through it.
            transition={reduced ? { duration: 0 } : SPRING.snappy}
            className="inline-flex"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </motion.span>
        ) : null}
        <span>{label}</span>
      </span>
    </Button>
  );
}
