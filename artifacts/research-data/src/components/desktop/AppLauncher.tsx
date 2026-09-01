import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { APPS } from "./app-registry";
import { useDesktop } from "./window-store";
import { useAuth } from "@/hooks/use-auth";

export function AppLauncher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { open: openApp } = useDesktop();
  const { canAdminAccess } = useAuth();
  const [q, setQ] = useState("");

  if (!open) return null;

  const apps = APPS.filter((a) => !a.adminOnly || canAdminAccess).filter((a) =>
    t(a.titleKey).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mt-16 w-[680px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <Search className="h-4 w-4 text-white/70" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("desktop.launcher")}
            className="w-full bg-transparent text-white outline-none placeholder:text-white/50"
          />
        </div>
        <div className="glass-panel grid max-h-[60vh] grid-cols-4 gap-3 overflow-auto rounded-2xl p-4 sm:grid-cols-6">
          {apps.map((app) => {
            const Icon = app.iconSvg ?? app.icon;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => {
                  openApp(app.id);
                  onClose();
                  setQ("");
                }}
                className="flex flex-col items-center gap-1 rounded-xl p-2 text-white transition hover:bg-white/10"
              >
                <span className="launch-tile grid h-12 w-12 place-items-center rounded-xl">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-center text-[11px] leading-tight">
                  {t(app.titleKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
