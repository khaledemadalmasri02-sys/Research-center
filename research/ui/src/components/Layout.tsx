import { ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { Button } from "./ui";
import { Sidebar } from "./Sidebar";

export function Layout({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      <Sidebar />

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-sm font-medium md:hidden">{t("appName")}</div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
            >
              {lang === "en" ? "العربية" : "EN"}
            </button>
            {user ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">{user.username}</span>
              </span>
            ) : (
              <Button onClick={() => navigate("/login")}>{t("login")}</Button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
