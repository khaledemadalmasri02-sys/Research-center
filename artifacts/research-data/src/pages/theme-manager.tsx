import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Palette, Upload } from "lucide-react";
import { useThemePreset } from "@/components/desktop/theme-preset-context";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DURATION,
  EASE_OUT,
  INSTANT,
  SPRING,
  listContainer,
  listItem,
  staggerFor,
  useDesktopMotion,
} from "@/components/desktop/desktop-motion";

const CUSTOM_BACKGROUNDS = [
  "radial-gradient(120% 120% at 25% 15%, #6d28d9 0%, #3b0a6b 45%, #1b0635 100%)",
  "linear-gradient(135deg, #1f2937 0%, #0b1220 100%)",
  "linear-gradient(135deg, #0a0a0a 0%, #161616 100%)",
  "radial-gradient(120% 120% at 30% 20%, #831843 0%, #500b2e 50%, #2b0716 100%)",
  "linear-gradient(135deg, #fdf6e3 0%, #eee8d5 100%)",
  "linear-gradient(135deg, #2b1055 0%, #7597de 120%)",
];

function imageBackground(src: string): string {
  return `url("${src}") center / cover no-repeat`;
}

export default function ThemeManager() {
  const { t } = useTranslation();
  const { preset, isCustom, setPresetId, applyCustom } = useThemePreset();
  const { reducedMotion } = useDesktopMotion();

  const [customAccent, setCustomAccent] = useState(preset.accent);
  const [customBackground, setCustomBackground] = useState(preset.background);
  const [customDark, setCustomDark] = useState(preset.dark);
  const [customImage, setCustomImage] = useState(
    preset.background.startsWith("url(") ? preset.background : "",
  );

  const onImageUpload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomImage(url);
    setCustomBackground(imageBackground(url));
  };

  const applyCustomTheme = () => {
    applyCustom({
      id: "custom",
      name: "Custom",
      accent: customAccent,
      background: customBackground,
      dark: customDark,
    });
  };

  const container = reducedMotion ? undefined : listContainer;
  const item = reducedMotion ? undefined : listItem;
  const presetStagger = staggerFor(THEME_PRESETS.length, 0.035, 0.16);
  const presetVariants = reducedMotion
    ? undefined
    : {
        hidden: { opacity: 0, y: 10 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: DURATION.base, ease: EASE_OUT },
        },
      };

  /**
   * `accent` → `hexToRgba`-style wash without the import, so the preview can
   * react to the colour input on every change (the pickers used to only take
   * effect after "Apply", which made choosing an accent a guessing game).
   */
  const accentWash = useMemo(() => {
    const hex = customAccent.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some((n) => !Number.isFinite(n))) return "rgba(168, 85, 247, 0.18)";
    return `rgba(${r}, ${g}, ${b}, 0.18)`;
  }, [customAccent]);

  return (
    <motion.div
      variants={container}
      initial={reducedMotion ? false : "hidden"}
      animate={reducedMotion ? undefined : "show"}
      className="mx-auto max-w-4xl space-y-6"
    >
      <motion.div variants={item} className="flex items-center gap-2">
        <Palette className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t("themeManager.title")}</h1>
      </motion.div>

      <motion.p variants={item} className="text-sm text-muted-foreground">
        {t("themeManager.subtitle")}
      </motion.p>

      {/*
        Live wallpaper preview. `Wallpaper` does the cross-fade between the old
        and new gradient, so every swatch click and every colour-input tick shows
        the desktop re-skinning instead of only taking effect after "Apply". The
        `isolate` wrapper gives the wallpaper its own stacking context so its
        `-z-10` cannot sink it behind the card.
      */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("themeManager.preview", "Preview")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative isolate h-40 overflow-hidden rounded-xl border border-border">
              <Wallpaper background={customBackground} />
              {/* A mock window so the accent, the title bar tint and the focus
                  ring are all visible before the theme is applied. */}
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={reducedMotion ? INSTANT : SPRING.snappy}
                className="absolute inset-x-6 bottom-0 top-6 flex flex-col overflow-hidden rounded-t-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]"
                style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}
              >
                <div
                  className="flex h-7 shrink-0 items-center gap-2 px-2"
                  style={{ backgroundColor: accentWash }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: customAccent }}
                  />
                  <span className="text-[11px] font-medium text-foreground/80">
                    {t("nav.settings")}
                  </span>
                  <span
                    className="ms-auto h-1 w-5 rounded-full"
                    style={{ backgroundColor: customAccent }}
                  />
                </div>
                <div className="flex-1 bg-background/40" />
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("themeManager.presets")}</CardTitle>
          </CardHeader>
          <CardContent>
            <motion.div
              initial={reducedMotion ? false : "hidden"}
              animate={reducedMotion ? undefined : "show"}
              variants={{ hidden: {}, show: { transition: { staggerChildren: presetStagger } } }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            >
              {THEME_PRESETS.map((p) => {
                const active = !isCustom && preset.id === p.id;
                return (
                  <motion.button
                    key={p.id}
                    type="button"
                    variants={presetVariants}
                    whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                    onClick={() => setPresetId(p.id)}
                    aria-pressed={active}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border text-left",
                      active
                        ? "border-primary ring-2 ring-primary"
                        : "border-border hover:border-primary/60",
                    )}
                  >
                    <div className="h-20 w-full" style={{ background: p.background }} />
                    <div className="flex items-center justify-between gap-2 p-2">
                      <span className="truncate text-xs font-medium">{p.name}</span>
                      <span
                        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/20"
                        style={{ background: p.accent }}
                      />
                    </div>
                    {/* The check badge pops in rather than appearing, so moving
                        the selection between presets reads as one object
                        moving. */}
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.span
                          key="check"
                          initial={
                            reducedMotion ? false : { opacity: 0, scale: 0.5 }
                          }
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.5 }}
                          transition={reducedMotion ? INSTANT : SPRING.snappy}
                          className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"
                        >
                          <Check className="h-3 w-3" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("themeManager.custom")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="accent">{t("themeManager.accent")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accent"
                    type="color"
                    value={customAccent}
                    onChange={(e) => setCustomAccent(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{customAccent}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t("themeManager.background")}</Label>
                <div className="flex flex-wrap gap-2">
                  {CUSTOM_BACKGROUNDS.map((bg) => {
                    const selected = customBackground === bg;
                    return (
                      <motion.button
                        key={bg}
                        type="button"
                        onClick={() => setCustomBackground(bg)}
                        aria-label={bg}
                        aria-pressed={selected}
                        whileTap={reducedMotion ? undefined : { scale: 0.9 }}
                        transition={reducedMotion ? INSTANT : SPRING.snappy}
                        className={cn(
                          "relative h-9 w-12 rounded border",
                          selected ? "border-primary ring-2 ring-primary" : "border-border",
                        )}
                        style={{ background: bg }}
                      >
                        <AnimatePresence initial={false}>
                          {selected && (
                            <motion.span
                              key="tick"
                              initial={reducedMotion ? false : { opacity: 0, scale: 0.4 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.4 }}
                              transition={reducedMotion ? INSTANT : SPRING.snappy}
                              className="absolute inset-0 grid place-items-center"
                            >
                              <Check
                                className="h-4 w-4 drop-shadow"
                                style={{ color: "#fff" }}
                              />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t("themeManager.image")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="url"
                    placeholder="https://…"
                    value={customImage.startsWith("url(") ? "" : customImage}
                    onChange={(e) => {
                      setCustomImage(e.target.value);
                      if (e.target.value) setCustomBackground(imageBackground(e.target.value));
                    }}
                    className="h-9 w-56"
                  />
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-accent">
                    <Upload className="h-4 w-4" />
                    {t("themeManager.upload")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onImageUpload(e.target.files?.[0])}
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{t("themeManager.mode")}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={customDark ? "default" : "outline"}
                    onClick={() => setCustomDark(true)}
                  >
                    {t("themeManager.dark")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={!customDark ? "default" : "outline"}
                    onClick={() => setCustomDark(false)}
                  >
                    {t("themeManager.light")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <motion.div whileTap={reducedMotion ? undefined : { scale: 0.97 }}>
                <Button type="button" onClick={applyCustomTheme}>
                  {t("themeManager.applyCustom")}
                </Button>
              </motion.div>
              <AnimatePresence initial={false}>
                {isCustom && (
                  <motion.span
                    key="custom-badge"
                    initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: reducedMotion ? 0 : -8 }}
                    transition={reducedMotion ? INSTANT : SPRING.snappy}
                  >
                    <Badge variant="secondary">
                      <Check className="mr-1 h-3 w-3" />
                      {t("themeManager.activeCustom")}
                    </Badge>
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}