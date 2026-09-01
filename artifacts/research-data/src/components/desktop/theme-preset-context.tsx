import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  DEFAULT_THEME_ID,
  getThemePreset,
  hexToHslTriplet,
  hexToRgba,
  type ThemePreset,
} from "@/lib/theme-presets";

type Stored =
  | { id: string }
  | { custom: ThemePreset };

interface ThemePresetContextValue {
  preset: ThemePreset;
  isCustom: boolean;
  setPresetId: (id: string) => void;
  applyCustom: (preset: ThemePreset) => void;
  openThemeManager?: () => void;
  setOpenThemeManager?: (fn: () => void) => void;
}

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);

const STORAGE_KEY = "desktop-theme";

function loadStored(): Stored {
  if (typeof window === "undefined") return { id: DEFAULT_THEME_ID };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { id: DEFAULT_THEME_ID };
    const parsed = JSON.parse(raw) as Stored;
    if ("custom" in parsed) return parsed;
    return { id: parsed.id || DEFAULT_THEME_ID };
  } catch {
    return { id: DEFAULT_THEME_ID };
  }
}

function presetFromStored(stored: Stored): ThemePreset {
  return "custom" in stored ? stored.custom : getThemePreset(stored.id);
}

export function ThemePresetProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [stored, setStored] = useState<Stored>(loadStored);
  const preset = presetFromStored(stored);
  const isCustom = "custom" in stored;

  useEffect(() => {
    const root = document.documentElement;
    const hsl = hexToHslTriplet(preset.accent);
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--ring", hsl);
    root.style.setProperty("--accent-brand", preset.accent);
    root.style.setProperty("--accent-soft", hexToRgba(preset.accent, 0.18));
    root.style.setProperty("--accent-soft-strong", hexToRgba(preset.accent, 0.34));
    setTheme(preset.dark ? "dark" : "light");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [preset, stored, setTheme]);

  const setPresetId = (id: string) => setStored({ id });
  const applyCustom = (p: ThemePreset) => setStored({ custom: p });

  return (
    <ThemePresetContext.Provider
      value={{ preset, isCustom, setPresetId, applyCustom }}
    >
      {children}
    </ThemePresetContext.Provider>
  );
}

export function useThemePreset(): ThemePresetContextValue {
  const ctx = useContext(ThemePresetContext);
  if (!ctx) throw new Error("useThemePreset must be used within a ThemePresetProvider");
  return ctx;
}
