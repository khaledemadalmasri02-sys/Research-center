import { Link, useLocation } from "wouter";
import {
  Activity as ActivityIcon,
  LayoutDashboard,
  Users,
  BarChart3,
  UserPlus,
  LogOut,
  Database,
  ShieldAlert,
  FileText,
  MessageSquare,
  History,
  KeyRound,
  Monitor,
  MoreHorizontal,
  LayoutGrid,
  HelpCircle,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { isDesktopMode } from "@/lib/desktop-mode";
import { useTranslation } from "react-i18next";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { openProductTour } from "@/hooks/use-product-tour";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationBell } from "@/components/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  key: string;
  href: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { username, logout, canAdminAccess } = useAuth();
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  // Inside a desktop window the window chrome already provides the title bar /
  // navigation, so render the page content bare (no sidebar / top nav).
  if (isDesktopMode()) {
    return <main className="h-full overflow-auto p-4 md:p-6">{children}</main>;
  }

  const mainNav: NavItem[] = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "patients", href: "/patients", icon: Users },
    { key: "collections", href: "/collections", icon: FileText },
    { key: "dataAnalysis", href: "/data-analysis", icon: BarChart3 },
    { key: "feedback", href: "/feedback", icon: MessageSquare },
    { key: "moreFeatures", href: "/more-features", icon: LayoutGrid },
  ];

  const adminNav: NavItem[] = canAdminAccess
    ? [
        { key: "database", href: "/database", icon: Database, adminOnly: true },
        { key: "admin", href: "/admin", icon: ShieldAlert, adminOnly: true },
        { key: "activity", href: "/activity", icon: ActivityIcon, adminOnly: true },
      ]
    : [];

  const utilityNav: NavItem[] = [
    { key: "myActivity", href: "/activity/me", icon: History },
    { key: "apiTokens", href: "/api-tokens", icon: KeyRound },
    { key: "sessions", href: "/sessions", icon: Monitor },
    { key: "newPatient", href: "/patients/new", icon: UserPlus },
  ];

  const allNav = [...mainNav, ...adminNav, ...utilityNav];

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between px-3 h-14 border-b border-border bg-card">
          <div className="flex items-center gap-2 text-primary font-bold">
            <ActivityIcon className="h-5 w-5" />
            <span>MedResearch</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-muted-foreground"
              title={t("tutor.title")}
              aria-label={t("tutor.title")}
              onClick={() => openProductTour()}
            >
              <GraduationCap className="h-5 w-5" />
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <LanguageSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground" title={t("nav.more")}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {allNav
                  .filter((i) => !mainNav.includes(i))
                  .map((item) => (
                    <DropdownMenuItem key={item.key} asChild>
                      <Link href={item.href} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {t(`nav.${item.key}`)}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem onClick={() => logout()} className="text-destructive">
                  <LogOut className="h-4 w-4" />
                  {t("nav.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-24">{children}</main>

        <nav className="fixed bottom-0 inset-x-0 z-20 h-16 border-t border-border bg-card flex justify-around items-stretch">
          {mainNav.map((item) => {
          const active = isActive(item.href);
          return (
          <Link key={item.key} href={item.href} data-tour={item.key}>
          <motion.div
          className={cn(
          "relative flex flex-col items-center justify-center gap-1 h-16 w-16 text-[11px] font-medium",
          active ? "text-primary" : "text-muted-foreground",
          )}
            whileTap={{ scale: 0.9 }}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 400, damping: 24 }}
          >
            {active && (
                <motion.span
                    layoutId="sidebar-active"
                    className="absolute top-1 bottom-1 w-10 rounded-md bg-primary/10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <item.icon className={cn("relative z-10 h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                <span className="relative z-10 leading-none">{t(`nav.${item.key}`)}</span>
              </motion.div>
            </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row">
      <AppSidebar items={allNav} />

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
