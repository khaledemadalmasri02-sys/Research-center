import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useSound } from "@/components/sound-provider";
import { useOptionalThemePreset } from "@/components/desktop/theme-preset-context";
import { DURATION, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

/**
 * Sun <-> moon morph.
 *
 * `next-themes` swaps the `class` on <html>; the toggle was two icons behind
 * `dark:hidden` / `hidden dark:block`, so one frame showed neither and the
 * swap was a hard cut. Both icons are now always mounted, stacked in the same
 * 20x20 box and cross-faded with a rotation and a scale, so the outgoing icon
 * appears to spin away as the incoming one takes its place.
 *
 * `transform` + `opacity` only, so this never reflows the button. Reduced
 * motion collapses the cross-fade to an instant cut rather than leaving the
 * two icons stacked at 50% opacity.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { toggleTheme } = useOptionalThemePreset() ?? {};
  const { t } = useTranslation();
  const { play } = useSound();
  const reducedMotion = shouldReduceMotion(useMotionPrefs());

  const onClick = () => {
    if (toggleTheme) {
      toggleTheme();
    } else {
      const next = theme === "dark" ? "light" : "dark";
      setTheme(next);
      play(next === "dark" ? "toggle-on" : "toggle-off");
    }
  };

  /* `theme` is undefined on the first render (next-themes reads localStorage in
     an effect). Treat that as light so the sun is visible immediately rather
     than flashing a dark moon over a light page. */
  const dark = theme === "dark";
  const morph = (shown: boolean, degrees: number) =>
    reducedMotion
      ? { opacity: shown ? 1 : 0, scale: 1, rotate: 0 }
      : { opacity: shown ? 1 : 0, scale: shown ? 1 : 0.6, rotate: shown ? 0 : degrees };
  const duration = reducedMotion ? 0 : DURATION.fast;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground"
      onClick={onClick}
      title={t("theme.toggle")}
      aria-label={t("theme.toggle")}
      data-tour="theme"
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <motion.span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={morph(!dark, 90)}
          transition={{ duration }}
        >
          <Sun className="h-5 w-5" />
        </motion.span>
        <motion.span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={morph(dark, -90)}
          transition={{ duration }}
        >
          <Moon className="h-5 w-5" />
        </motion.span>
      </span>
    </Button>
  );
}