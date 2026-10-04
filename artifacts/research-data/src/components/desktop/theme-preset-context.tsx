import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  DEFAULT_THEME_ID,
  getThemePreset,
  hexToHslTriplet,
  hexToRgba,
  type ThemePreset,
} from "@/lib/theme-presets";
import { DURATION, useDesktopMotion } from "./desktop-motion";

type Stored =
  | { id: string }
  | { custom: ThemePreset };

interface ThemePresetContextValue {
  preset: ThemePreset;
  isCustom: boolean;
  setPresetId: (id: string) => void;
  applyCustom: (preset: ThemePreset) => void;
  toggleTheme: () => void;
  openThemeManager?: () => void;
  setOpenThemeManager?: (fn: () => void) => void;
}

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);

const STORAGE_KEY = "desktop-theme";
const LAST_DARK_KEY = "desktop-theme-last-dark";

/**
 * Per-preset app surfaces.
 *
 * The provider used to override only `--primary`, `--ring`, `--accent-brand`,
 * `--accent-soft(-strong)` and the dark/light class, so a preset's *wallpaper*
 * changed while `--background` and `--glass-bg` kept the cool slate / white-glass
 * defaults from `index.css`. Solarized Light is the one light preset (cream
 * wallpaper `#fdf6e3`), which produced a cream desktop behind blue-grey windows.
 *
 * `surface` / `surfaceFg` are hex; they are converted to the bare `H S% L%`
 * triplet format that `hsl(var(--background))` consumers expect.
 *
 * OWNERSHIP NOTE: `src/lib/theme-presets.ts` is owned by another agent. The
 * clean fix is to add `surface: string; surfaceFg: string` to the `ThemePreset`
 * interface and to every entry of `THEME_PRESETS`, and drop this table. Until
 * then the values live here, keyed by preset id.
 */
const PRESET_SURFACE: Record<string, { surface: string; surfaceFg: string; glassBg: string }> = {
  solarized: {
    surface: "#fdf6e3",
    surfaceFg: "#586e75",
    glassBg: "rgba(253, 246, 227, 0.82)",
  },
};

/** Tokens the preset surface owns; cleared when a dark preset is selected. */
const SURFACE_TOKENS = [
  "--background",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--glass-bg",
] as const;

/* -------------------------------------------------------------------------- */
/* Theme re-skin transition                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Class added to `<html>` for the length of a preset change. Everything the
 * stylesheet targets transitions while it is present and behaves normally the
 * rest of the time — a permanent `transition` on these selectors would fight
 * the 150 ms hover states (`transition-colors`) and make the shell feel sticky.
 */
const SKIN_CLASS = "desktop-theme-skin";

/**
 * Injected once, from the provider that owns the tokens.
 *
 * Custom properties are NOT animatable unless they are registered with
 * `@property <syntax>` (an `index.css` concern), so `--accent-brand`,
 * `--background` and `--glass-bg` cannot be tweened here. What CAN be tweened
 * is the *computed* colour that consumes them: the moment the variable changes,
 * every element painting `background-color: hsl(var(--background))` gets a new
 * computed value, and this rule makes the browser interpolate it. That is what
 * turns a hard repaint into a re-skin.
 *
 * Only colour properties are listed — never `width`/`height`/`top`/`left` — so a
 * theme switch cannot trigger a layout pass, and only ever for ~420 ms.
 *
 * `--glass-bg` is deliberately NOT animated: it is consumed through
 * `background: var(--glass-bg)` (a shorthand, not `background-color`, so there
 * is nothing to interpolate) *and* every window behind it runs
 * `backdrop-filter`, which would re-run its blur on every frame of a tween.
 * The window chrome still animates via `--glass-border` and the accent ring.
 */
const SKIN_STYLE_ID = "desktop-theme-skin-style";
const SKIN_CSS = `
html.${SKIN_CLASS},
html.${SKIN_CLASS} *,
html.${SKIN_CLASS} *::before,
html.${SKIN_CLASS} *::after {
  transition-property: background-color, color, border-color, outline-color,
    box-shadow, fill, stroke, text-decoration-color;
  transition-duration: ${DURATION.slow}s;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  html.${SKIN_CLASS},
  html.${SKIN_CLASS} *,
  html.${SKIN_CLASS} *::before,
  html.${SKIN_CLASS} *::after {
    transition-duration: 0.001ms;
  }
}
`;

function installSkinStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SKIN_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = SKIN_STYLE_ID;
  el.textContent = SKIN_CSS;
  document.head.appendChild(el);
}

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

function loadLastDark(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_DARK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

export function ThemePresetProvider({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [stored, setStored] = useState<Stored>(loadStored);
  const preset = presetFromStored(stored);
  const isCustom = "custom" in stored;
  const { reducedMotion } = useDesktopMotion();

  useEffect(installSkinStylesheet, []);

  /**
   * Arm the re-skin transition *before* the tokens are written, and disarm it
   * once the tween would have finished. `index.css` already collapses every
   * `transition-duration` under `prefers-reduced-motion`, and the class is not
   * armed at all in that case, so the light preset cannot flash.
   *
   * The first run is skipped: the pre-hydration script in `index.html` has
   * already applied the stored `.dark` class, so there is nothing to animate
   * and arming it would just make hover states sluggish for 420 ms on load.
   */
  const armedTimer = useRef<number | null>(null);
  const firstRunRef = useRef(true);
  const armSkin = () => {
    if (typeof document === "undefined" || reducedMotion) return;
    const root = document.documentElement;
    root.classList.add(SKIN_CLASS);
    if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
    armedTimer.current = window.setTimeout(() => {
      root.classList.remove(SKIN_CLASS);
      armedTimer.current = null;
    }, DURATION.slow * 1000 + 40);
  };

  useEffect(
    () => () => {
      if (typeof document === "undefined") return;
      if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
      armedTimer.current = null;
      document.documentElement.classList.remove(SKIN_CLASS);
    },
    [],
  );

  useEffect(() => {
    const root = document.documentElement;
    const hsl = hexToHslTriplet(preset.accent);
    if (firstRunRef.current) firstRunRef.current = false;
    else armSkin();
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--ring", hsl);
    root.style.setProperty("--accent-brand", preset.accent);
    root.style.setProperty("--accent-soft", hexToRgba(preset.accent, 0.18));
    root.style.setProperty("--accent-soft-strong", hexToRgba(preset.accent, 0.34));

    // Apply (or clear) the preset's own app surface so a light wallpaper gets
    // light windows instead of the default cool-slate/white-glass tokens.
    const surface = PRESET_SURFACE[preset.id];
    if (surface) {
      const bg = hexToHslTriplet(surface.surface);
      const fg = hexToHslTriplet(surface.surfaceFg);
      root.style.setProperty("--background", bg);
      root.style.setProperty("--card", bg);
      root.style.setProperty("--popover", bg);
      root.style.setProperty("--card-foreground", fg);
      root.style.setProperty("--popover-foreground", fg);
      root.style.setProperty("--glass-bg", surface.glassBg);
    } else {
      // Inline custom properties outrank the `.dark` class rules, so they have
      // to be removed explicitly or the previous light preset sticks.
      for (const token of SURFACE_TOKENS) root.style.removeProperty(token);
    }

    setTheme(preset.dark ? "dark" : "light");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      /* private mode / quota */
    }
  }, [preset, stored, setTheme, reducedMotion]);

  const setPresetId = useMemo(() => (id: string) => setStored({ id }), []);
  const applyCustom = useMemo(() => (p: ThemePreset) => setStored({ custom: p }), []);

  const toggleTheme = () => {
    if (preset.dark) {
      try {
        localStorage.setItem(LAST_DARK_KEY, JSON.stringify(stored));
      } catch {
        /* private mode / quota */
      }
      setStored({ id: "solarized" });
    } else {
      let last = loadLastDark();
      if (!last) last = { id: DEFAULT_THEME_ID };
      setStored(last);
    }
  };

  const value = useMemo<ThemePresetContextValue>(
    () => ({ preset, isCustom, setPresetId, applyCustom, toggleTheme }),
    [preset, isCustom, setPresetId, applyCustom, toggleTheme],
  );

  return <ThemePresetContext.Provider value={value}>{children}</ThemePresetContext.Provider>;
}

export function useThemePreset(): ThemePresetContextValue {
  const ctx = useContext(ThemePresetContext);
  if (!ctx) throw new Error("useThemePreset must be used within a ThemePresetProvider");
  return ctx;
}

export function useOptionalThemePreset(): ThemePresetContextValue | null {
  return useContext(ThemePresetContext);
}