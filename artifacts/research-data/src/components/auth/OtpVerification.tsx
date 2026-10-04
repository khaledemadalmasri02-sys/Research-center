import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { CheckCircle2, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSound } from "@/components/sound-provider";
import {
  DURATION,
  EASE_OUT,
  SPRING,
  shouldReduceMotion,
  staggerStartDelay,
  useMotionPrefs,
} from "@/lib/motion";
import { authErrorFromThrown, formatCountdown } from "@/lib/auth-errors";
import { useAuthTranslate } from "@/components/auth/use-translate";

/**
 * Decorative LOOP periods, in seconds.
 *
 * Deliberately not `DURATION` values: those are transition durations, and a
 * gradient ring that spins for 280ms would strobe. These are ambient, carry no
 * information, and are removed entirely under reduced motion / reduced data.
 */
const RING_PERIOD_S = 12;
const ENVELOPE_FLOAT_S = 5;
const SHIELD_FLOAT_S = 4;
const ATTENTION_PULSE_S = 2;

export interface OtpVerificationProps {
  /** Number of digits. Defaults to 6 to match the backend OTP_LENGTH. */
  length?: number;
  /** Resolves true if the code is correct, false otherwise. */
  onVerify: (code: string) => Promise<boolean> | boolean;
  /** Triggered when the user requests a new code. Should send the real email. */
  onResend: () => Promise<void> | void;
  /** Seconds the resend link stays disabled after a send. */
  resendCooldownSeconds?: number;
  /** Masked destination shown under the heading, e.g. "a***@e***". */
  toLabel?: string;
  /** Heading text before the code is submitted. */
  title?: string;
  /** Subtext shown before submission. */
  subtitle?: string;
}

type Status = "idle" | "verifying" | "success" | "error";

function buildBoxes(len: number) {
  return Array.from({ length: len }, () => "");
}

