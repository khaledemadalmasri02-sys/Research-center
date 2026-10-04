import { useEffect, useMemo, useRef } from "react";
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
import { SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useIsMobile, useIsTablet } from "@/hooks/use-mobile";
import { useIsDesktopMode } from "@/lib/desktop-mode";
import { useTranslation } from "react-i18next";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SoundToggle } from "@/components/sound-toggle";
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

/**
 * Spring for the bottom-nav indicator and row micro-motion. `SPRING.snappy` is
 * zeta ~0.89: physical, settles in ~150ms, overshoots by under 1%. An
 * oscillating nav bar reads as broken on a clinical tool, so nothing springier
 * than this belongs on a control people hit dozens of times an hour.
 */
const NAV_SPRING = SPRING.snappy;

/**
 * Collapse a route to its "section" so in-record navigation
 * (`/patients/123` -> `/patients/124`, `/records/2/9` -> `/records/2/10`)
 * does NOT count as a page change. Those transitions keep the user on the
 * same screen, so yanking focus to `#main-content` would be actively harmful:
 * focus would leave the "Next patient" button they just pressed.
 */
function normalizePath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const kept = segments.filter((s) => !/^\d+$/.test(s) && !/^[0-9a-f]{16,}$/i.test(s));
  return kept.length === 0 ? "/" : `/${kept.join("/")}`;
}

/**
 * Resolve the focus target, skipping route layers that are mid-exit.
 *
 * `AnimatedRoutes` keeps the outgoing page mounted for 180ms so the two can
 * cross-fade, which means the document transiently contains one
 * `#main-content` per page. `getElementById` would return the FIRST one — the
 * page that is on its way out — and focus would be destroyed the moment it
 * unmounted, stranding the keyboard user on `<body>`. The exiting layer is
 * marked `inert`, so it is both excluded here and unfocusable natively.
 * The newest live element wins, which also disambiguates the desktop shell's
 * one-`#main-content`-per-window case.
 *
 * Exported for `tests/route-transition-vitest.test.tsx`: this is the contract
 * that keeps a keyboard user off a page that is about to disappear, and it is
 * not observable from the outside once focus has already been moved.
 */
export function activeMain(): HTMLElement | null {
  const mains = Array.from(document.querySelectorAll<HTMLElement>("#main-content"));
  const live = mains.filter((m) => m.closest("[data-route-state='exiting']") === null);
  const pool = live.length > 0 ? live : mains;
  return pool[pool.length - 1] ?? null;
}

/**
 * Move focus to `#main-content` on route change so keyboard and screen-reader
 * users are not left on a stale control after a client-side navigation.
 * The element already carries `tabIndex={-1}`.
 */
function useRouteFocus() {
  const [location] = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const current = normalizePath(location);
    const prior = previous.current;
    previous.current = current;

    // Skip the very first render: stealing focus on mount would scroll the
    // window and hide the skip link from sighted keyboard users.
    if (prior === null || prior === current) return;

    // Two frames, not one. The first lets the new page's nodes commit; the
    // second lands after the outgoing layer has been marked `inert`, so the
    // browser cannot refuse the focus() call for landing on an inert subtree.
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        activeMain()?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [location]);
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { username, logout, canAdminAccess } = useAuth();
  const isMobile = useIsMobile();
  /** 768–1279px: desktop chrome, but no room for a 280px sidebar next to a
   *  readable record. See `hooks/use-mobile.tsx` for the tier definition. */
  const isTablet = useIsTablet();
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  const { t } = useTranslation();
  /* Reactive: `isDesktopMode()` is a one-shot hostname check, so a rotate
   * past 767px would keep the wrong chrome. Call the hook unconditionally. */
  const isDesktop = useIsDesktopMode();

  useRouteFocus();

  // Inside a desktop window the window chrome already provides the title bar /
  // navigation, so render the page content bare (no sidebar / top nav).
  if (isDesktop) {
    return <main id="main-content" tabIndex={-1} className="h-full overflow-auto p-4 md:p-6">{children}</main>;
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

/* Phone AND tablet both get the single-column shell: at 768–1279px a
     persistent 280px sidebar plus a data table leaves too little width to read
     a patient record, and the bottom nav is reachable with a thumb in
     landscape. `AppSidebar` collapses itself on the tablet tier, so the
     desktop chrome is still one tap away in the "More" menu. */
  if (isMobile || isTablet) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header data-print="chrome" className="print:hidden sticky top-0 z-20 flex items-center justify-between px-3 min-h-14 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
          <Link
            href="/"
            aria-label={t("nav.dashboard", "Dashboard")}
            className="flex items-center gap-2 text-primary font-bold"
          >
            <ActivityIcon className="h-5 w-5" />
            <span>MedResearch</span>
          </Link>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-muted-foreground"
              title={t("tutor.title")}
              aria-label={t("tutor.title")}
              onClick={() => openProductTour()}
            >
              <GraduationCap className="h-5 w-5" />
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <SoundToggle />
            <LanguageSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 text-muted-foreground"
                  title={t("nav.more")}
                  aria-label={t("a11y.openMenu")}
                >
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
                  <LogOut className="h-4 w-4 rtl:rotate-180" />
                  {t("nav.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          /* Tablet reads at ~768–1024: `p-4` only. `pb-28` is kept on both
             tiers so the fixed bottom nav never covers the last row. */
          className="flex-1 overflow-y-auto p-4 pb-28"
        >
          {children}
        </main>

        <nav
          aria-label={t("nav.primary", "Primary")}
          className="print:hidden fixed bottom-0 inset-x-0 z-20 min-h-16 border-t border-border bg-card flex justify-around items-stretch pb-[env(safe-area-inset-bottom)]"
        >
          {mainNav.map((item) => {
          const active = isActive(item.href);
          return (
          <Link
            key={item.key}
            href={item.href}
            data-tour={item.key}
            aria-current={active ? "page" : undefined}
            className="flex-1"
          >
          <motion.div
          className={cn(
          "relative flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium",
          active ? "text-primary" : "text-muted-foreground",
          )}
            /* Press only: this is a touch surface, so there is no hover state
               to reward, and the previous y:-2 hover lift fired on the first
               tap of every press. */
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            transition={NAV_SPRING}
          >
            {/* `layoutId` is a shared-layout transition and is NOT covered by
                MotionConfig reducedMotion="user", so it is gated explicitly —
                otherwise users who asked for reduced motion still get it. */}
            {active && (
                <motion.span
                    layoutId={reducedMotion ? undefined : "sidebar-active"}
                    className="absolute top-1 bottom-1 w-10 rounded-md bg-primary/20 ring-1 ring-primary/30"
                    initial={reducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={NAV_SPRING}
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

  /* >= 1280px: the full chrome. A tablet has already taken the branch above,
     so reaching here means there is genuinely room for a 280px sidebar. */
  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row rtl:md:flex-row-reverse">
      <AppSidebar items={allNav} />

      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}