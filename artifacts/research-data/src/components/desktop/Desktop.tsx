import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { TopBar } from "./TopBar";
import { Dock } from "./Dock";
import { AppLauncher } from "./AppLauncher";
import { Wallpaper } from "./Wallpaper";
import { Window } from "./Window";
import { WindowStoreProvider, useDesktop } from "./window-store";
import { ThemePresetProvider, useThemePreset } from "./theme-preset-context";
import { getApp } from "./app-registry";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopToasts } from "./DesktopToasts";
import { DesktopContextMenu } from "./DesktopContextMenu";

function DesktopInner() {
  const areaRef = useRef<HTMLDivElement>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { windows, activeId, open, close, focus, reset } = useDesktop();
  const isMobile = useIsMobile();
  const metaDown = useRef(false);
  const { preset } = useThemePreset();

  useEffect(() => {
    if (windows.length === 0) open("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts: Super → launcher, Esc → close focused/launcher,
  // Alt+Tab → cycle windows, Ctrl/Cmd+W → close focused.
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
        if (launcherOpen) setLauncherOpen(false);
        else if (activeId) close(activeId);
        return;
      }
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        if (windows.length === 0) return;
        const idx = windows.findIndex((w) => w.id === activeId);
        const next = windows[(idx + 1) % windows.length];
        focus(next.id);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        if (activeId) {
          e.preventDefault();
          close(activeId);
        }
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
  }, [launcherOpen, activeId, windows, close, focus]);

  const onDesktopContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const handleReset = () => {
    reset();
    open("home");
  };

  const area = (
    <div ref={areaRef} className="relative flex-1 overflow-hidden order-2 rtl:order-1">
      <Wallpaper background={preset.background} onContextMenu={onDesktopContextMenu} />
      <AnimatePresence>
        {windows.map((w) => {
          const app = getApp(w.appId);
          if (!app) return null;
          return <Window key={w.id} win={w} app={app} areaRef={areaRef} mobile={isMobile} />;
        })}
      </AnimatePresence>
      <DesktopToasts />
      {menu && (
        <DesktopContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpenLauncher={() => setLauncherOpen(true)}
          onOpenThemes={() => open("theme-manager")}
          onReset={handleReset}
        />
      )}
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
      <AppLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </div>
  );
}

export default function Desktop() {
  return (
    <WindowStoreProvider>
      <ThemePresetProvider>
        <DesktopInner />
      </ThemePresetProvider>
    </WindowStoreProvider>
  );
}
