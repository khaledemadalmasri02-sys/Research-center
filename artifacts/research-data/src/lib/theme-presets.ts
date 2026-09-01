export interface ThemePreset {
  id: string;
  name: string;
  accent: string; // hex, e.g. "#a855f7"
  background: string; // any valid CSS `background` value
  dark: boolean;
}

// Omarchy-inspired color-scheme presets. Each is a self-contained look:
// an accent (drives --primary / --ring) plus a desktop background and a
// light/dark base for the app chrome.
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "amethyst",
    name: "Amethyst",
    accent: "#a855f7",
    background: "radial-gradient(120% 120% at 25% 15%, #6d28d9 0%, #3b0a6b 45%, #1b0635 100%)",
    dark: true,
  },
  {
    id: "ocean",
    name: "Ocean",
    accent: "#3b82f6",
    background: "radial-gradient(120% 120% at 75% 20%, #1e3a8a 0%, #0f2962 45%, #07142e 100%)",
    dark: true,
  },
  {
    id: "forest",
    name: "Forest",
    accent: "#10b981",
    background: "radial-gradient(120% 120% at 50% 10%, #065f46 0%, #043f33 45%, #022b24 100%)",
    dark: true,
  },
  {
    id: "graphite",
    name: "Graphite",
    accent: "#94a3b8",
    background: "linear-gradient(135deg, #1f2937 0%, #0b1220 100%)",
    dark: true,
  },
  {
    id: "dracula",
    name: "Dracula",
    accent: "#bd93f9",
    background: "linear-gradient(135deg, #282a36 0%, #1a1b26 100%)",
    dark: true,
  },
  {
    id: "nord",
    name: "Nord",
    accent: "#88c0d0",
    background: "linear-gradient(135deg, #2e3440 0%, #1b1f27 100%)",
    dark: true,
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    accent: "#fe8019",
    background: "linear-gradient(135deg, #282828 0%, #1d2021 100%)",
    dark: true,
  },
  {
    id: "sakura",
    name: "Sakura",
    accent: "#f472b6",
    background: "radial-gradient(120% 120% at 30% 20%, #831843 0%, #500b2e 50%, #2b0716 100%)",
    dark: true,
  },
  {
    id: "synthwave",
    name: "Synthwave",
    accent: "#f472b6",
    background: "linear-gradient(135deg, #2b1055 0%, #7597de 120%)",
    dark: true,
  },
  {
    id: "amber",
    name: "Amber (Matte)",
    accent: "#f59e0b",
    background: "linear-gradient(135deg, #0a0a0a 0%, #161616 100%)",
    dark: true,
  },
  {
    id: "midnight",
    name: "Midnight",
    accent: "#60a5fa",
    background: "linear-gradient(135deg, #0b1026 0%, #05070f 100%)",
    dark: true,
  },
  {
    id: "solarized",
    name: "Solarized Light",
    accent: "#268bd2",
    background: "linear-gradient(135deg, #fdf6e3 0%, #eee8d5 100%)",
    dark: false,
  },
];

export const DEFAULT_THEME_ID = "amethyst";

export function getThemePreset(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

// Convert "#rrggbb" to an "H S% L%" triplet suitable for CSS custom
// properties consumed as `hsl(var(--primary))`.
export function hexToHslTriplet(hex: string): string {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Convert "#rrggbb" to an "rgba(r, g, b, a)" string for soft accent fills
// (dock/launcher tints) that need an alpha channel.
export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

