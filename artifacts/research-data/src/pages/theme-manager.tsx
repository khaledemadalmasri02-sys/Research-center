import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Palette, Upload } from "lucide-react";
import { useThemePreset } from "@/components/desktop/theme-preset-context";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Palette className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">{t("themeManager.title")}</h1>
      </div>

      <p className="text-sm text-muted-foreground">{t("themeManager.subtitle")}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("themeManager.presets")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {THEME_PRESETS.map((p) => {
              const active = !isCustom && preset.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={`group relative overflow-hidden rounded-xl border text-left transition ${
                    active ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60"
                  }`}
                >
                  <div className="h-20 w-full" style={{ background: p.background }} />
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate text-xs font-medium">{p.name}</span>
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/20"
                      style={{ background: p.accent }}
                    />
                  </div>
                  {active && (
                    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
                {CUSTOM_BACKGROUNDS.map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    onClick={() => setCustomBackground(bg)}
                    aria-label={bg}
                    className={`h-9 w-12 rounded border ${
                      customBackground === bg ? "border-primary ring-2 ring-primary" : "border-border"
                    }`}
                    style={{ background: bg }}
                  />
                ))}
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
            <Button type="button" onClick={applyCustomTheme}>
              {t("themeManager.applyCustom")}
            </Button>
            {isCustom && (
              <Badge variant="secondary">
                <Check className="mr-1 h-3 w-3" />
                {t("themeManager.activeCustom")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
