import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { CheckCircle2, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export interface OtpVerificationProps {
  /** Number of digits. Defaults to 4 per the reference; project uses 6. */
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
  length = 4,
  onVerify,
  onResend,
  resendCooldownSeconds = 30,
  toLabel,
  title = "Enter verification code",
  subtitle,
}: OtpVerificationProps) {
  const reduceMotion = useReducedMotion();

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
          setError("Incorrect code. Try again.");
          setDigits(buildBoxes(length));
          inputsRef.current[0]?.focus();
        }
      } catch (err) {
        setStatus("error");
        setError((err as Error)?.message ?? "Verification failed");
        setDigits(buildBoxes(length));
        inputsRef.current[0]?.focus();
      }
    },
    [length],
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
      if (digits[index]) {
        setDigitAt(index, "");
      } else if (index > 0) {
        e.preventDefault();
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
    } catch (err) {
      setError((err as Error)?.message ?? "Could not resend code");
    }
  };

  const isBusy = status === "verifying";

  /* ---- Animations ---- */
  const pulse = reduceMotion
    ? {}
    : { scale: [1, 1.05, 1] };
  const pulseTransition = reduceMotion
    ? undefined
    : { repeat: Infinity, duration: 2, ease: "easeInOut" } as const;

  const boxEntrance = (i: number): HTMLMotionProps<"input"> =>
    reduceMotion
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: i * 0.03 } }
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: i * 0.06, duration: 0.3, ease: "easeOut" },
        };

  return (
    <div className="relative w-full max-w-sm">
      {/* Rotating rainbow-glow frame ring (decorative) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[2px] rounded-[1.75rem] p-px"
        style={{
          background: reduceMotion
            ? "conic-gradient(from 0deg, #f59e0b, #ec4899, #22d3ee, #f59e0b)"
            : undefined,
        }}
      >
        {!reduceMotion && (
          <motion.div
            className="h-full w-full rounded-[1.75rem]"
            style={{
              background:
                "conic-gradient(from 0deg, #f59e0b, #ec4899, #22d3ee, #f59e0b)",
            }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
          />
        )}
      </div>

      <div className="relative rounded-[1.6rem] border border-white/10 bg-[#0b0b0f]/90 px-6 py-8 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        {/* Floating envelope icon (left) */}
        <motion.div
          aria-hidden="true"
          className="absolute -left-3 top-10 text-cyan-300/70"
          animate={reduceMotion ? undefined : { y: [0, -6, 0], rotate: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
        >
          <Mail className="h-6 w-6" />
        </motion.div>
        {/* Floating shield icon (top-right) */}
        <motion.div
          aria-hidden="true"
          className="absolute -right-2 top-6 text-emerald-300/80"
          animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
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
            animate={status === "success" && !reduceMotion ? { rotate: [0, -12, 0], scale: [1, 1.08, 1] } : undefined}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {status === "success" ? (
                <motion.div key="check" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                </motion.div>
              ) : (
                <motion.div key="lock" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <Lock className="h-7 w-7" aria-hidden="true" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-white">
          {status === "success" ? "Verified!" : status === "verifying" ? "Verifying code…" : title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-white/50">
          {status === "success"
            ? "Your email is confirmed. An admin will review your request."
            : subtitle ??
              (toLabel
                ? `We sent a ${length}-digit code to ${toLabel}. It auto-verifies once entered.`
                : `We sent a ${length}-digit code. It auto-verifies once entered.`)}
        </p>

        {/* OTP boxes */}
        <div
          className={cn("mt-6 flex justify-center gap-3", status === "error" && !reduceMotion && "animate-none")}
          role="group"
          aria-label={`${length}-digit verification code`}
        >
          <AnimatePresence>
            {digits.map((digit, i) => {
              const focused = document.activeElement === inputsRef.current[i];
              const filled = digit !== "";
              const shake =
                status === "error" && !reduceMotion
                  ? { x: [0, -8, 8, -8, 8, 0] }
                  : undefined;
              return (
                <motion.input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  disabled={isBusy || status === "success"}
                  value={digit}
                  aria-label={`Digit ${i + 1} of ${length} verification code`}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  onFocus={() => {
                    setDigits((d) => (d[i] ? d : d));
                  }}
                  className={cn(
                    "h-14 w-12 rounded-xl border bg-[#16161c] text-center text-2xl font-bold text-white caret-emerald-400 outline-none transition-all",
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
                  {...(shake
                    ? {
                        animate: { ...shake },
                        transition: { duration: 0.4 },
                        onAnimationComplete: () => {},
                      }
                    : {})}
                />
              );
            })}
          </AnimatePresence>
        </div>

        {/* Verifying pill */}
        <AnimatePresence>
          {isBusy && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-1.5 text-sm font-medium text-amber-200"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Verifying…
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error / resend-confirmation text */}
        <div className="mt-4 min-h-[1.25rem]" aria-live="assertive">
          {error && (
            <p className="text-sm text-rose-300" role="alert">
              {error}
            </p>
          )}
          {!error && resent && (
            <p className="text-sm text-emerald-300">A new code has been sent.</p>
          )}
        </div>

        {/* Resend */}
        <div className="mt-2 text-sm text-white/50">
          Didn&apos;t receive the code?{" "}
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
            {cooldown > 0 ? `Resend in 0:${String(cooldown).padStart(2, "0")}` : "Resend"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OtpVerification;
