/**
 * Clipboard write with a fallback, plus a tiny copy-button component.
 *
 * WHY NOT `navigator.clipboard` DIRECTLY. Two reasons, both real:
 *
 *   1. `navigator.clipboard` is undefined on an insecure origin (any plain-http
 *      deployment) and in jsdom. A copy button that throws there reports
 *      "Copied" over a field the user did not actually copy — which for a TOTP
 *      secret means they type it into their authenticator from a stale read.
 *   2. `writeText` can reject on permission denial even when the API exists.
 *
 * So: try the async API, fall back to a hidden textarea +
 * `document.execCommand("copy")`, and only report success if one of them says
 * so. The caller never sees a fake confirmation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LAYOUT_REDUCED_MOTION, SPRING, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** How long the "Copied" confirmation stays visible. */
export const COPY_FEEDBACK_MS = 2000;

export type CopyResult = { ok: true } | { ok: false; reason: "unsupported" | "denied" };

/** Injectable so tests can assert without a real clipboard. */
export type CopyImpl = (text: string) => Promise<CopyResult>;

export const copyText: CopyImpl = async (text) => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    /* fall through to the legacy path */
  }

  if (typeof document === "undefined") return { ok: false, reason: "unsupported" };

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Off-screen but not `display:none`: a hidden element cannot be selected.
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    ta.select();
    const ok = document.execCommand?.("copy") ?? false;
    document.body.removeChild(ta);
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok ? { ok: true } : { ok: false, reason: "denied" };
  } catch {
    return { ok: false, reason: "denied" };
  }
};

/** Feedback state machine: idle -> copied | failed -> idle. */
export type CopyState = "idle" | "copied" | "failed";

export function useCopy(copyImpl: CopyImpl = copyText) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      const result = await copyImpl(text);
      setState(result.ok ? "copied" : "failed");
      timer.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
      return result;
    },
    [copyImpl],
  );

  return { state, copy };
}

/**
 * A copy button that says so out loud.
 *
 * The confirmation is `aria-live="polite"` rather than a tooltip, because the
 * only thing that matters here is that the user learns the copy happened before
 * they navigate away from the field. The icon swap is on `SPRING.snappy` so it
 * reads as a physical acknowledgement; under reduced motion it swaps instantly.
 */
export function CopyButton({
  value,
  label,
  copyImpl,
  className,
  onCopied,
}: {
  value: string;
  /** i18n key for the accessible name. */
  label: string;
  copyImpl?: CopyImpl;
  className?: string;
  onCopied?: (ok: boolean) => void;
}) {
  const { t } = useTranslation();
  const { state, copy } = useCopy(copyImpl);
  const reduced = useMotionPrefs().reducedMotion;

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("mfa.copyAria", "Copy")}
        title={t("mfa.copy", "Copy")}
        className={cn("shrink-0 gap-1.5", className)}
        onClick={() => {
          void copy(value).then((r) => onCopied?.(r.ok));
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {state === "copied" ? (
            <motion.span
              key="check"
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduced ? undefined : { scale: 0.6, opacity: 0 }}
              transition={reduced ? LAYOUT_REDUCED_MOTION : SPRING.snappy}
              className="inline-flex"
            >
              <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduced ? undefined : { scale: 0.6, opacity: 0 }}
              transition={reduced ? LAYOUT_REDUCED_MOTION : SPRING.snappy}
              className="inline-flex"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="text-xs">{state === "copied" ? t("mfa.copied", "Copied") : t("mfa.copy", "Copy")}</span>
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? t("mfa.copied", "Copied") : null}
        {state === "failed" ? t("mfa.copyFailed", "Copy failed. Select the text and copy it manually.") : null}
      </span>
    </span>
  );
}

/**
 * Split a base32 secret into readable groups.
 *
 * Base32 secrets are long, unbroken and case-insensitive. Typing one
 * character-count at a time from a screenshot is where people give up, and an
 * authenticator app that refuses a mis-grouped secret is a support ticket.
 * Grouping is presentational only — `CopyButton` always copies the raw,
 * unspaced `value`.
 */
export function groupSecret(secret: string, size = 4): string {
  const clean = secret.replace(/\s+/g, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += size) groups.push(clean.slice(i, i + size));
  return groups.join(" ");
}

/**
 * A read-only value with its own copy button.
 *
 * `select-all-on-focus` because every one of these fields is meant to be
 * copied whole; selecting it manually is the only path to a partial copy that
 * produces a broken authenticator entry.
 */
export function CopyField({
  label,
  value,
  description,
  display,
  copyImpl,
  mono = true,
  testId,
}: {
  label: string;
  value: string;
  /** i18n key for the helper line under the value. */
  description?: string;
  /** Pre-formatted display text. Defaults to `value`. */
  display?: string;
  copyImpl?: CopyImpl;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={value} label={label} copyImpl={copyImpl} />
      </div>
      <div className="flex items-center gap-2">
        <code
          data-testid={testId}
          onFocus={(e) => {
            // `<code>` is an HTMLElement, not an input, so `select()` is not on
            // its type — but the DOM method exists on any element and is the
            // only way to give the user a whole-field selection.
            (e.currentTarget as unknown as { select: () => void }).select();
          }}
          tabIndex={0}
          className={cn(
            "block min-w-0 flex-1 select-all break-all rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground",
            mono && "font-mono tracking-wide",
          )}
        >
          {display ?? value}
        </code>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}