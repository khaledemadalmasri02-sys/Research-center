import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  const nextLabel = i18n.resolvedLanguage === "ar" ? "EN" : "ع";

  const toggle = () => {
    void i18n.changeLanguage(i18n.resolvedLanguage === "ar" ? "en" : "ar");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground"
      onClick={toggle}
      title={`${t("language.label")} — ${nextLabel}`}
      /* Deliberately NOT `aria-pressed`: the control does not toggle a boolean
         setting, it switches to *the other* language, and a screen reader
         announcing "Language, pressed" tells the user nothing about which
         language they will land in. The title carries the target. */
      aria-label={t("language.label")}
      data-tour="language"
    >
      {/* The globe rotates a quarter turn on press. `rtl:rotate-180` on the
          icon flips it in Arabic; the keyframe adds to that, and `motion-
          reduce:transition-none` plus the JS branch below collapse it to
          nothing for users who asked for no motion. */}
      <motion.span
        aria-hidden
        className="flex items-center justify-center"
        whileTap={reducedMotion ? undefined : { rotate: 12 }}
        transition={SPRING.snappy}
      >
        <Languages className="h-4 w-4 rtl:rotate-180" />
      </motion.span>
    </Button>
  );
}