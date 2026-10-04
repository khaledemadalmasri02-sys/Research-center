import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { APPS, resolveAppTitle } from "./app-registry";
import { useDesktopState, useDesktopActions } from "./window-store";
import { useAuth } from "@/hooks/use-auth";
import { Z } from "./z-index";
import {
  DURATION,
  EASE_OUT,
  INSTANT,
  SPRING,
  staggerFor,
  useDesktopMotion,
} from "./desktop-motion";
import { installDockAnchorTracking, measureAllDockAnchors } from "./dock-anchor";

/**
 * Spotlight targets for the product tour. `use-product-tour.ts` queries
 * `[data-tour="<key>"]` and silently skips steps with no match, and the
 * classic shell's `layout.tsx` marks its sidebar with those keys — the desktop
 * dock did not, so the tour skipped almost every step on the apex host.
 * Keys mirror the classic shell's `mainNav` / `utilityNav`.
 */
const TOUR_KEY: Record<string, string> = {
  home: "dashboard",
  patients: "patients",
  collections: "collections",
  "data-analysis": "dataAnalysis",
  feedback: "feedback",
  "more-features": "moreFeatures",
  "activity/me": "myActivity",
  "api-tokens": "apiTokens",
  sessions: "sessions",
  admin: "admin",
};

const RAIL_COLLAPSED = 68;
const RAIL_EXPANDED = 300;

/** Hover lift: transform only, so the rail never reflows. */
const HOVER_SCALE = 1.07;

function initialsOf(name: string | null) {
  if (!name) return "U";
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * Running / focused indicator, as a transform-only pill.
 *
 * Three readable states instead of the old "colour pill for active, dot for
 * running, nothing at all for a running-but-unfocused app in expanded mode":
 *
 *   focused              wide solid pill  (scaleX 1,    opacity 1)
 *   running, not focused narrow dot       (scaleX .34,  opacity .85)
 *   running, minimized   narrow dim dot   (scaleX .34,  opacity .45)
 *
 * `scaleX` + `opacity` rather than width so the indicator never triggers
 * layout, and `layout` (gated on reduced motion — framer's
 * `MotionConfig reducedMotion="user"` does NOT suppress layout projection) is
 * what slides it between the collapsed centre and the expanded label gutter.
 */
function DockIndicator({
  state,
  layoutEnabled,
}: {
  state: "focused" | "running" | "minimized" | "none";
  layoutEnabled: boolean;
}) {
  const visible = state !== "none";
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.span
          aria-hidden
          layout={layoutEnabled}
          initial={false}
          animate={{
            scaleX: state === "focused" ? 1 : 0.34,
            opacity: state === "focused" ? 1 : state === "running" ? 0.85 : 0.45,
          }}
          exit={{ scaleX: 0, opacity: 0 }}
          transition={
            layoutEnabled ? SPRING.snappy : { duration: DURATION.fast, ease: EASE_OUT }
          }
          style={{ transformOrigin: "center" }}
          className="h-1 w-5 rounded-full bg-[var(--accent-brand)]"
        />
      )}
    </AnimatePresence>
  );
}

