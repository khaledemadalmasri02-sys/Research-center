/**
 * A hard block on navigating away while recovery codes are on screen.
 *
 * WHY NOT `useNavigationGuard` / `useUnsavedChanges`.
 * Both offer the user a *choice* — "leave anyway". For recovery codes there is
 * no "anyway": the server returns them exactly once and cannot reproduce them.
 * Losing them means the account's only way back in is an administrator. So this
 * hook blocks unconditionally and the only escape is the explicit acknowledgement
 * that the codes have been saved.
 *
 * It patches the same two History entry points those hooks do (wouter and every
 * other client router go through them), and reverts the address bar when it
 * intercepts, so React state and history stay in sync.
 *
 * `beforeunload` still fires: a tab close cannot be customised, but blocking it
 * is strictly better than silently losing the codes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { DURATION, EASE_OUT, scaleIn, useMotionPrefs } from "@/lib/motion";

/**
 * @param locked    when true, navigation attempts are intercepted
 * @param message   native `beforeunload` text (browsers ignore the content, but
 *                  some show it, and it documents intent)
 * @returns `blocked` true while an interception dialog should be open, plus
 *          `release()` to lower the lock and `cancel()` to dismiss.
 */
export function useBlockLeave(locked: boolean, message?: string) {
  const [blocked, setBlocked] = useState(false);
  const bypass = useRef(false);
  const originals = useRef<Partial<Record<"pushState" | "replaceState", typeof history.pushState>>>(
    {},
  );
  const releaseOnce = useRef(false);

  useEffect(() => {
    if (!locked || typeof window === "undefined") return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message ?? "";
      return message ?? "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    const wrap = (method: "pushState" | "replaceState") => {
      const original = history[method];
      originals.current[method] = original;
      const wrapped: typeof history[typeof method] = function (
        this: History,
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ) {
        const here = window.location.pathname + window.location.search;
        const isNavigation =
          (typeof url === "string" || url instanceof URL) &&
          String(url) !== here &&
          !bypass.current;

        if (isNavigation) {
          // Put the address bar back: the router never sees this call, so React
          // state and the URL would otherwise disagree.
          original.call(history, history.state, "", window.location.href);
          setBlocked(true);
          return;
        }
        return original.call(this, data, unused, url);
      };
      history[method] = wrapped;
      return () => {
        history[method] = original;
        delete originals.current[method];
      };
    };

    const unPush = wrap("pushState");
    const unReplace = wrap("replaceState");

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unPush();
      unReplace();
      setBlocked(false);
    };
  }, [locked, message]);

  /** Lower the lock for good. Call this once the user acknowledges the codes. */
  const release = useCallback(() => {
    releaseOnce.current = true;
    setBlocked(false);
  }, []);

  const cancel = useCallback(() => setBlocked(false), []);

  return { blocked: blocked && !releaseOnce.current, release, cancel };
}

/**
 * Blocking dialog for {@link useBlockLeave}.
 *
 * Rendered inline (not via `ConfirmDestructive`) because it has exactly two
 * actions and one of them — "go back to my codes" — is the only safe one. A
 * dialog whose default action is destructive is the wrong shape here.
 */
export function LeaveGuardDialog({
  open,
  onStay,
  onLeave,
  title,
  body,
  stayLabel,
  leaveLabel,
}: {
  open: boolean;
  onStay: () => void;
  /** Only reachable once the user has confirmed they saved the codes. */
  onLeave: () => void;
  title: string;
  body: string;
  stayLabel: string;
  leaveLabel: string;
}) {
  // Deliberately on `DURATION.slow` rather than the 280ms default. This dialog
  // interrupts a user who is already leaving; arriving instantly reads as a
  // glitch, and the soft scale-in reads as "the page stopped you" rather than
  // "the page changed".
  const reduced = useMotionPrefs().reducedMotion;
  if (!open) return null;

  return (
    <motion.div
      variants={scaleIn}
      initial={reduced ? false : "hidden"}
      animate="show"
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mfa-leave-guard-title"
      aria-describedby="mfa-leave-guard-body"
      data-testid="mfa-leave-guard"
      className="fixed inset-0 z-[var(--z-modal,60)] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="mfa-leave-guard-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="mfa-leave-guard-body" className="text-sm text-muted-foreground">
          {body}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            {leaveLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onStay}
            data-testid="mfa-leave-guard-stay"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {stayLabel}
          </button>
        </div>
      </div>
    </motion.div>
  );
}