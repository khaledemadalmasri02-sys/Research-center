import { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, canEdit, canAdmin } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { Button } from "./ui";

interface NavItem {
  to: string;
  labelKey: string;
  show: (u: ReturnType<typeof useAuth>["user"]) => boolean;
}

const NAV: NavItem[] = [
  { to: "/", labelKey: "navHome", show: () => true },
  { to: "/consent", labelKey: "navConsent", show: (u) => !!u },
  { to: "/deidentify", labelKey: "navDeidentify", show: (u) => canEdit(u) },
  { to: "/cohort", labelKey: "navCohort", show: (u) => !!u },
  { to: "/validation", labelKey: "navValidation", show: (u) => !!u },
  { to: "/dicom", labelKey: "navDicom", show: (u) => !!u },
  { to: "/export", labelKey: "navExport", show: (u) => !!u },
  { to: "/studies", labelKey: "navStudies", show: (u) => !!u },
  { to: "/ml", labelKey: "navMl", show: (u) => canEdit(u) },
  { to: "/reports", labelKey: "navReports", show: (u) => !!u },
  { to: "/gdpr", labelKey: "navGdpr", show: (u) => canAdmin(u) },
  { to: "/audit", labelKey: "navAudit", show: (u) => canAdmin(u) },
  { to: "/search", labelKey: "navSearch", show: (u) => !!u },
  { to: "/activity", labelKey: "navActivity", show: (u) => canAdmin(u) },
  { to: "/activity/me", labelKey: "navMyActivity", show: (u) => !!u },
  { to: "/admin", labelKey: "navAdmin", show: (u) => canAdmin(u) },
];

export function Layout({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const items = NAV.filter((n) => n.show(user));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-e border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 md:block">
        <div className="mb-4 px-2 text-lg font-bold">{t("appName")}</div>
        <nav className="flex flex-col gap-1">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`
              }
            >
              {t(n.labelKey)}
            </NavLink>
          ))}
        </nav>
      </aside>

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
                <Button variant="secondary" onClick={() => logout().then(() => navigate("/login"))}>
                  {t("logout")}
                </Button>
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
