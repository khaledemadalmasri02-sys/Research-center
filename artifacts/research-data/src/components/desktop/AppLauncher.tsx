import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { launcherApps, resolveAppTitle } from "./app-registry";
import { useDesktopActions } from "./window-store";
import { useAuth } from "@/hooks/use-auth";
import {
  DURATION,
  EASE_OUT,
  INSTANT,
  SPRING,
  staggerFor,
  useDesktopMotion,
} from "./desktop-motion";

/**
 * App launcher (GNOME "Show Applications" overlay).
 *
 * Built on the Radix `Dialog` primitive (`components/ui/dialog`, read-only)
 * because the hand-rolled overlay was a full-screen `<div>` with no
 * `role="dialog"`, no `aria-modal`, no focus trap, no focus restore (on Esc /
 * overlay click focus fell to `<body>` — WCAG 2.4.3) and no keyboard path
 * beyond Tab. Radix supplies all of that, plus the
 * `[data-radix-popper-content-wrapper]` / `data-state="open"` markers the
 * shell's Escape handler uses to avoid closing a window behind the launcher.
 *
 * The search query is reset on every open (it used to survive the close, so the
 * next invocation started filtered for no visible reason).
 */
export function AppLauncher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { open: openApp } = useDesktopActions();
  const { canAdminAccess } = useAuth();
  const { reducedMotion, layout: layoutEnabled } = useDesktopMotion();
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  // Parameterised apps (`records/:definitionId`, `patient-view`, …) are
  // excluded: they need a concrete `route` for `useParams()` to resolve and
  // otherwise open as an empty window.
  const apps = useMemo(
    () =>
      launcherApps()
        .filter((a) => !a.adminOnly || canAdminAccess)
        .map((a) => ({ app: a, label: resolveAppTitle(t, a) }))
        .filter(({ label }) => label.toLowerCase().includes(q.trim().toLowerCase())),
    [q, canAdminAccess, t],
  );

  // Roving arrow-key grid navigation (WCAG 2.1.1): arrows move between cells,
  // Tab still moves out through the dialog's focus trap.
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[data-launcher-item]"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || buttons.length === 0) return;
    e.preventDefault();
    const cols = 6;
    const delta =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
    const next = Math.min(buttons.length - 1, Math.max(0, current + delta));
    buttons[next]?.focus();
  };

  /**
   * Staged entrance: the panel itself is Radix's `data-[state]` animation (which
   * `index.css` already zeroes under reduced motion), and the tiles stagger
   * *after* it — `delayChildren` roughly matches the panel's 200 ms so the grid
   * reads as landing on top of the panel rather than through it.
   *
   * The gap shrinks with the tile count (`staggerFor`), so a 40-tile grid still
   * has its last tile starting inside the budget instead of taking two seconds.
   */
  const tileStagger = staggerFor(apps.length, 0.028, 0.14);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* The shared `DialogContent` ships a `bg-black/80` overlay and a visible
          close button; the class overrides reposition it as the GNOME-style
          top-anchored panel and `pr-12` on the search row keeps the close
          button from overlapping the field. */}
      <DialogContent
        className="left-1/2 top-[4.5rem] max-h-[70vh] w-[680px] max-w-[92vw] translate-x-[-50%] translate-y-0 gap-0 overflow-y-auto border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-2xl backdrop-blur-[var(--glass-blur)] sm:rounded-2xl"
        onOpenAutoFocus={(e) => {
          // Focus the search field rather than the dialog container.
          if (inputRef.current) {
            e.preventDefault();
            inputRef.current.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">{t("desktop.launcher")}</DialogTitle>
        <DialogDescription className="sr-only">{t("desktop.showApps")}</DialogDescription>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reducedMotion ? INSTANT : { duration: DURATION.fast, ease: EASE_OUT }}
          className="mb-4 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 dark:bg-white/10"
        >
          <Search className="h-4 w-4 shrink-0 text-foreground/70" aria-hidden />
          {/* The input previously had only a placeholder — no programmatic
              label, so it was announced as an unlabelled edit field. */}
          <label htmlFor="desktop-launcher-search" className="sr-only">
            {t("desktop.launcher")}
          </label>
          <input
            id="desktop-launcher-search"
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="desktop-launcher-grid"
            aria-autocomplete="list"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("desktop.launcher")}
            className="h-6 w-full bg-transparent text-foreground outline-none placeholder:text-foreground/50"
          />
        </motion.div>

        <motion.div
          id="desktop-launcher-grid"
          ref={gridRef}
          role="group"
          aria-label={t("desktop.apps")}
          onKeyDown={onGridKeyDown}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: tileStagger, delayChildren: 0.08 } },
          }}
          initial="hidden"
          animate="show"
          className="relative grid max-h-[52vh] grid-cols-4 gap-3 overflow-auto rounded-2xl p-1 sm:grid-cols-6"
        >
          {/* `mode="popLayout"` keeps a filtered-out tile from reflowing the
              remaining grid while it fades, which is what made result-count
              changes read as a raw pop-in. `layout` slides the survivors into
              their new cells — explicitly gated, because framer does NOT
              suppress layout projection for reduced-motion users. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {apps.map(({ app, label }) => {
              const Icon = app.iconSvg ?? app.icon;
              return (
                <motion.button
                  key={app.id}
                  type="button"
                  data-launcher-item
                  layout={layoutEnabled}
                  title={label}
                  variants={{
                    hidden: { opacity: 0, scale: 0.88 },
                    show: {
                      opacity: 1,
                      scale: 1,
                      transition: reducedMotion ? INSTANT : SPRING.snappy,
                    },
                  }}
                  exit={{
                    opacity: 0,
                    scale: reducedMotion ? 1 : 0.88,
                    transition: reducedMotion ? INSTANT : { duration: DURATION.fast, ease: EASE_OUT },
                  }}
                  onClick={() => {
                    openApp(app.id);
                    onClose();
                  }}
                  className="flex flex-col items-center gap-1 rounded-xl p-2 text-foreground transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] dark:hover:bg-white/10"
                >
                  <span className="launch-tile grid h-12 w-12 place-items-center rounded-xl">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="text-center text-[11px] leading-tight">{label}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
          {apps.length === 0 && (
            <motion.p
              key="empty"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reducedMotion ? INSTANT : { duration: DURATION.fast, ease: EASE_OUT }}
              className="col-span-full py-6 text-center text-sm text-foreground/60"
            >
              {q}
            </motion.p>
          )}
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}