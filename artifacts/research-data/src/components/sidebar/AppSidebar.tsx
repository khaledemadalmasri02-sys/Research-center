import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import {
  Activity as ActivityIcon,
  GraduationCap,
  HelpCircle,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { openProductTour } from "@/hooks/use-product-tour";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export type RawNavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
};

type AppSidebarProps = {
  items: RawNavItem[];
};

type SidebarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  variant?: "default" | "logout";
};

function SidebarDivider() {
  return <div className="mx-2 my-1 h-px bg-gray-200 dark:bg-slate-700" />;
}

function SidebarHeader({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
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
              <ActivityIcon className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="truncate text-sm font-bold uppercase tracking-wide text-gray-800 dark:text-gray-100">
              MedResearch
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 outline-none transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:ring-offset-slate-900 dark:ring-offset-slate-900"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>
    </div>
  );
}

function SidebarUser({
  expanded,
  name,
  role,
}: {
  expanded: boolean;
  name: string;
  role: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-xl py-2",
        expanded ? "gap-3 px-3" : "justify-center px-0",
      )}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-100 text-sm font-semibold text-violet-700 ring-1 ring-violet-200">
        {name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
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
            <p className="truncate text-xs font-medium text-gray-400">{role}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarNavItem({
  item,
  active,
  expanded,
  index,
  onSelect,
}: {
  item: SidebarItem;
  active: boolean;
  expanded: boolean;
  index: number;
  onSelect: (id: string) => void;
}) {
  const Icon = item.icon;
  const isLogout = item.variant === "logout";
  const labelColor = active
    ? "text-violet-600"
    : isLogout
    ? "text-gray-400 group-hover:text-rose-500 dark:text-gray-400 dark:group-hover:text-rose-500"
    : "text-gray-400 group-hover:text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-200";
  const iconColor = active
    ? "text-violet-600"
    : isLogout
      ? "text-gray-400 group-hover:text-rose-500"
      : "text-gray-400 group-hover:text-gray-600";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      title={!expanded ? item.label : undefined}
      className={cn(
        "group relative flex w-full items-center rounded-xl py-2.5 text-sm font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        expanded ? "gap-3 px-3" : "justify-center",
        !active && (isLogout ? "hover:bg-rose-50 dark:hover:bg-rose-500/10" : "hover:bg-gray-100 dark:hover:bg-slate-800"),
      )}
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
        className={cn(
          "relative z-10 h-5 w-5 shrink-0 transition-colors",
          iconColor,
        )}
        strokeWidth={2}
      />

      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{
              duration: 0.2,
              ease: "easeOut",
              delay: 0.08 + index * 0.025,
            }}
            className={cn(
              "relative z-10 truncate whitespace-nowrap font-semibold",
              labelColor,
              active && "font-bold",
            )}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function DarkModeRow({
  dark,
  expanded,
  onToggle,
  index,
}: {
  dark: boolean;
  expanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  return (
    <div
      className={cn(
        "group relative flex w-full items-center rounded-xl py-2.5",
        expanded ? "gap-3 px-3" : "justify-center",
        "hover:bg-gray-100 dark:hover:bg-slate-800",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle theme"
        className={cn(
          "flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg",
          !expanded && "justify-center",
        )}
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center transition-colors",
            dark ? "text-violet-600" : "text-gray-400",
          )}
        >
          {dark ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
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
        className={cn(
          "relative z-10 ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          dark ? "bg-violet-600" : "bg-gray-300",
          !expanded && "ml-0",
        )}
      >
        <motion.span
          animate={{ x: dark ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="mx-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </button>
    </div>
  );
}

export function AppSidebar({ items }: AppSidebarProps) {
  const [location, navigate] = useLocation();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { username, logout, canAdminAccess } = useAuth();

  const [expanded, setExpanded] = React.useState<boolean>(() => {
    const stored = localStorage.getItem("sidebar-expanded");
    return stored != null ? stored === "true" : false;
  });

  const dark = theme === "dark";

  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-expanded", String(next));
      return next;
    });
  }, []);

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const activeKey = items.find((i) => isActive(i.href))?.key;

  const handleSelect = React.useCallback(
    (id: string) => {
      if (id === "logout") {
        logout();
        return;
      }
      const item = items.find((i) => i.key === id);
      if (item) navigate(item.href);
    },
    [items, navigate, logout],
  );

  const mappedItems: SidebarItem[] = [
    ...items.map((i) => ({
      id: i.key,
      label: t(`nav.${i.key}`),
      icon: i.icon,
    })),
    { id: "logout", label: t("nav.signOut"), icon: LogOut, variant: "logout" },
  ];

  return (
    <motion.aside
      animate={{ width: expanded ? 280 : 64 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10"
    >
      <SidebarHeader expanded={expanded} onToggle={toggleExpanded} />

      <SidebarUser
        expanded={expanded}
        name={username ?? "Guest"}
        role={canAdminAccess ? "Admin" : "Member"}
      />

      <SidebarDivider />

      <nav className="flex-1 overflow-y-auto py-1">
        {mappedItems.map((item, i) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            index={i}
            active={item.id === activeKey}
            expanded={expanded}
            onSelect={handleSelect}
          />
        ))}
      </nav>

      <SidebarDivider />

      <div className="space-y-1 py-1">
        <div
          className={cn(
            "flex items-center gap-0.5",
            expanded ? "justify-start px-2" : "justify-center",
          )}
        >
          <button
            type="button"
            onClick={() => openProductTour()}
            title={t("tutor.title")}
            aria-label={t("tutor.title")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 outline-none transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <GraduationCap className="h-5 w-5" />
          </button>
          <span title={t("nav.notifications")}>
            <NotificationBell />
          </span>
          <span title={t("nav.language")}>
            <LanguageSwitcher />
          </span>
          <button
            type="button"
            onClick={() => openProductTour()}
            title={t("tour.replay")}
            aria-label={t("tour.replay")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>

        <DarkModeRow
          dark={dark}
          expanded={expanded}
          onToggle={() => setTheme(dark ? "light" : "dark")}
          index={mappedItems.length}
        />
      </div>
    </motion.aside>
  );
}

export default AppSidebar;
