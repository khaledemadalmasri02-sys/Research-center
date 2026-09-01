import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity as ActivityIcon, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useAuth } from "@/hooks/use-auth";
import { openProductTour } from "@/hooks/use-product-tour";
import { useDesktop } from "./window-store";

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return (
    <div className="flex flex-col items-end leading-none text-white/90">
      <span className="text-xs font-medium">{time}</span>
      <span className="text-[10px] text-white/60">{date}</span>
    </div>
  );
}

export function TopBar({ onOpenLauncher }: { onOpenLauncher: () => void }) {
  const { t } = useTranslation();
  const { username } = useAuth();
  const { open } = useDesktop();

  return (
    <header className="relative z-30 flex h-9 shrink-0 items-center justify-between border-b border-white/10 bg-black/40 px-3 text-white backdrop-blur">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenLauncher}
          className="h-7 gap-1.5 px-2 text-white hover:bg-white/10 hover:text-white"
        >
          <ActivityIcon className="h-4 w-4" />
          <span className="text-xs font-medium">{t("desktop.activities")}</span>
        </Button>
        <Clock />
      </div>

      <div className="flex items-center gap-1 text-white">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openProductTour()}
          title={t("tutor.title")}
          className="h-7 gap-1.5 px-2 text-white hover:bg-white/10 hover:text-white"
        >
          <GraduationCap className="h-4 w-4" />
          <span className="text-xs font-medium">{t("tutor.label")}</span>
        </Button>
        <NotificationBell />
        <ThemeToggle />
        <LanguageSwitcher />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open("settings")}
          title={t("nav.settings")}
          className="h-7 gap-1.5 px-2 text-white hover:bg-white/10 hover:text-white"
        >
          <span className="max-w-[120px] truncate text-xs">{username}</span>
        </Button>
      </div>
    </header>
  );
}
