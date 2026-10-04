import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity as ActivityIcon,
  GraduationCap,
  LogOut,
  MessageSquare,
  Moon,
  Palette,
  Settings as SettingsIcon,
  Sun,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { SoundToggle } from "@/components/sound-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useAuth } from "@/hooks/use-auth";
import { openProductTour } from "@/hooks/use-product-tour";
import { useDesktopActions, useDesktopState } from "./window-store";
import { getApp, resolveAppTitle } from "./app-registry";
import { useThemePreset } from "./theme-preset-context";
import { Z } from "./z-index";

function Clock() {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align the first tick to the next minute boundary: a plain
    // `setInterval(…, 30_000)` is not minute-aligned, so the displayed minute
    // could be stale by up to 30 seconds.
    let interval: number | undefined;
    const schedule = () => {
      const nowMs = Date.now();
      const delay = 60_000 - (nowMs % 60_000);
      interval = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (interval !== undefined) window.clearTimeout(interval);
    };
  }, []);

  // Format with the *app's* language, not the browser/OS locale: with the app
  // in Arabic and the OS in English, `toLocaleTimeString([], …)` produced an
  // English clock.
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const time = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return (
    <div className="hidden flex-col items-end leading-none text-foreground/90 sm:flex">
      <time dateTime={now.toISOString()} className="text-xs font-medium">
        {time}
      </time>
      <span className="text-[10px] text-foreground/60">{date}</span>
    </div>
  );
}

export function TopBar({ onOpenLauncher }: { onOpenLauncher: () => void }) {
  const { t } = useTranslation();
  const { username, logout } = useAuth();
  // Split contexts: the combined `useDesktop()` value changes identity on every
  // `state.windows` change (and with it every window move), while this
  // component only needs `open`.
  const { open } = useDesktopActions();
  const { windows, activeId } = useDesktopState();
  const { toggleTheme, preset } = useThemePreset();
  const active = activeId ? windows.find((w) => w.id === activeId) : undefined;
  const activeApp = active ? getApp(active.appId) : undefined;
  const activeLabel = activeApp ? resolveAppTitle(t, activeApp) : undefined;

  return (
    <header
      className="relative flex h-9 shrink-0 items-center justify-between border-b border-border bg-background/70 px-3 pt-[env(safe-area-inset-top)] text-foreground backdrop-blur"
      style={{ zIndex: Z.topbar }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenLauncher}
          data-launcher-trigger
          title={t("desktop.showApps")}
          className="h-7 shrink-0 gap-1.5 px-2 text-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        >
          <ActivityIcon className="h-4 w-4" aria-hidden />
          {/* Below `lg` the label collapses to an icon with screen-reader text
              so the 768-1024px range does not overflow. */}
          <span className="hidden text-xs font-medium lg:inline">{t("desktop.activities")}</span>
          <span className="sr-only lg:hidden">{t("desktop.activities")}</span>
        </Button>
        {activeLabel && (
          <span
            key={activeLabel}
            aria-live="polite"
            className="hidden max-w-[28ch] truncate text-xs font-semibold text-foreground/85 lg:inline"
          >
            {activeLabel}
          </span>
        )}
        <Clock />
      </div>

      <div className="flex shrink-0 items-center gap-1 text-foreground">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openProductTour()}
          title={t("tutor.title")}
          className="h-7 gap-1.5 px-2 text-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        >
          <GraduationCap className="h-4 w-4" aria-hidden />
          <span className="hidden text-xs font-medium lg:inline">{t("tutor.label")}</span>
          <span className="sr-only lg:hidden">{t("tutor.label")}</span>
        </Button>
        <NotificationBell />
        <ThemeToggle />
        <SoundToggle />
        <LanguageSwitcher />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              title={t("nav.settings")}
              className="h-7 gap-1.5 px-2 text-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            >
              <User className="h-4 w-4" aria-hidden />
              <span className="hidden max-w-[120px] truncate text-xs sm:inline">{username}</span>
              <span className="sr-only sm:hidden">{username}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-56 border-border bg-popover text-popover-foreground shadow-2xl backdrop-blur data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            <DropdownMenuItem
              className="focus:bg-accent focus:text-accent-foreground"
              onClick={() => open("theme-manager")}
            >
              <Palette className="h-4 w-4" aria-hidden />
              <span className="text-xs">{t("nav.themeManager")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="focus:bg-accent focus:text-accent-foreground"
              onClick={() => {
                toggleTheme();
              }}
            >
              {preset.dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
              <span className="text-xs">{t("theme.toggle")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="focus:bg-accent focus:text-accent-foreground"
              onClick={() => open("feedback")}
            >
              <MessageSquare className="h-4 w-4" aria-hidden />
              <span className="text-xs">{t("nav.feedback")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="focus:bg-accent focus:text-accent-foreground"
              onClick={() => open("settings")}
            >
              <SettingsIcon className="h-4 w-4" aria-hidden />
              <span className="text-xs">{t("nav.settings")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="focus:bg-accent focus:text-destructive text-destructive"
              onClick={() => logout()}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="text-xs">{t("nav.signOut")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}