import { Link, useLocation } from "wouter";
import {
  Activity as ActivityIcon,
  LayoutDashboard,
  Users,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "@/components/theme-toggle";
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

  const mainNav: NavItem[] = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "patients", href: "/patients", icon: Users },
    { key: "collections", href: "/collections", icon: FileText },
    { key: "feedback", href: "/feedback", icon: MessageSquare },
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

  const Toggles = (
    <div className="flex items-center gap-0.5">
      <NotificationBell />
      <ThemeToggle />
      <LanguageSwitcher />
    </div>
  );

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between px-3 h-14 border-b border-border bg-card">
          <div className="flex items-center gap-2 text-primary font-bold">
            <ActivityIcon className="h-5 w-5" />
            <span>MedResearch</span>
          </div>
          <div className="flex items-center gap-0.5">
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
              <Link key={item.key} href={item.href}>
                <div
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 h-16 w-16 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <item.icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="leading-none">{t(`nav.${item.key}`)}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row">
      <div className="w-full md:w-64 shrink-0 h-full border-r border-border bg-card flex flex-col sticky top-0">
        <div className="h-16 flex items-center justify-between px-6 border-b border-border text-primary font-bold gap-2">
          <div className="flex items-center gap-2">
            <ActivityIcon className="h-6 w-6" />
            <span className="text-lg">MedResearch</span>
          </div>
          <div className="md:hidden flex items-center gap-0.5">{Toggles}</div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {allNav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.key} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <item.icon className={cn("h-5 w-5", active ? "text-primary-foreground" : "text-muted-foreground")} />
                  {t(`nav.${item.key}`)}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground truncate">{username}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive h-11 px-2"
              onClick={() => logout()}
              title={t("nav.signOut")}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-end gap-0.5">{Toggles}</div>
        </div>
      </div>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
