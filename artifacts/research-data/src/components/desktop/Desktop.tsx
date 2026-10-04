import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { AnimatePresence } from "framer-motion";
import { TopBar } from "./TopBar";
import { Dock } from "./Dock";
import { AppLauncher } from "./AppLauncher";
import { Wallpaper } from "./Wallpaper";
import { Window } from "./Window";
import {
  MIN_H,
  MIN_W,
  WindowStoreProvider,
  clearDesktopStorage,
  useDesktopActions,
  useDesktopState,
  type DesktopWindow,
} from "./window-store";
import { useThemePreset } from "./theme-preset-context";
import { getApp, resolveAppTitle } from "./app-registry";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopToasts } from "./DesktopToasts";
import { DesktopContextMenu } from "./DesktopContextMenu";
import { useSound } from "@/components/sound-provider";
import { useLiveAnnouncer } from "@/components/live-region";
import { useAuth } from "@/hooks/use-auth";
import { appIdForHref, normalizeHref } from "./DesktopLink";
import { hasOpenRadixLayer, isApplePlatform, isTextEntryTarget } from "./z-index";

/** GNOME/Adwaita keyboard map for the window manager (WCAG 2.1.1 / 2.5.3).
 *  Super                toggle the app launcher
 *  Escape               close the focused window (never while a dialog/menu is open)
 *  Alt+Tab              cycle windows forward      (Linux/Windows only — not macOS)
 *  Alt+Shift+Tab        cycle windows backward
 *  Ctrl/Cmd+W           close the focused window
 *  Alt+Arrow            move the focused window 24px (48px with Shift)
 *  Alt+Shift+Arrow      resize the focused window 24px (48px with Shift)
 *  Alt+M                minimize the focused window
 *  Alt+R                restore the focused window
 *  Alt+F10              toggle maximize
 */
