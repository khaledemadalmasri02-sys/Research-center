import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Palette } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDesktopActions, clearDesktopStorage } from "@/components/desktop/window-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DURATION,
  EASE_OUT,
  INSTANT,
  listContainer,
  listItem,
  staggerFor,
  useDesktopMotion,
} from "@/components/desktop/desktop-motion";

/** How many cards this page has — used to cap the reveal stagger. */
const SECTION_COUNT = 3;

export default function Settings() {
  const { t } = useTranslation();
  const { username, logout } = useAuth();
  const { reset, open } = useDesktopActions();
  const { reducedMotion } = useDesktopMotion();

  /**
   * "Reset Desktop Layout" does not move anything on this page: `reset()`
   * dispatches `RESET`, and every open window then plays its own exit animation
   * through `AnimatePresence` in `Desktop.tsx`. That IS the layout change
   * feedback, and duplicating it here would mean animating a list of windows the
   * page does not own. All this page adds is a short acknowledgement on the
   * button so the click is not silent before the windows start leaving.
   */
  const [resetAck, setResetAck] = useState(false);

  const handleReset = () => {
    if (!window.confirm(t("settings.resetConfirm"))) return;
    reset();
    // Drop the persisted layout too, otherwise the "reset" reappears on the
    // next reload (and lingers in localStorage after logout on a shared
    // workstation).
    clearDesktopStorage();
    if (reducedMotion) return;
    setResetAck(true);
    window.setTimeout(() => setResetAck(false), DURATION.slow * 1000);
  };

  const handleLogout = () => {
    // `localStorage` outlives the session: clear the desktop layout before the
    // cookie goes away so the next user on this workstation does not inherit
    // these windows.
    clearDesktopStorage();
    void logout();
  };

  // Reduced motion: no variants at all, so nothing animates and the sections
  // are simply present.
  const container = reducedMotion ? undefined : listContainer;
  const item = reducedMotion ? undefined : listItem;

  return (
    <motion.div
      variants={container}
      initial={reducedMotion ? false : "hidden"}
      animate={reducedMotion ? undefined : "show"}
      transition={{ staggerChildren: staggerFor(SECTION_COUNT + 1, 0.06, 0.14) }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <motion.h1 variants={item} className="text-2xl font-bold tracking-tight">
        {t("nav.settings")}
      </motion.h1>

      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.appearance")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("settings.theme")}</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("settings.language")}</span>
              <LanguageSwitcher />
            </div>
            <Button variant="outline" className="w-full" onClick={() => open("theme-manager")}>
              <Palette className="mr-2 h-4 w-4" />
              {t("nav.themeManager")}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.account")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("settings.signedInAs")}</span>
              <span className="text-sm font-medium">{username}</span>
            </div>
            <Button variant="destructive" onClick={handleLogout} className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              {t("nav.signOut")}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item} className="relative">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.desktop")}</CardTitle>
          </CardHeader>
          <CardContent>
            <motion.div whileTap={reducedMotion ? undefined : { scale: 0.98 }}>
              <Button variant="outline" onClick={handleReset} className="w-full">
                {t("desktop.resetDesktop")}
              </Button>
            </motion.div>
          </CardContent>
        </Card>
        {/* Decorative acknowledgement of the layout reset, `aria-hidden` so it
            is not announced — the state change it reflects is a visual one. */}
        <AnimatePresence>
          {resetAck && (
            <motion.span
              aria-hidden
              initial={reducedMotion ? false : { opacity: 0.55 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={
                reducedMotion ? INSTANT : { duration: DURATION.slow, ease: EASE_OUT }
              }
              className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-destructive/60"
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}