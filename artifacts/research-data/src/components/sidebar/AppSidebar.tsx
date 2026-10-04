import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { OPEN_COMMAND_PALETTE_EVENT, openCommandPalette } from "@/components/command-palette-events";
import { useTheme } from "next-themes";
import { useOptionalThemePreset } from "@/components/desktop/theme-preset-context";
import {
  Activity as ActivityIcon,
  GraduationCap,
  HelpCircle,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DURATION,
  EASE_OUT,
  MAX_STAGGERED_CHILDREN,
  SPRING,
  cappedStagger,
  layoutTransition,
  shouldReduceMotion,
  useMotionPrefs,
} from "@/lib/motion";
import { useAuth } from "@/hooks/use-auth";
import { openProductTour } from "@/hooks/use-product-tour";
import { useIsTablet } from "@/hooks/use-mobile";
import { NotificationBell } from "@/components/notification-bell";
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
  /** Anchor for the product tour. `null` for non-navigational rows. */
  tourKey?: string | null;
};

/* -------------------------------------------------------------------------- *
 * Motion
 * -------------------------------------------------------------------------- */

/** Indicator + toggle springs: zeta ~0.89, settles ~150ms, <1% overshoot. */
const PILL_SPRING = SPRING.snappy;
/** Press feedback. `SPRING.snappy` is documented as the press spring. */
const PRESS_SPRING = SPRING.snappy;

/**
 * Label cascade budget, seconds.
 *
 * `cappedStagger` divides a fixed budget by the item count (and saturates at
 * MAX_STAGGERED_CHILDREN, so an unbounded list cannot grow the delay), but its
 * default budget is 0.2s. At `DURATION.fast` per label that put the last of 13
 * rows finishing at ~0.56s — the sidebar looked like it was still loading
 * after you had already read the first row. 0.06s + 0.18s = 0.24s for the last
 * label to settle, on every list length.
 */
const LABEL_STAGGER_BUDGET_S = 0.06;
const LABEL_DURATION = DURATION.fast;

const WIDTH_EXPANDED = 280;
const WIDTH_COLLAPSED = 64;

/**
 * Stagger index -> delay, capped by a total budget.
 *
 * The previous `0.08 + index * 0.025` grew without bound: with the admin nav
 * appended on a 13-row sidebar the last label started ~370ms after the toggle
 * and the sidebar looked like it was still loading. The delay is now
 * `index * step` where `step` shrinks as the list grows, so the whole column is
 * in within LABEL_STAGGER_BUDGET_S + LABEL_DURATION regardless of item count.
 */
function staggerDelay(index: number, count: number): number {
  if (count <= 1) return 0;
  const step = cappedStagger(count, LABEL_STAGGER_BUDGET_S);
  return Math.min(index, MAX_STAGGERED_CHILDREN - 1) * step;
}

/**
 * Label entrance. Scale, not translate: the previous `x: -10` slid every
 * label in from the left, which is backwards in RTL (Arabic reads the same way
 * but the sidebar is mirrored to the right, so content slid in *from the
 * outside edge* and looked like it was escaping). Scale + opacity is direction
 * agnostic and `transform`-only, so it never triggers reflow.
 */
function labelMotion(reducedMotion: boolean, delay: number) {
  return {
    initial: reducedMotion ? (false as const) : { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: reducedMotion ? undefined : { opacity: 0, scale: 0.96 },
    transition: { duration: LABEL_DURATION, ease: EASE_OUT, delay },
  };
}

function SidebarDivider() {
  return <div className="mx-2 my-1 h-px bg-border" />;
}

function SidebarHeader({
  expanded,
  reducedMotion,
  onToggle,
  collapseLabel,
  expandLabel,
  searchLabel,
  openPalette,
}: {
  expanded: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
  collapseLabel: string;
  expandLabel: string;
  searchLabel: string;
  openPalette: () => void;
}) {
  return (
    <div className="flex h-12 items-center justify-between gap-2 px-3">
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            {...labelMotion(reducedMotion, 0)}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-brand)] text-white shadow-sm">
              <ActivityIcon className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="truncate text-sm font-bold uppercase tracking-wide text-foreground">
              MedResearch
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex shrink-0 items-center gap-1">
        {/* The ⌘K shortcut existed but was undiscoverable: nothing in the UI
            hinted that a command palette was available. */}
        <motion.button
          type="button"
          onClick={openPalette}
          title={searchLabel}
          aria-label={searchLabel}
          data-tour="commandPalette"
          whileHover={reducedMotion ? undefined : { scale: 1.04 }}
          whileTap={reducedMotion ? undefined : { scale: 0.94 }}
          transition={PRESS_SPRING}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:ring-offset-slate-900"
        >
          <Search className="h-5 w-5" />
        </motion.button>
        <motion.button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? collapseLabel : expandLabel}
          whileTap={reducedMotion ? undefined : { scale: 0.94 }}
          transition={PRESS_SPRING}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:ring-offset-slate-900"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </motion.button>
      </div>
    </div>
  );
}

