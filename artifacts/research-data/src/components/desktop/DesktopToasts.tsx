import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useNotifications, useMarkNotificationRead } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { Z } from "./z-index";
import {
  DURATION,
  EASE_OUT,
  INSTANT,
  SPRING,
  isRtlDoc,
  useDesktopMotion,
} from "./desktop-motion";

interface Toast {
  key: string;
  id: number;
  title: string;
  body: string;
  type: string;
}

/** Transient notifications: 6s. */
const TTL_INFO = 6000;
/**
 * Audit / error notifications stay far longer (and are never auto-dismissed
 * before the user has read them). A PHI-relevant message — a rejected data
 * ingest, an audit-log entry — disappearing after six seconds is a data-loss
 * bug, not a style choice.
 */
const TTL_ALERT = 60_000;
const ALERT_TYPES = new Set(["error", "audit", "alert", "warning", "security"]);

function ttlFor(type: string): number {
  return ALERT_TYPES.has(type?.toLowerCase()) ? TTL_ALERT : TTL_INFO;
}

/**
 * Audit / error toasts get a slower, heavier entrance than a 6 s info toast: a
 * message that will be on screen for a minute should *land* rather than flick
 * past. A fast spring reads as "this is gone in a moment" no matter what the
 * TTL says.
 */
export function DesktopToasts() {
  const { t } = useTranslation();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const { reducedMotion, layout: layoutEnabled } = useDesktopMotion();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef<Set<number>>(new Set());
  const seeded = useRef(false);
  const timers = useRef<number[]>([]);
  // The stack is right-aligned in LTR and left-aligned in RTL (`end-3`), so the
  // entrance has to come from the correct edge or the toast slides *across*
  // itself. Read once per mount: switching language direction remounts nothing,
  // and the worst case is one toast entering from the wrong side.
  const [enterFrom] = useState(() => (isRtlDoc() ? -1 : 1) * 40);
  // `useMarkNotificationRead()` returns a fresh result object each render, so
  // keep `mutate` in a ref and depend on the query data only — otherwise this
  // effect re-runs on every poll tick.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  useEffect(() => {
    const items = data?.notifications ?? [];
    if (!seeded.current) {
      items.forEach((n) => shown.current.add(n.id));
      seeded.current = true;
      return;
    }
    const fresh = items.filter((n) => !shown.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => shown.current.add(n.id));
    const newToasts: Toast[] = fresh.map((n) => ({
      key: `t-${n.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
    }));
    setToasts((prev) => [...prev, ...newToasts]);
    newToasts.forEach((tt) => {
      // Auto-dismiss used to drop the toast *without* calling `markRead`, so
      // the bell badge never cleared for anything the user did not click.
      const id = window.setTimeout(() => {
        setToasts((prev) => prev.filter((p) => p.key !== tt.key));
        markReadRef.current.mutate(tt.id);
      }, ttlFor(tt.type));
      timers.current.push(id);
    });
  }, [data]);

  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  const dismiss = (tt: Toast) => {
    setToasts((prev) => prev.filter((p) => p.key !== tt.key));
    markRead.mutate(tt.id);
  };

  return (
    // `end-3` instead of `right-3` so the stack mirrors correctly in RTL; the
    // container is `absolute … top-12` inside the `overflow-hidden` workspace
    // area, so a burst of toasts used to stack past the bottom edge and get
    // clipped. `max-h` + `overflow-y-auto` keeps them reachable.
    // `aria-live` was missing entirely, so a new toast was never announced; it
    // is polite (not assertive) because an assertive alert here would interrupt
    // whatever a screen reader was already saying inside the focused window.
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none absolute end-3 top-12 flex max-h-[calc(100%-3.5rem)] w-80 flex-col gap-2 overflow-y-auto"
      style={{ zIndex: Z.toast }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((tt) => {
          const isAlert = ALERT_TYPES.has(tt.type?.toLowerCase());
          return (
            <motion.div
              key={tt.key}
              layout={layoutEnabled}
              initial={
                reducedMotion
                  ? false
                  : { opacity: 0, x: enterFrom, scale: isAlert ? 0.97 : 0.94 }
              }
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : // Out is faster than in: the stack is already taller than
                    // the viewport and the next toast is waiting behind it.
                    { opacity: 0, x: enterFrom * 0.4, scale: 0.97, transition: { duration: DURATION.fast, ease: EASE_OUT } }
              }
              transition={reducedMotion ? INSTANT : isAlert ? SPRING.gentle : SPRING.smooth}
              className="pointer-events-auto relative shrink-0 overflow-hidden rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-2xl backdrop-blur"
            >
              {isAlert && (
                // A persistent accent bar, not a transient flash: the visual
                // weight has to match the 60 s TTL.
                <span
                  aria-hidden
                  className="absolute inset-y-0 start-0 w-1 bg-[var(--accent-brand)]"
                />
              )}
              <div className={cn("flex items-start gap-2", isAlert && "ps-1")}>
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div className="flex-1">
                  <p className="text-sm font-medium">{tt.title}</p>
                  {tt.body && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">{tt.body}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(tt)}
                  className="rounded text-muted-foreground/60 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
                  // Was a hardcoded English "Dismiss"; reuse an existing key
                  // rather than adding one (`src/i18n/**` is owned elsewhere).
                  aria-label={`${t("desktop.close")} ${tt.title}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}