export function OtpVerification({
  length = 6,
  onVerify,
  onResend,
  resendCooldownSeconds = 30,
  toLabel,
  title = "Enter verification code",
  subtitle,
}: OtpVerificationProps) {
  const { t } = useAuthTranslate();
  const reduced = shouldReduceMotion(useMotionPrefs());
  const { play } = useSound();

  const [digits, setDigits] = useState<string[]>(() => buildBoxes(length));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const verifyRef = useRef(onVerify);
  verifyRef.current = onVerify;
  const onResendRef = useRef(onResend);
  onResendRef.current = onResend;

  const code = useMemo(() => digits.join(""), [digits]);
  const allFilled = digits.length === length && digits.every((d) => d !== "");

  /* Auto-focus the first box on mount. */
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  /* Resend cooldown ticker. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const verify = useCallback(
    async (value: string) => {
      setStatus("verifying");
      setError(null);
      try {
        const ok = await verifyRef.current(value);
        if (ok) {
          setStatus("success");
        } else {
          setStatus("error");
          setError(
            t("auth.otpIncorrectCode", "Incorrect code. Try again."),
          );
          setDigits(buildBoxes(length));
          inputsRef.current[0]?.focus();
        }
      } catch (err) {
        setStatus("error");
        // Coded + translated: the resend/verify failure used to surface the
        // backend's English string verbatim, in whatever locale the user was in.
        setError(authErrorFromThrown(err, t).message);
        setDigits(buildBoxes(length));
        inputsRef.current[0]?.focus();
      }
    },
    [length, t],
  );

  /* Auto-verify once the last digit is entered. */
  useEffect(() => {
    if (allFilled && status === "idle") {
      void verify(code);
    }
  }, [allFilled, code, status, verify]);

  const setDigitAt = (index: number, value: string) => {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
  };

  const handleChange = (index: number, raw: string) => {
    if (status === "verifying" || status === "success") return;
    const trimmed = raw.replace(/\D/g, "");
    if (trimmed === "") {
      setDigitAt(index, "");
      return;
    }
    // Keep only the last typed digit for this box (single-char inputs).
    const char = trimmed[trimmed.length - 1];
    setDigitAt(index, char);
    // Reset to idle so a cleared (post-error) or verifying state can auto-submit
    // again once all boxes are filled. The error text stays until the next
    // verify attempt overwrites it, so a failed code remains legible.
    setStatus("idle");
    if (index < length - 1) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      // Always suppress the default. Without this, deleting an empty box also
      // lets the browser move focus backwards *and* the handler moves it
      // forwards, so the caret visibly jumps two boxes left.
      e.preventDefault();
      if (digits[index]) {
        setDigitAt(index, "");
      } else if (index > 0) {
        setDigitAt(index - 1, "");
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  /**
   * Paste the whole code at once.
   *
   * The reason this is worth handling properly: a one-time code is almost
   * always pasted from an email or copied off a screen, and these boxes have
   * `maxLength={1}`. Without an explicit handler the browser either drops
   * everything after the first character or scatters the digits, and the user
   * has to retype six digits one box at a time.
   *
   * Behaviour: non-digits stripped, truncated to `length`, distributed from
   * the FIRST box (a pasted code is a complete code, not a fragment), the
   * remaining boxes cleared, and focus parked on the last filled box so the
   * next keystroke continues from there rather than jumping to box 1.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!text) return;
    const next = buildBoxes(length);
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    setStatus("idle");
    setError(null);
    const focusIdx = Math.min(text.length, length - 1);
    inputsRef.current[focusIdx]?.focus();
  };

  const handleResend = async () => {
    if (cooldown > 0 || status === "verifying") return;
    setResent(false);
    try {
      await onResendRef.current();
      setCooldown(resendCooldownSeconds);
      setResent(true);
      setStatus("idle");
      setError(null);
      setDigits(buildBoxes(length));
      inputsRef.current[0]?.focus();
      play("otp-sent");
    } catch (err) {
      setError(authErrorFromThrown(err, t).message);
      play("error");
    }
  };

  const isBusy = status === "verifying";

  /* ---- Animations ---- */

  /**
   * The failure shake.
   *
   * Transform only, and ONLY ever for a rejection. This is the one place in
   * the auth surface where motion is allowed to be loud, precisely because a
   * rejected code has to fail unmistakably — nothing here may ever read as
   * success for a failure, so it is a short horizontal shake and never a
   * colour-to-green or a scale-up.
   */
  const shake =
    status === "error" && !reduced
      ? { x: [0, -8, 8, -8, 8, 0] as number[], transition: { duration: DURATION.slow } }
      : {};

  const pulse = reduced ? {} : { scale: [1, 1.05, 1] };
  const pulseTransition = reduced
    ? undefined
    : ({ repeat: Infinity, duration: ATTENTION_PULSE_S, ease: "easeInOut" } as const);

  /** Per-box entrance: the delay is clamped by the shared stagger budget. */
  const boxEntrance = (i: number): HTMLMotionProps<"input"> =>
    reduced
      ? { initial: false }
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            delay: staggerStartDelay(i),
            duration: DURATION.base,
            ease: EASE_OUT,
          },
        };

  return (
    <div className="relative w-full max-w-sm sm:max-w-xs md:max-w-sm">
      {/* Rotating rainbow-glow frame ring (decorative) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[2px] rounded-[1.75rem] p-px"
        style={{
          background: reduced
            ? "conic-gradient(from 0deg, #f59e0b, #ec4899, #22d3ee, #f59e0b)"
            : undefined,
        }}
      >
        {!reduced && (
          <motion.div
            className="h-full w-full rounded-[1.75rem]"
            style={{
              background:
                "conic-gradient(from 0deg, #f59e0b, #ec4899, #22d3ee, #f59e0b)",
            }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: RING_PERIOD_S, ease: "linear" }}
          />
        )}
      </div>

      <div className="relative rounded-[1.6rem] border border-white/10 bg-[#0b0b0f]/90 px-6 py-8 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        {/* Floating envelope icon (left) */}
        <motion.div
          aria-hidden="true"
          className="absolute -left-3 top-10 text-cyan-300/70"
          animate={reduced ? undefined : { y: [0, -6, 0], rotate: [0, 6, 0] }}
          transition={{
            repeat: Infinity,
            duration: ENVELOPE_FLOAT_S,
            ease: "easeInOut",
          }}
        >
          <Mail className="h-6 w-6" />
        </motion.div>
        {/* Floating shield icon (top-right) */}
        <motion.div
          aria-hidden="true"
          className="absolute -right-2 top-6 text-emerald-300/80"
          animate={reduced ? undefined : { y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: SHIELD_FLOAT_S, ease: "easeInOut" }}
        >
          <ShieldCheck className="h-6 w-6" />
        </motion.div>

        {/* Animated lock */}
        <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center">
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: "1.5px dashed #f59e0b" }}
            animate={pulse}
            transition={pulseTransition}
          />
          <motion.div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full",
              status === "success"
                ? "bg-emerald-500/15 text-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.5)]"
                : "bg-amber-500/15 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.45)]",
            )}
            animate={
              status === "success" && !reduced
                ? { rotate: [0, -12, 0], scale: [1, 1.08, 1] }
                : undefined
            }
            transition={
              status === "success" && !reduced ? SPRING.snappy : { duration: 0 }
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              {status === "success" ? (
                <motion.div
                  key="check"
                  initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={reduced ? { duration: 0 } : SPRING.snappy}
                >
                  <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                </motion.div>
              ) : (
                <motion.div
                  key="lock"
                  initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={reduced ? { duration: 0 } : SPRING.snappy}
                >
                  <Lock className="h-7 w-7" aria-hidden="true" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-white">
          {status === "success"
            ? t("auth.otpVerified", "Verified!")
            : status === "verifying"
              ? t("auth.otpVerifying", "Verifying code…")
              : title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-center text-sm text-white/50">
          {status === "success"
            ? t(
                "auth.otpVerifiedBody",
                "Your email is confirmed. An admin will review your request.",
              )
            : (subtitle ??
              t(
                "auth.otpSentTo",
                "We sent a {{length}}-digit code to {{to}}. It auto-verifies once entered.",
                { length: String(length), to: toLabel },
              ))}
        </p>

        {/* OTP boxes */}
        <div
          className={cn("mt-6 flex justify-center gap-2 sm:gap-3", status === "error" && !reduced && "animate-none")}
          role="group"
          aria-label={t("auth.otpGroupLabel", "{{length}}-digit verification code", {
            length: String(length),
          })}
        >
          <AnimatePresence>
            {digits.map((digit, i) => {
              const focused = document.activeElement === inputsRef.current[i];
              const filled = digit !== "";
              return (
                <motion.input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  // Only the first box carries the one-time-code hint; that is
                  // what lets a platform autofill the whole code into it.
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  pattern="[0-9]*"
                  disabled={isBusy || status === "success"}
                  value={digit}
                  aria-label={t("auth.otpDigitLabel", "Digit {{index}} of {{length}} verification code", {
                    index: String(i + 1),
                    length: String(length),
                  })}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  className={cn(
                    "h-12 w-10 sm:h-14 sm:w-12 flex-1 max-w-[3.25rem] rounded-xl border bg-[#16161c] text-center text-xl sm:text-2xl font-bold text-white caret-emerald-400 outline-none transition-all",
                    status === "error"
                      ? "border-rose-500/80 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                      : status === "success"
                        ? "border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                        : focused
                          ? "border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.6)] scale-105"
                          : filled
                            ? "border-emerald-400/40 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
                            : "border-white/15",
                  )}
                  {...boxEntrance(i)}
                  {...shake}
                />
              );
            })}
          </AnimatePresence>
        </div>

        {/* Verifying pill */}
        <AnimatePresence>
          {isBusy && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reduced ? 0 : DURATION.fast, ease: EASE_OUT }}
              className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-1.5 text-sm font-medium text-amber-200"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("auth.otpVerifyingShort", "Verifying…")}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error / resend-confirmation text. Reserved height so a rejected
            code does not shove the resend control down the card. */}
        <div className="mt-4 min-h-[1.25rem]" aria-live="assertive">
          {error ? (
            <p className="text-sm text-rose-300" role="alert">
              {error}
            </p>
          ) : !error && resent ? (
            <p className="text-sm text-emerald-300">{t("auth.otpResent", "We sent a new code.")}</p>
          ) : null}
        </div>

        {/* Resend */}
        <div className="mt-2 text-sm text-white/50">
          {t("auth.otpNoCode", "Didn't receive the code?")}{" "}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || isBusy}
            className={cn(
              "font-semibold transition-colors",
              cooldown > 0 || isBusy
                ? "cursor-not-allowed text-white/30"
                : "text-emerald-300 hover:text-emerald-200",
            )}
          >
            {cooldown > 0
              ? t("auth.resendIn", "Resend in {{time}}", {
                  time: formatCountdown(cooldown),
                })
              : t("auth.resend", "Resend")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OtpVerification;