function SidebarUser({
  expanded,
  reducedMotion,
  name,
  role,
}: {
  expanded: boolean;
  reducedMotion: boolean;
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
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-foreground ring-1 ring-[var(--accent-brand)]">
        {name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>

      <AnimatePresence>
        {expanded && (
          <motion.div
            {...labelMotion(reducedMotion, 0.02)}
            className="min-w-0 flex-1 leading-tight"
          >
            <p className="truncate text-sm font-bold text-foreground">{name}</p>
            <p className="truncate text-xs font-medium text-muted-foreground">{role}</p>
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
  reducedMotion,
  itemCount,
  index,
  onSelect,
}: {
  item: SidebarItem;
  active: boolean;
  expanded: boolean;
  reducedMotion: boolean;
  itemCount: number;
  index: number;
  onSelect: (id: string) => void;
}) {
  const Icon = item.icon;
  const isLogout = item.variant === "logout";
  const labelColor = active
    ? "text-[var(--accent-brand)]"
    : isLogout
    ? "text-gray-400 group-hover:text-rose-500 dark:text-gray-400 dark:group-hover:text-rose-500"
    : "text-gray-600 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-200";
  const iconColor = active
    ? "text-[var(--accent-brand)]"
    : isLogout
      ? "text-gray-400 group-hover:text-rose-500"
      : "text-gray-500 group-hover:text-gray-900";

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      data-tour={item.tourKey ?? undefined}
      title={!expanded ? item.label : undefined}
      /* Press feedback only — 2% is enough to feel the click. `scale` on a
         button is compositor-only, so no reflow of the 13-row column. */
      whileTap={reducedMotion ? undefined : { scale: 0.97 }}
      transition={PRESS_SPRING}
      className={cn(
        "group relative flex w-full items-center rounded-xl py-2.5 text-sm font-medium outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:ring-offset-slate-900",
        expanded ? "gap-3 px-3" : "justify-center",
        !active && (isLogout ? "hover:bg-rose-50 dark:hover:bg-rose-500/10" : "hover:bg-gray-100 dark:hover:bg-slate-800"),
      )}
    >
      {active && expanded && (
        <>
          {/* Shared-layout indicator. `layoutId` moves a box between two
              different DOM parents, which is exactly the case
              MotionConfig reducedMotion="user" does NOT suppress — so it is
              gated explicitly here. Without the gate the pill would glide for
              users who asked it not to, while every fade in the app was
              correctly suppressed. With reduced motion the same box is
              rendered inline (still marked `data-active-pill`) so nothing
              teleports and no layout transition runs. */}
          <motion.span
            layoutId={reducedMotion ? undefined : "sidebar-active-pill"}
            data-active-pill=""
            className="absolute inset-0 rounded-xl bg-[var(--accent-brand)]/10 dark:bg-[var(--accent-brand)]/15"
            transition={layoutTransition(reducedMotion, PILL_SPRING)}
          />
          <motion.span
            layoutId={reducedMotion ? undefined : "sidebar-active-bar"}
            data-active-bar=""
            /* `end-0` is a logical property: it resolves to `right` in LTR and
                `left` in RTL, so the rail follows the reading edge without a
                direction branch. The previous `x: 16` thumb below is the one
                place that genuinely needed mirroring, and it is handled there
                with the i18n direction. */
            className="absolute end-0 top-1.5 bottom-1.5 w-[3px] rounded-s-full bg-[var(--accent-brand)]"
            transition={layoutTransition(reducedMotion, PILL_SPRING)}
          />
        </>
      )}

      {active && !expanded && (
        /* Same token as the expanded pill. The previous `bg-violet-50` meant
           the indicator changed colour as the sidebar collapsed, which read as
           a state change rather than a resize. */
        <span
          data-active-pill=""
          className="absolute inset-x-2 inset-y-1 rounded-xl bg-[var(--accent-brand)]/10 dark:bg-[var(--accent-brand)]/15"
        />
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
            {...labelMotion(reducedMotion, staggerDelay(index, itemCount))}
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
    </motion.button>
  );
}

function DarkModeRow({
  dark,
  expanded,
  isRtl,
  reducedMotion,
  onToggle,
  index,
  count,
  label,
}: {
  dark: boolean;
  expanded: boolean;
  isRtl: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
  index: number;
  count: number;
  label: string;
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
        aria-label={label}
        className={cn(
          "flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] rounded-lg",
          !expanded && "justify-center",
        )}
      >
          {/* Sun/moon cross-fade instead of a hard swap. Both stay mounted
              (a `conditional ? A : B` would pop), stacked and scaled, so the
              outgoing icon shrinks away as the incoming one grows — including
              its rotation, which is the only part that needs `transform`. */}
          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <motion.span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center"
              initial={false}
              animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.6 : 1, rotate: dark ? -60 : 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: DURATION.fast, ease: EASE_OUT }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            </motion.span>
            <motion.span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center"
              initial={false}
              animate={{ opacity: dark ? 1 : 0, scale: dark ? 1 : 0.6, rotate: dark ? 0 : 60 }}
              transition={reducedMotion ? { duration: 0 } : { duration: DURATION.fast, ease: EASE_OUT }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            </motion.span>
          </span>

        <AnimatePresence>
          {expanded && (
            <motion.span
              {...labelMotion(reducedMotion, staggerDelay(index, count))}
              className="truncate whitespace-nowrap text-sm font-semibold text-muted-foreground"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={label}
        data-tour="theme"
        onClick={onToggle}
        className={cn(
          "relative z-10 ms-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 dark:ring-offset-slate-900",
          dark ? "bg-[var(--accent-brand)]" : "bg-gray-300",
          !expanded && "ms-0",
        )}
      >
        <motion.span
          // RTL flip: in LTR the thumb slides right (16px); in RTL it
          // slides left (-16px).
          animate={{ x: dark ? (isRtl ? -16 : 16) : 0 }}
          transition={PILL_SPRING}
          className="mx-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </button>
    </div>
  );
}

export function AppSidebar({ items }: AppSidebarProps) {
  const [location, navigate] = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const presetCtx = useOptionalThemePreset();
  const preset = presetCtx?.preset;
  const toggleTheme = presetCtx?.toggleTheme ?? (() => setTheme(theme === "dark" ? "light" : "dark"));
  const { username, logout, canAdminAccess } = useAuth();
  const isRtl = (i18n.dir() ?? "ltr") === "rtl";
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  const isTablet = useIsTablet();

  const [expanded, setExpanded] = React.useState<boolean>(() => {
    const stored = localStorage.getItem("sidebar-expanded");
    if (stored != null) return stored === "true";
    // Default: expanded on a desktop, collapsed on the tablet tier. At
    // 768–1279px a 280px sidebar costs ~22% of the reading width on the
    // patient table, which is the page clinicians use most. Nothing is
    // persisted until the user makes a choice.
    return !isTablet;
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
      tourKey: i.key,
    })),
    { id: "logout", label: t("nav.signOut"), icon: LogOut, variant: "logout", tourKey: null },
  ];

  return (
    /* Width is animated by CSS, not by framer.
       `animate={{ width }}` on the <aside> put a 280px layout box through
       0.3s of continuous reflow while ALSO driving every label's entrance from
       the same state change, so the two effects fought each other for 300ms.
       Now the container owns exactly one animating property (`width`, 220ms)
       and the labels animate their own opacity/scale independently
       (`labelMotion`) — they no longer wait on, or inherit, the container's
       tween. Reduced motion gets no transition at all.
       A resizable sidebar cannot avoid a width layout animation; the point is
       that it is now one property on one element instead of a measurement
       storm across the icon column, every label and the main column beside it. */
    <aside
      data-print="chrome"
      data-collapsed={expanded ? undefined : "true"}
      style={{
        width: expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED,
        transitionProperty: "width",
        transitionTimingFunction: `cubic-bezier(${EASE_OUT.join(",")})`,
        transitionDuration: reducedMotion ? "0ms" : `${Math.round(DURATION.base * 1000)}ms`,
      }}
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/5 motion-reduce:transition-none dark:bg-slate-900 dark:ring-white/10"
    >
      <SidebarHeader
        expanded={expanded}
        reducedMotion={reducedMotion}
        onToggle={toggleExpanded}
        collapseLabel={t("a11y.closeMenu")}
        expandLabel={t("a11y.openMenu")}
        searchLabel={t("commandPalette.placeholder")}
        openPalette={openCommandPalette}
      />

      <SidebarUser
        expanded={expanded}
        reducedMotion={reducedMotion}
        name={username ?? t("auth.mobileWelcome")}
        role={canAdminAccess ? t("nav.admin") : t("nav.member")}
      />

      <SidebarDivider />

      <nav aria-label={t("a11y.mainNavigation")} className="flex-1 overflow-y-auto py-1">
        {mappedItems.map((item, i) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            index={i}
            itemCount={mappedItems.length}
            active={item.id === activeKey}
            expanded={expanded}
            reducedMotion={reducedMotion}
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
          <motion.button
            type="button"
            onClick={() => openProductTour()}
            title={t("tutor.title")}
            aria-label={t("tutor.title")}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            transition={PRESS_SPRING}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] dark:text-gray-400 dark:hover:bg-slate-800"
          >
            <GraduationCap className="h-5 w-5" />
          </motion.button>
          <span title={t("nav.notifications")}>
            <NotificationBell />
          </span>
          <span title={t("nav.language")}>
            <LanguageSwitcher />
          </span>
          <motion.button
            type="button"
            onClick={() => openProductTour()}
            title={t("tour.replay")}
            aria-label={t("tour.replay")}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            transition={PRESS_SPRING}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 dark:text-gray-400"
          >
            <HelpCircle className="h-5 w-5" />
          </motion.button>
        </div>

        <DarkModeRow
          dark={dark}
          expanded={expanded}
          isRtl={isRtl}
          reducedMotion={reducedMotion}
          onToggle={toggleTheme}
          index={mappedItems.length}
          count={mappedItems.length + 1}
          label={t("nav.darkMode")}
        />
      </div>
    </aside>
  );
}

export default AppSidebar;