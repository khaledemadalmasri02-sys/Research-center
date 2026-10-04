/**
 * Six-box TOTP entry.
 *
 * This is deliberately NOT the existing `OtpVerification` component. That one
 * auto-submits on the sixth digit, owns a resend cooldown, and renders a
 * "Verified!" success state — none of which fit enrolment, where:
 *
 *   - auto-submit on the sixth digit would fire an `AUTH_MFA_INVALID` the
 *     instant a user types a wrong digit into the wrong box;
 *   - there is nothing to resend (the secret does not change);
 *   - its success state replaces the form, and reusing it here would put a
 *     celebratory green panel on the screen for a code the server may yet
 *     reject.
 *
 * On failure this component does the opposite of celebrating: it clears the
 * boxes, focuses the first one, marks the group invalid, and leaves the error
 * text in place with `role="alert"`. Nothing here can be mistaken for success —
 * there is no success state at all, because success is a *server* fact.
 */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

import { DURATION, EASE_OUT, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const TOTP_LENGTH = 6;

export interface TotpCodeInputProps {
  /** Array of `length` single characters, `""` for empty. */
  value: string[];
  onChange: (next: string[]) => void;
  length?: number;
  disabled?: boolean;
  /** Renders the destructive border + shake. Set from a *failed* submit only. */
  invalid?: boolean;
  /** Bumped on each failure to re-trigger the shake. */
  invalidKey?: number;
  /** Accessible name for the group. */
  label?: string;
  describedBy?: string;
  autoFocus?: boolean;
}

function emptyBoxes(length: number): string[] {
  return Array.from({ length }, () => "");
}

export function TotpCodeInput({
  value,
  onChange,
  length = TOTP_LENGTH,
  disabled = false,
  invalid = false,
  invalidKey = 0,
  label = "6-digit authenticator code",
  describedBy,
  autoFocus = true,
}: TotpCodeInputProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const reduced = useMotionPrefs().reducedMotion;

  // Re-focus the first box after a failure so the user can retype immediately.
  useEffect(() => {
    if (invalidKey > 0) inputs.current[0]?.focus();
  }, [invalidKey]);

  useEffect(() => {
    if (autoFocus && !disabled) inputs.current[0]?.focus();
    // Intentionally mount-only: re-focusing on every value change would fight
    // the user's own arrow-key navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAt = (index: number, char: string) => {
    const next = [...value];
    while (next.length < length) next.push("");
    next[index] = char;
    onChange(next);
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits === "") {
      setAt(index, "");
      return;
    }
    // A paste into any box lands here with several digits; distribute them.
    if (digits.length > 1) {
      const next = emptyBoxes(length);
      for (let i = 0; i < Math.min(digits.length, length - index); i++) {
        next[index + i] = digits[i];
      }
      onChange(next);
      inputs.current[Math.min(index + digits.length, length - 1)]?.focus();
      return;
    }
    setAt(index, digits[digits.length - 1]);
    if (index < length - 1) inputs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (value[index]) setAt(index, "");
      else if (index > 0) {
        e.preventDefault();
        setAt(index - 1, "");
        inputs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!digits) return;
    const next = emptyBoxes(length);
    for (let i = 0; i < digits.length; i++) next[i] = digits[i];
    onChange(next);
    inputs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className="flex items-center gap-2"
      data-invalid={invalid ? "true" : undefined}
    >
      {value.slice(0, length).map((digit, i) => (
        <motion.input
          /*
           * `invalidKey` is in the key on purpose. Re-triggering a framer
           * keyframe array on an element that is already at `x: 0` does not
           * replay it — the target has not changed, so the animation is a
           * no-op and the "fail loudly" requirement silently stops working after
           * the first rejection. Remounting replays it every time. The lost
           * focus is restored by the `invalidKey` effect above.
           */
          key={invalid ? `${i}-${invalidKey}` : i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          /* The browser's SMS one-time-code autofill only fires on the first
             box; the rest must be "off" or every keystroke re-fills box 0. */
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          disabled={disabled}
          value={digit}
          aria-label={`Digit ${i + 1} of ${length}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={cn(
            "h-12 w-11 rounded-md border bg-background text-center font-mono text-lg font-semibold text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-destructive" : "border-input",
          )}
          animate={
            invalid && !reduced
              ? { x: [0, -6, 6, -4, 4, 0] }
              : { x: 0 }
          }
          transition={{ duration: invalid && !reduced ? DURATION.slow : DURATION.instant, ease: EASE_OUT }}
        />
      ))}
    </div>
  );
}

/** `["1","2",""] -> false`. All boxes must be filled. */
export function isCodeComplete(value: string[], length = TOTP_LENGTH): boolean {
  return value.length >= length && value.slice(0, length).every((d) => d !== "");
}

/** Join into the wire format, stripping the padding. */
export function joinCode(value: string[], length = TOTP_LENGTH): string {
  return value.slice(0, length).join("");
}