function DesktopInner() {
  const areaRef = useRef<HTMLDivElement>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const { t } = useTranslation();
  const { windows, activeId } = useDesktopState();
  const { open, close, focus, reset, minimize, restore, toggleMaximize, move, setRect } = useDesktopActions();
  const isMobile = useIsMobile();
  const metaDown = useRef(false);
  const { preset } = useThemePreset();
  const { play } = useSound();
  const { announce } = useLiveAnnouncer();
  const { canAdminAccess, authenticated } = useAuth();
  const [location, navigate] = useLocation();

  const prevWindows = useRef<DesktopWindow[]>(windows);
  const activeWindow = activeId ? windows.find((w) => w.id === activeId) : undefined;
  const booted = useRef(false);

  /* ---- open / close sound -------------------------------------------- */
  useEffect(() => {
    if (windows.length > prevWindows.current.length) play("window-open");
  }, [windows.length, play]);

  /* ---- PHI on shared workstations (D19) -------------------------------- */
  // `ubuntu-desktop-windows-v1` survives logout: `rc_sid` is host-scoped to
  // `.research-center.fit` but this key is not, and `use-auth.ts`'s `logout()`
  // does not remove it. On a shared clinical workstation the next person to
  // sign in was therefore shown the previous user's open windows — and their
  // patient ids — before any auth check ran.
  const wasAuthenticated = useRef(authenticated);
  useEffect(() => {
    if (wasAuthenticated.current && !authenticated) {
      clearDesktopStorage();
      reset();
    }
    wasAuthenticated.current = authenticated;
  }, [authenticated, reset]);

  /* ---- URL <-> windows (D9) ------------------------------------------ */
  // Claimed by whichever effect resolves first, which is what keeps the two
  // directions from ping-ponging: a non-singleton `open()` always changes
  // state, so an unguarded loop would spawn windows forever.
  const claimedPath = useRef<string | null>(null);

  // windows -> URL. Never runs on mount, so a deep link is not immediately
  // rewritten back to the Home window's route.
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    const target = activeWindow ? normalizeHref(activeWindow.route || "/") : "/";
    claimedPath.current = target;
    if (normalizeHref(location || "/") === target) return;
    navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWindow?.id, activeWindow?.route]);

  // URL -> windows (deep links, in-page navigation, browser Back/Forward).
  useEffect(() => {
    const path = normalizeHref(location || "/");
    if (claimedPath.current === path) return;
    claimedPath.current = path;
    if (windows.length === 0 && path === "/") {
      open("home");
      return;
    }
    const appId = appIdForHref(path);
    if (!appId) return;
    const app = getApp(appId);
    if (app?.adminOnly && !canAdminAccess) return;
    open(appId, { route: path === "/" ? undefined : path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  /* ---- focus restore on close (D6) + announcements (D21) -------------- */
  useEffect(() => {
    const prev = prevWindows.current;
    const prevById = new Map(prev.map((w) => [w.id, w]));
    const nextIds = new Set(windows.map((w) => w.id));
    const labelFor = (w: DesktopWindow) => {
      const app = getApp(w.appId);
      return app ? resolveAppTitle(t, app) : w.appId;
    };

    const closed = prev.filter((w) => !nextIds.has(w.id));
    if (closed.length === 1) {
      // Put focus back on the dock button that owns the app instead of letting
      // it fall to <body> (where the next Tab restarts from the top of the
      // document).
      const selector = `[data-dock-app-id="${cssEscape(closed[0].appId)}"]`;
      const target =
        document.querySelector<HTMLElement>(selector) ??
        document.querySelector<HTMLElement>("[data-launcher-trigger]");
      window.setTimeout(() => target?.focus({ preventScroll: true }), 0);
    }

    for (const w of windows) {
      const before = prevById.get(w.id);
      const label = labelFor(w);
      if (!before) {
        announce(`${t("desktop.windowOpened", "Window opened")}: ${label}`);
      } else if (!before.minimized && w.minimized) {
        announce(`${t("desktop.windowMinimized", "Minimized")}: ${label}`);
      } else if (before.minimized && !w.minimized) {
        announce(`${t("desktop.windowRestored", "Restored")}: ${label}`);
      } else if (!before.maximized && w.maximized) {
        announce(`${t("desktop.windowMaximized", "Maximized")}: ${label}`);
      } else if (before.maximized && !w.maximized) {
        announce(`${t("desktop.windowUnmaximized", "Restored size")}: ${label}`);
      }
    }
    for (const w of closed) {
      announce(`${t("desktop.windowClosed", "Window closed")}: ${labelFor(w)}`);
    }

    prevWindows.current = windows;
  }, [windows, t, announce]);

  /* ---- unique skip-to-content target (D7) ---------------------------- */
  // `layout.tsx` renders `<main id="main-content">` once per open window, so
  // `SkipToContent` (href="#main-content") had N duplicate targets and jumped
  // to whichever came first in the DOM — possibly a background window. Keep
  // the id only on the focused window's main and demote the rest.
  useEffect(() => {
    const mains = Array.from(document.querySelectorAll<HTMLElement>('main[id^="main-content"]'));
    if (mains.length <= 1) return;
    const activeDomId = activeWindow?.id ?? "";
    for (const el of mains) {
      const owner = el.closest<HTMLElement>("[data-window-id]")?.dataset.windowId ?? "";
      el.id = owner && owner === activeDomId ? "main-content" : "main-content-inactive";
    }
  }, [windows, activeWindow?.id]);

  /* ---- keyboard shortcuts --------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Meta" && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (!metaDown.current) {
          metaDown.current = true;
          setLauncherOpen((o) => !o);
        }
        return;
      }

      if (e.key === "Escape") {
        // Radix binds Escape on `document` in the CAPTURE phase and only calls
        // `preventDefault()`, which does NOT stop propagation — so without this
        // guard a single Escape press closed the open dialog *and* the window
        // behind it, discarding in-progress clinical form state.
        if (e.defaultPrevented || hasOpenRadixLayer()) return;
        if (launcherOpen) setLauncherOpen(false);
        else if (activeId) close(activeId);
        return;
      }

      // Alt+Tab is the OS/GTK window switcher on Linux/Windows; binding it
      // unconditionally stole it. On macOS it is never intercepted.
      if (e.altKey && e.key === "Tab" && !isApplePlatform()) {
        if (windows.length === 0) return;
        e.preventDefault();
        const idx = windows.findIndex((w) => w.id === activeId);
        const step = e.shiftKey ? -1 : 1;
        const next = windows[(((idx + step) % windows.length) + windows.length) % windows.length];
        const nextApp = getApp(next.appId);
        focus(next.id);
        announce(nextApp ? resolveAppTitle(t, nextApp) : next.appId);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        // Never close a window while the user is typing in a field.
        if (isTextEntryTarget(e.target)) return;
        if (activeId) {
          e.preventDefault();
          close(activeId);
        }
        return;
      }

      if (!e.altKey || e.ctrlKey || e.metaKey || isTextEntryTarget(e.target)) return;
      const active = activeId ? windows.find((w) => w.id === activeId) : undefined;
      if (!active) return;

      const step = e.shiftKey ? 48 : 24;
      const key = e.key;
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        e.preventDefault();
        const area = areaRef.current;
        const aw = area?.clientWidth ?? window.innerWidth;
        const ah = area?.clientHeight ?? window.innerHeight;
        const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        if (e.shiftKey) {
          setRect(active.id, {
            w: Math.max(MIN_W, Math.min(active.w + dx, aw)),
            h: Math.max(MIN_H, Math.min(active.h + dy, ah)),
          });
        } else {
          move(
            active.id,
            Math.max(0, Math.min(active.x + dx, Math.max(0, aw - active.w))),
            Math.max(0, Math.min(active.y + dy, Math.max(0, ah - active.h))),
          );
        }
        return;
      }
      if (!e.shiftKey && key.toLowerCase() === "m") {
        e.preventDefault();
        minimize(active.id);
        return;
      }
      if (!e.shiftKey && key.toLowerCase() === "r") {
        e.preventDefault();
        restore(active.id);
        return;
      }
      if (key === "F10") {
        e.preventDefault();
        const area = areaRef.current;
        if (area) toggleMaximize(active.id, { x: 0, y: 0, w: area.clientWidth, h: area.clientHeight });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") metaDown.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [launcherOpen, activeId, windows, close, focus, minimize, restore, toggleMaximize, move, setRect, t, announce]);

  const handleReset = () => {
    reset();
    clearDesktopStorage();
    open("home");
  };

  const area = (
    <div ref={areaRef} className="relative order-2 flex-1 overflow-hidden rtl:order-1">
      {!isMobile && (
        <DesktopContextMenu
          onOpenLauncher={() => setLauncherOpen(true)}
          onOpenThemes={() => open("theme-manager")}
          onReset={handleReset}
        >
          {/* The wallpaper is the context-menu trigger, so right-clicking a
              window does not raise the desktop menu. Radix clamps the menu
              against the viewport and adds menu semantics + arrow-key focus. */}
          <div className="absolute inset-0">
            <Wallpaper background={preset.background} />
          </div>
        </DesktopContextMenu>
      )}
      <AnimatePresence>
        {windows.map((w) => {
          const app = getApp(w.appId);
          if (!app) return null;
          return <Window key={w.id} win={w} app={app} areaRef={areaRef} mobile={isMobile} />;
        })}
      </AnimatePresence>
      <DesktopToasts />
    </div>
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar onOpenLauncher={() => setLauncherOpen(true)} />
      {isMobile ? (
        <>
          {area}
          <Dock mobile onOpenLauncher={() => setLauncherOpen(true)} />
        </>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          <Dock onOpenLauncher={() => setLauncherOpen(true)} />
          {area}
        </div>
      )}
      {/* The CommandPalette lives in App.tsx for both shells. It used to be
          mounted here too, so one ⌘K press opened two stacked Radix dialogs and
          running an action closed only the top one, leaving a palette stuck
          on screen. */}
      <AppLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export default function Desktop() {
  const { canAdminAccess } = useAuth();
  return (
    // `ThemePresetProvider` is mounted once, in `main.tsx`, above `<App />` —
    // it used to be mounted here as well. Two mounts meant two independent
    // `Stored` states fed from the same `localStorage` key: the desktop shell
    // read the inner one while `settings.tsx` / `theme-manager.tsx` wrote the
    // outer one, so switching a preset in the Theme Manager did not re-skin the
    // desktop. It also doubled the work of the theme-token effect.
    <WindowStoreProvider canAdminAccess={canAdminAccess}>
      <DesktopInner />
    </WindowStoreProvider>
  );
}