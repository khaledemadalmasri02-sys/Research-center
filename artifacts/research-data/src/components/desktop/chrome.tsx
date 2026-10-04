import { cn } from "@/lib/utils";

/**
 * macOS traffic-light colours.
 *
 * These were hardcoded hex values (`#28C840/#FEBC2E/#FF5F57`) with no token
 * behind them, so they could not follow the active theme preset or a
 * high-contrast / dark-mode preference. They now resolve from CSS custom
 * properties with the previous values as the fallback.
 *
 * TOKEN AGENT (`src/index.css`): declare these on `:root` (and a
 * `prefers-contrast: more` / forced-colors override if you want):
 *
 *   --tl-close: #ff5f57;
 *   --tl-minimize: #febc2e;
 *   --tl-maximize: #28c840;
 *
 * NOTE: `Window.tsx` no longer renders `TrafficLights` — the desktop title bar
 * keeps only the GNOME/Adwaita glyph buttons, so the macOS dots no longer break
 * the stated Ubuntu fidelity (and no longer duplicate three actions behind a
 * second set of sub-24px hit targets). This component is retained because other
 * code still imports it; it is now only a decorative/optional affordance.
 */
const DOT_COLORS = {
  green: "var(--tl-maximize, #28c840)",
  yellow: "var(--tl-minimize, #febc2e)",
  red: "var(--tl-close, #ff5f57)",
} as const;

type TrafficLightsProps = {
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  className?: string;
  /** Diameter in px (default 11). */
  size?: number;
};

/**
 * macOS-style traffic-light dots for a panel titlebar.
 * Decorative when no handlers are supplied; becomes interactive (and focusable)
 * only for the actions that actually exist in the host component.
 *
 * Not used by the desktop window manager — see the note above.
 */
export function TrafficLights({
  onClose,
  onMinimize,
  onMaximize,
  className,
  size = 11,
}: TrafficLightsProps) {
  const interactable = Boolean(onClose || onMinimize || onMaximize);
  const dot = "rounded-full shrink-0";

  if (!interactable) {
    return (
      <div
        aria-hidden
        className={cn("flex items-center", className)}
        style={{ gap: 7 }}
      >
        <span className={dot} style={{ width: size, height: size, background: DOT_COLORS.green }} />
        <span className={dot} style={{ width: size, height: size, background: DOT_COLORS.yellow }} />
        <span className={dot} style={{ width: size, height: size, background: DOT_COLORS.red }} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center", className)} style={{ gap: 7 }}>
      <button
        type="button"
        aria-label="Maximize"
        tabIndex={onMaximize ? 0 : -1}
        onClick={onMaximize}
        className={cn(dot, "outline-none transition focus-visible:ring-2 focus-visible:ring-white/60")}
        style={{ width: size, height: size, background: DOT_COLORS.green, visibility: onMaximize ? "visible" : "hidden" }}
      />
      <button
        type="button"
        aria-label="Minimize"
        tabIndex={onMinimize ? 0 : -1}
        onClick={onMinimize}
        className={cn(dot, "outline-none transition focus-visible:ring-2 focus-visible:ring-white/60")}
        style={{ width: size, height: size, background: DOT_COLORS.yellow, visibility: onMinimize ? "visible" : "hidden" }}
      />
      <button
        type="button"
        aria-label="Close"
        tabIndex={onClose ? 0 : -1}
        onClick={onClose}
        className={cn(dot, "outline-none transition focus-visible:ring-2 focus-visible:ring-white/60")}
        style={{ width: size, height: size, background: DOT_COLORS.red, visibility: onClose ? "visible" : "hidden" }}
      />
    </div>
  );
}