export function Dock({
  onOpenLauncher,
  mobile,
}: {
  onOpenLauncher: () => void;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  const { windows, activeId } = useDesktopState();
  const { open, focus, restore } = useDesktopActions();
  const { canAdminAccess, username, role } = useAuth();
  const { reducedMotion, layout: layoutEnabled } = useDesktopMotion();

  // `localStorage` was touched with no `typeof window` guard here, unlike
  // `desktop-mode.ts` / `theme-preset-context.tsx`; SSR, tests and blocked
  // storage all threw.
  const [expanded, setExpanded] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem("desktop-dock-expanded");
      return stored != null ? stored === "true" : false;
    } catch {
      return false;
    }
  });

  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("desktop-dock-expanded", String(next));
      } catch {
        /* private mode / quota */
      }
      return next;
    });
  }, []);

  const runningAppIds = new Set(windows.map((w) => w.appId));

  /**
   * Indicator state per app. A *minimized* window counts as running but never
   * focused — the old code dropped the dot entirely in expanded mode, so
   * minimizing a window made its dock entry indistinguishable from an app that
   * was not running at all.
   */
  const indicatorState = (appId: string): "focused" | "running" | "minimized" | "none" => {
    if (activeId) {
      const active = windows.find((w) => w.id === activeId);
      if (active && active.appId === appId && !active.minimized) return "focused";
    }
    const matches = windows.filter((w) => w.appId === appId);
    if (matches.length === 0) return "none";
    return matches.every((w) => w.minimized) ? "minimized" : "running";
  };

  const pinned = APPS.filter(
    (a) => a.showInDock && (!a.adminOnly || canAdminAccess),
  );
  const runningNotPinned = APPS.filter(
    (a) => !a.showInDock && runningAppIds.has(a.id) && (!a.adminOnly || canAdminAccess),
  );
  const all = [...pinned, ...runningNotPinned];

  const handleOpen = (appId: string) => {
    const matches = windows.filter((w) => w.appId === appId);
    if (matches.length > 0) {
      const top = matches.reduce((a, b) => (b.zIndex > a.zIndex ? b : a));
      if (top.minimized) restore(top.id);
      else focus(top.id);
    } else {
      open(appId);
    }
  };

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : t("nav.settings");

  /**
   * Publish this dock's button geometry so `Window` can travel to the right
   * icon on minimize without measuring anything itself. One rAF-throttled
   * measurement per shell, never per pointermove.
   */
  React.useEffect(() => installDockAnchorTracking(), []);
  React.useLayoutEffect(() => {
    const id = window.requestAnimationFrame(measureAllDockAnchors);
    return () => window.cancelAnimationFrame(id);
  }, [expanded, all.length]);

  /* ---- mobile ---------------------------------------------------------- */

  if (mobile) {
    return (
      <motion.nav
        aria-label={t("desktop.apps")}
        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reducedMotion ? INSTANT : { duration: DURATION.base, ease: EASE_OUT }}
        className="glass-panel flex w-full shrink-0 flex-row items-center gap-2 overflow-x-auto rounded-t-2xl border-0 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-foreground"
        style={{ zIndex: Z.dock }}
      >
        <AnimatePresence initial={false}>
          {all.map((app) => {
            const Icon = app.iconSvg ?? app.icon;
            const state = indicatorState(app.id);
            return (
              <motion.button
                key={app.id}
                type="button"
                data-dock-app-id={app.id}
                data-tour={TOUR_KEY[app.id]}
                title={resolveAppTitle(t, app)}
                aria-label={resolveAppTitle(t, app)}
                onClick={() => handleOpen(app.id)}
                initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={reducedMotion ? INSTANT : SPRING.snappy}
                className={cn(
                  "dock-app-btn relative grid h-12 w-12 shrink-0 place-items-center rounded-xl text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]",
                  state === "focused" && "ring-2 ring-[var(--accent-brand)]",
                )}
              >
                <Icon className="h-6 w-6" />
                <span className="absolute inset-x-0 bottom-0.5 flex justify-center">
                  <DockIndicator state={state} layoutEnabled={layoutEnabled} />
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        <button
          type="button"
          data-launcher-trigger
          title={t("desktop.showApps")}
          onClick={onOpenLauncher}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft-strong)] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
        >
          <LayoutGrid className="h-6 w-6" />
        </button>
      </motion.nav>
    );
  }

  /* ---- rail ------------------------------------------------------------ */

  /** Cap the staggers so a long app list still resolves inside ~200 ms. */
  const labelStagger = staggerFor(all.length, 0.02, 0.16);
  const hoverStagger = staggerFor(all.length, 0.022, 0.1);

  return (
    <motion.nav
      aria-label={t("desktop.apps")}
      animate={{ width: expanded ? RAIL_EXPANDED : RAIL_COLLAPSED }}
      transition={reducedMotion ? INSTANT : { duration: DURATION.slow, ease: EASE_OUT }}
      className="glass-panel m-3 flex shrink-0 flex-col overflow-hidden p-0 order-1 rtl:order-2"
      style={{ zIndex: Z.dock }}
    >
      {/* Titlebar: hairline divider */}
      <div className="glass-titlebar flex h-9 shrink-0 items-center gap-2 px-3">
        <div className="mr-auto">
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.button
                type="button"
                key="collapse"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={reducedMotion ? INSTANT : { duration: DURATION.fast, ease: EASE_OUT }}
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-label={t("desktop.collapseDock")}
                className="grid h-7 w-7 place-items-center rounded-lg text-foreground/70 outline-none transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapsed: the distinct, solid launch/expand chip that opens the panel */}
      {!expanded && (
        <div className="flex justify-center px-2 pt-3">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-label={t("desktop.expandDock")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft-strong)] text-foreground outline-none ring-1 ring-border transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>
      )}

      {/* Expanded: header with eyebrow + bold title */}
      {expanded && (
        <div className="px-4 pb-2 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/40">
            {t("desktop.menuEyebrow", "Menu")}
          </p>
          <h2 className="text-base font-bold text-foreground">{t("desktop.apps")}</h2>
        </div>
      )}

      {/*
        App list.

        `overflow-x-hidden` is load-bearing: `overflow-y-auto` alone computes
        `overflow-x: auto`, so the scaled hover state would open a horizontal
        scrollbar and reflow the rail.

        The stagger is a per-button `whileHover` transition delay rather than
        `staggerChildren` variant propagation, because propagation requires the
        child to have no `animate` prop of its own — and these buttons need one
        for the enter/exit animation when an app is added or removed.
      */}
      <div className="mt-1 flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-2">
        <AnimatePresence initial={false}>
          {all.map((app, i) => {
            const Icon = app.iconSvg ?? app.icon;
            const state = indicatorState(app.id);
            return (
              <motion.button
                key={app.id}
                type="button"
                data-dock-app-id={app.id}
                data-tour={TOUR_KEY[app.id]}
                title={!expanded ? resolveAppTitle(t, app) : undefined}
                aria-label={resolveAppTitle(t, app)}
                onClick={() => handleOpen(app.id)}
                initial={reducedMotion ? false : { opacity: 0, scale: 0.86 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.86 }}
                whileHover={
                  reducedMotion
                    ? undefined
                    : {
                        scale: HOVER_SCALE,
                        y: -1,
                        transition: {
                          ...SPRING.snappy,
                          delay: hoverStagger * i,
                        },
                      }
                }
                transition={reducedMotion ? INSTANT : SPRING.snappy}
                className={cn(
                  "group relative flex w-full items-center rounded-xl py-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]",
                  expanded ? "gap-3 px-3" : "justify-center px-0",
                  // Only the FOCUSED app gets the accent pill. A running but
                  // unfocused app gets a neutral tint so the two states are
                  // distinguishable in expanded mode, which is where the old
                  // code collapsed them into one look.
                  state === "focused"
                    ? "rail-icon-active"
                    : state === "running" || state === "minimized"
                      ? "rail-icon bg-black/5 dark:bg-white/5"
                      : "rail-icon hover:bg-black/5 dark:hover:bg-white/10",
                )}
              >
                <motion.span
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.86 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.86 }}
                  transition={reducedMotion ? INSTANT : SPRING.snappy}
                  className={cn("flex w-full items-center", expanded ? "gap-3" : "justify-center")}
                >
                  <Icon className="h-6 w-6 shrink-0" />
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.span
                        initial={reducedMotion ? false : { opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={
                          reducedMotion
                            ? INSTANT
                            : {
                                duration: DURATION.fast,
                                ease: EASE_OUT,
                                delay: 0.06 + labelStagger * i,
                              }
                        }
                        className="truncate whitespace-nowrap text-sm font-semibold text-foreground/90"
                      >
                        {resolveAppTitle(t, app)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.span>
                {/* Indicator row: centred under the icon when collapsed, in the
                    label gutter when expanded. `layout` on the pill below does
                    the slide; framer does not gate that on reduced motion, so
                    the prop is explicitly disabled when reduced. */}
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-1 flex",
                    expanded ? "justify-start ps-3" : "justify-center",
                  )}
                >
                  <DockIndicator state={state} layoutEnabled={layoutEnabled} />
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Divider before the action row */}
      <div className="mx-3 my-1 h-px bg-black/10 dark:bg-white/10" />

      {/* Footer: launcher action (expanded) with chevron, plus profile footer */}
      {expanded ? (
        <div className="px-3 pb-3 pt-1">
          <button
            type="button"
            data-launcher-trigger
            onClick={onOpenLauncher}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-foreground outline-none transition-colors rail-icon hover:bg-black/5 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <LayoutGrid className="h-5 w-5 shrink-0" />
            <span className="text-sm font-semibold">{t("desktop.showApps")}</span>
            <ChevronRight className="ml-auto h-4 w-4 text-foreground/40" />
          </button>
          <div className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft-strong)] text-xs font-bold text-foreground">
              {initialsOf(username)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">
                {username ?? t("nav.settings")}
              </p>
              <p className="truncate text-[11px] text-foreground/50">{roleLabel}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center px-2 pb-3">
          <button
            type="button"
            data-launcher-trigger
            title={t("desktop.showApps")}
            onClick={onOpenLauncher}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-foreground outline-none transition hover:bg-[var(--accent-soft-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <LayoutGrid className="h-6 w-6" />
          </button>
        </div>
      )}
    </motion.nav>
  );
}