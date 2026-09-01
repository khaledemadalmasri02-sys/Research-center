import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  Database,
  Home,
  FileText,
  Eraser,
  Users,
  ClipboardCheck,
  Image as ImageIcon,
  Download,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  Search,
  Activity,
  History,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth, canEdit, canAdmin } from "../auth/AuthContext";
import { useI18n } from "../i18n";

type RawNavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  show: (u: ReturnType<typeof useAuth>["user"]) => boolean;
};

const NAV: RawNavItem[] = [
  { to: "/", labelKey: "navHome", icon: Home, show: () => true },
  { to: "/consent", labelKey: "navConsent", icon: FileText, show: (u) => !!u },
  { to: "/deidentify", labelKey: "navDeidentify", icon: Eraser, show: (u) => canEdit(u) },
  { to: "/cohort", labelKey: "navCohort", icon: Users, show: (u) => !!u },
  { to: "/validation", labelKey: "navValidation", icon: ClipboardCheck, show: (u) => !!u },
  { to: "/dicom", labelKey: "navDicom", icon: ImageIcon, show: (u) => !!u },
  { to: "/export", labelKey: "navExport", icon: Download, show: (u) => !!u },
  { to: "/studies", labelKey: "navStudies", icon: Database, show: (u) => !!u },
  { to: "/ml", labelKey: "navMl", icon: BarChart3, show: (u) => canEdit(u) },
  { to: "/reports", labelKey: "navReports", icon: BarChart3, show: (u) => !!u },
  { to: "/gdpr", labelKey: "navGdpr", icon: ShieldCheck, show: (u) => canAdmin(u) },
  { to: "/audit", labelKey: "navAudit", icon: ShieldAlert, show: (u) => canAdmin(u) },
  { to: "/search", labelKey: "navSearch", icon: Search, show: (u) => !!u },
  { to: "/activity", labelKey: "navActivity", icon: Activity, show: (u) => canAdmin(u) },
  { to: "/activity/me", labelKey: "navMyActivity", icon: History, show: (u) => !!u },
  { to: "/admin", labelKey: "navAdmin", icon: Settings, show: (u) => canAdmin(u) },
];

function useDarkMode() {
  const [dark, setDark] = React.useState<boolean>(() => {
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return document.documentElement.classList.contains("dark");
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, setDark };
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function SidebarHeader({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-12 items-center justify-between px-3">
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.1 }}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <Database className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="truncate text-sm font-bold uppercase tracking-wide text-gray-800 dark:text-gray-100">
              {t("appName")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-gray-400 dark:hover:bg-slate-800"
      >
        <PanelIcon />
      </button>
    </div>
  );
}

function SidebarUser({ expanded }: { expanded: boolean }) {
  const { user } = useAuth();
  const name = user?.username ?? "Guest";
  return (
    <div className={expanded ? "flex items-center gap-3 px-3 py-2" : "flex justify-center px-0 py-2"}>
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-100 text-sm font-semibold text-violet-700 ring-1 ring-violet-200">
        {name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
      </span>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.1 }}
            className="min-w-0 flex-1 leading-tight"
          >
            <p className="truncate text-sm font-bold text-gray-800 dark:text-gray-100">{name}</p>
            <p className="truncate text-xs font-medium text-gray-400">{user ? "Member" : "Guest"}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarRow({
  to,
  end,
  label,
  icon: Icon,
  active,
  expanded,
  index,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: LucideIcon;
  active: boolean;
  expanded: boolean;
  index: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-current={active ? "page" : undefined}
      title={!expanded ? label : undefined}
      className={({ isActive }) =>
        [
          "group relative flex w-full items-center rounded-xl py-2.5 text-sm font-medium outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          expanded ? "gap-3 px-3" : "justify-center",
          isActive ? "" : "hover:bg-gray-100 dark:hover:bg-slate-800",
        ].join(" ")
      }
    >
      {active && expanded && (
        <>
          <motion.span
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl bg-violet-50 dark:bg-violet-500/15"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
          <motion.span
            layoutId="sidebar-active-bar"
            className="absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l-full bg-violet-600"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        </>
      )}
      {active && !expanded && (
        <span className="absolute inset-x-2 inset-y-1 rounded-xl bg-violet-50 dark:bg-violet-500/15" />
      )}
      <Icon
        className={[
          "relative z-10 h-5 w-5 shrink-0 transition-colors",
          active ? "text-violet-600" : "text-gray-400 group-hover:text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-200",
        ].join(" ")}
        strokeWidth={2}
      />
      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 + index * 0.025 }}
            className={[
              "relative z-10 truncate whitespace-nowrap font-semibold",
              active ? "text-violet-600" : "text-gray-400 group-hover:text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-200",
              active && "font-bold",
            ].join(" ")}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </NavLink>
  );
}

