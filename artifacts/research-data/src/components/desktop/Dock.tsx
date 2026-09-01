import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { APPS } from "./app-registry";
import { useDesktop } from "./window-store";
import { useAuth } from "@/hooks/use-auth";
import { TrafficLights } from "./chrome";

const RAIL_COLLAPSED = 68;
const RAIL_EXPANDED = 300;

function initialsOf(name: string | null) {
  if (!name) return "U";
  return name.trim().slice(0, 2).toUpperCase();
}

export function Dock({
  onOpenLauncher,
  mobile,
}: {
  onOpenLauncher: () => void;
  mobile?: boolean;
}) {
  const { t } = useTranslation();
  const { windows, open, focus, restore } = useDesktop();
  const { canAdminAccess, username, role } = useAuth();

  const [expanded, setExpanded] = React.useState<boolean>(() => {
    const stored = localStorage.getItem("desktop-dock-expanded");
    return stored != null ? stored === "true" : false;
  });

  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("desktop-dock-expanded", String(next));
      return next;
    });
  }, []);

  const runningAppIds = new Set(windows.map((w) => w.appId));

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

  if (mobile) {
    return (
      <nav
        aria-label={t("desktop.apps")}
        className="glass-panel z-20 flex w-full shrink-0 flex-row items-center gap-2 overflow-x-auto rounded-t-2xl border-0 px-3 py-3 text-white"
      >
        {all.map((app) => {
          const Icon = app.iconSvg ?? app.icon;
          const isRunning = runningAppIds.has(app.id);
          return (
            <button
              key={app.id}
              type="button"
              title={t(app.titleKey)}
              onClick={() => handleOpen(app.id)}
              className="dock-app-btn relative grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
            >
              <Icon className="h-6 w-6" />
              {isRunning && (
                <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--accent-brand)]" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          title={t("desktop.showApps")}
          onClick={onOpenLauncher}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft-strong)] text-white outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
        >
          <LayoutGrid className="h-6 w-6" />
        </button>
      </nav>
    );
  }

  return (
    <motion.nav
      aria-label={t("desktop.apps")}
      animate={{ width: expanded ? RAIL_EXPANDED : RAIL_COLLAPSED }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="glass-panel z-20 m-3 flex shrink-0 flex-col overflow-hidden p-0 order-1 rtl:order-2"
    >
      {/* Titlebar: traffic-light dots + hairline divider */}
      <div className="glass-titlebar flex h-9 shrink-0 items-center gap-2 px-3">
        <TrafficLights />
        <div className="ml-auto">
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.button
                type="button"
                key="collapse"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onClick={toggleExpanded}
                aria-expanded={expanded}
                aria-label={t("desktop.collapseDock")}
                className="grid h-7 w-7 place-items-center rounded-lg text-white/70 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft-strong)] text-white outline-none ring-1 ring-white/15 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60"
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
            {t("desktop.menuEyebrow", "Menu")}
          </p>
          <h2 className="text-base font-bold text-white">{t("desktop.apps")}</h2>
        </div>
      )}

      {/* App list */}
      <div className="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto px-2">
        {all.map((app, i) => {
          const Icon = app.iconSvg ?? app.icon;
          const isRunning = runningAppIds.has(app.id);
          return (
            <button
              key={app.id}
              type="button"
              title={!expanded ? t(app.titleKey) : undefined}
              onClick={() => handleOpen(app.id)}
              className={cn(
                "group relative flex w-full items-center rounded-xl py-3 text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]",
                expanded ? "gap-3 px-3" : "justify-center px-0",
                isRunning ? "rail-icon-active" : "rail-icon hover:bg-white/10",
              )}
            >
              {isRunning && !expanded && (
                <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--accent-brand)]" />
              )}
              <Icon className="h-6 w-6 shrink-0" />
              <AnimatePresence>
                {expanded && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{
                      duration: 0.2,
                      ease: "easeOut",
                      delay: 0.08 + i * 0.02,
                    }}
                    className="relative z-10 truncate whitespace-nowrap text-sm font-semibold text-white/90"
                  >
                    {t(app.titleKey)}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>

      {/* Divider before the action row */}
      <div className="mx-3 my-1 h-px bg-white/10" />

      {/* Footer: launcher action (expanded) with chevron, plus profile footer */}
      {expanded ? (
        <div className="px-3 pb-3 pt-1">
          <button
            type="button"
            onClick={onOpenLauncher}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-white outline-none transition-colors rail-icon hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <LayoutGrid className="h-5 w-5 shrink-0" />
            <span className="text-sm font-semibold">{t("desktop.showApps")}</span>
            <ChevronRight className="ml-auto h-4 w-4 text-white/40" />
          </button>
          <div className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft-strong)] text-xs font-bold text-white">
              {initialsOf(username)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                {username ?? t("nav.settings")}
              </p>
              <p className="truncate text-[11px] text-white/50">{roleLabel}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center px-2 pb-3">
          <button
            type="button"
            title={t("desktop.showApps")}
            onClick={onOpenLauncher}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-white outline-none transition hover:bg-[var(--accent-soft-strong)] focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LayoutGrid className="h-6 w-6" />
          </button>
        </div>
      )}
    </motion.nav>
  );
}
