import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "framer-motion";
import { appIdForHref } from "@/components/desktop/DesktopLink";
import { useDesktopNav } from "@/lib/desktop-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/use-notifications";
import { useLiveAnnouncer } from "@/components/live-region";
import { SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

/** Dropdown entrance: `SPRING.snappy` (zeta ~0.89, settles ~150ms). */
const SNAPPY_SPRING = SPRING.snappy;
/** Badge pop. Same spring, snappier because a badge is 16px tall. */
const BADGE_SPRING = SPRING.snappy;

/** i18next echoes the key back on a miss; announcements must not say it out loud. */
const LOOKS_LIKE_UNRESOLVED_KEY = /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

/**
 * The bell's own ring. `key` is the unread *state*, not the count, so it
 * replays only when the bell crosses from "nothing new" to "something new" —
 * a poll that refetches 4 -> 4 must not re-ring on every 30s interval.
 */
function BellIcon({ hasUnread, reducedMotion }: { hasUnread: boolean; reducedMotion: boolean }) {
  return (
    <motion.span
      key={hasUnread ? "unread" : "read"}
      aria-hidden
      className="flex items-center justify-center"
      initial={false}
      animate={hasUnread && !reducedMotion ? { rotate: [0, -14, 11, -7, 3, 0] } : { rotate: 0 }}
      transition={{ duration: 0.5, times: [0, 0.18, 0.42, 0.62, 0.84, 1], ease: "easeOut" }}
    >
      <Bell className="h-4 w-4" />
    </motion.span>
  );
}

export function NotificationBell() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const desktopNav = useDesktopNav();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const { announce } = useLiveAnnouncer();
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  const [open, setOpen] = useState(false);

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  /**
   * Keep the screen-reader announcement in step with the badge pop. The badge
   * is the only visual signal that something arrived, and a badge that grows
   * silently tells a screen-reader user nothing at all.
   *
   * The previous count is seeded from the first successful fetch and the very
   * first paint is skipped, so opening the app does not announce a backlog.
   * If the i18n keys are missing the message is dropped rather than read out
   * as a dotted identifier.
   */
  const previousUnread = useRef<number | null>(null);
  useEffect(() => {
    const previous = previousUnread.current;
    previousUnread.current = unread;
    if (previous === null || unread === previous) return;
    const message =
      unread > previous
        ? t("notifications.newArrived", { count: unread - previous })
        : t("notifications.markedRead", { count: previous - unread });
    if (!LOOKS_LIKE_UNRESOLVED_KEY.test(message)) announce(message);
  }, [unread, announce, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground relative"
          title={t("notifications.title")}
          aria-label={
            unread > 0
              ? `${t("notifications.title")} (${unread})`
              : t("notifications.title")
          }
          data-tour="notifications"
        >
          <BellIcon hasUnread={unread > 0} reducedMotion={reducedMotion} />
          {unread > 0 && (
            /* `key={unread}` replays the pop for every count change, which is
               the point: the badge is how a clinician notices a result
               arriving, not just that one arrived. Opacity only, plus scale,
               so it never reflows the 36px trigger. */
            <motion.span
              key={unread}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={BADGE_SPRING}
              className="absolute -top-0.5 -end-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold flex items-center justify-center"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </Button>
      </DropdownMenuTrigger>

      {/* Radix primitives directly rather than `DropdownMenuContent`.
          That component's entrance is `data-[state=open]:animate-in
          zoom-in-95`, a CSS keyframe: it cannot be a spring, and overriding
          `animation` from a class name reliably depends on the important
          modifier's Tailwind-version syntax. Dropping those four utility
          classes and owning the motion in framer is deterministic. Positioning,
          typeahead, Escape, arrow-key navigation, focus restore and
          `role="menu"` all still come from Radix.

          Exit stays fast (100ms) on purpose: dismissal is a decision, and a
          spring on the way out leaves a tail behind a choice already made. */}
      <DropdownMenuPrimitive.Portal forceMount>
        <AnimatePresence>
          {open && (
            <DropdownMenuPrimitive.Content
              forceMount
              align="end"
              sideOffset={4}
              className="z-50 max-h-96 w-80 overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              style={{ transformOrigin: "var(--radix-dropdown-menu-content-transform-origin)" }}
            >
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, scale: 0.985 }}
                transition={SNAPPY_SPRING}
                className="flex flex-col"
              >
                <DropdownMenuLabel className="flex items-center justify-between gap-2">
                  <span>{t("notifications.title")}</span>
                  {unread > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => markAll.mutate()}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <CheckCheck className="h-3.5 w-3.5 mr-1" />
                      {t("notifications.markAll")}
                    </Button>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {items.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {t("notifications.empty")}
                  </div>
                ) : (
                  items.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      className="flex flex-col items-start gap-0.5 whitespace-normal"
                      /* Radix menus trap Tab and activate with Enter/Space, firing
                       * onSelect — not onClick. A nested <Link> therefore never
                       * navigates for keyboard users. Drive navigation from
                       * onSelect and suppress the menu's own close+select handling. */
                      onSelect={(e) => {
                        e.preventDefault();
                        if (!n.read) markRead.mutate(n.id);
                        if (!n.link) return;
                        /* On the apex host a bare wouter `navigate()` only rewrites the
                         * address bar — it does not open the target window. Prefer the
                         * desktop window manager when an app is registered for this
                         * href, and fall back to plain navigation otherwise. */
                        const appId = appIdForHref(n.link);
                        if (appId) desktopNav.open(appId, n.link);
                        else navigate(n.link);
                      }}
                    >
                      <span className="flex w-full items-start gap-2">
                        <NotificationRow n={n} />
                        {n.link && (
                          <ExternalLink
                            aria-hidden
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
                          />
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </motion.div>
            </DropdownMenuPrimitive.Content>
          )}
        </AnimatePresence>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenu>
  );
}

function NotificationRow({ n }: { n: { title: string; body: string; read: boolean; createdAt: string } }) {
  return (
    <div className="w-full min-w-0">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${n.read ? "text-muted-foreground" : ""}`}>{n.title}</span>
        {!n.read && <Badge variant="default" className="h-1.5 w-1.5 rounded-full p-0" />}
      </div>
      {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
      <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
    </div>
  );
}