function LogoutRow({
  label,
  expanded,
  index,
  onLogout,
}: {
  label: string;
  expanded: boolean;
  index: number;
  onLogout: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLogout}
      title={!expanded ? label : undefined}
      className={[
        "group relative flex w-full items-center rounded-xl py-2.5 text-sm font-medium outline-none transition-colors hover:bg-rose-50",
        "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        expanded ? "gap-3 px-3" : "justify-center",
      ].join(" ")}
    >
      <LogOut className="relative z-10 h-5 w-5 shrink-0 text-gray-400 transition-colors group-hover:text-rose-500" strokeWidth={2} />
      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 + index * 0.025 }}
            className="relative z-10 truncate whitespace-nowrap font-semibold text-gray-400 group-hover:text-rose-500"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function DarkModeRow({ dark, expanded, onToggle, index }: { dark: boolean; expanded: boolean; onToggle: () => void; index: number }) {
  return (
    <div className={["group relative flex w-full items-center rounded-xl py-2.5 hover:bg-gray-100 dark:hover:bg-slate-800", expanded ? "gap-3 px-3" : "justify-center"].join(" ")}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle dark mode"
        className={["flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg", !expanded && "justify-center"].join(" ")}
      >
        <span className={["flex h-5 w-5 shrink-0 items-center justify-center transition-colors", dark ? "text-violet-600" : "text-gray-400"].join(" ")}>
          {dark ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          )}
        </span>
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: "easeOut", delay: 0.08 + index * 0.025 }}
              className="truncate whitespace-nowrap text-sm font-semibold text-gray-500 dark:text-gray-300"
            >
              Dark Mode
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Toggle dark mode"
        onClick={onToggle}
        className={["relative z-10 ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white", dark ? "bg-violet-600" : "bg-gray-300", !expanded && "ml-0"].join(" ")}
      >
        <motion.span animate={{ x: dark ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 32 }} className="mx-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { dark, setDark } = useDarkMode();
  const isActiveFor = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
  const [expanded, setExpanded] = React.useState<boolean>(() => {
    const stored = localStorage.getItem("sidebar-expanded");
    return stored != null ? stored === "true" : false;
  });

  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-expanded", String(next));
      return next;
    });
  }, []);

  const items = NAV.filter((n) => n.show(user));
  const handleLogout = React.useCallback(() => {
    logout().then(() => navigate("/login"));
  }, [logout, navigate]);

  return (
    <motion.aside
      animate={{ width: expanded ? 280 : 64 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="hidden h-full shrink-0 flex-col overflow-hidden rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5 md:flex dark:bg-slate-900 dark:ring-white/10"
    >
      <SidebarHeader expanded={expanded} onToggle={toggleExpanded} />
      <SidebarUser expanded={expanded} />
      <div className="mx-2 my-1 h-px bg-gray-200 dark:bg-slate-700" />

      <nav className="flex-1 overflow-y-auto py-1">
        {items.map((item, i) => (
          <SidebarRow
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            label={t(item.labelKey)}
            icon={item.icon}
            index={i}
            active={isActiveFor(item.to)}
            expanded={expanded}
          />
        ))}
        <LogoutRow label={t("logout")} index={items.length} expanded={expanded} onLogout={handleLogout} />
      </nav>

      <div className="mx-2 mb-1 mt-1 h-px bg-gray-200 dark:bg-slate-700" />
      <div className="py-1">
        <DarkModeRow dark={dark} expanded={expanded} onToggle={() => setDark((d) => !d)} index={items.length + 1} />
      </div>
    </motion.aside>
  );
}

export default Sidebar;
