import { cn } from "@/lib/utils";

const DOT_COLORS = {
  green: "#28C840",
  yellow: "#FEBC2E",
  red: "#FF5F57",
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
 * macOS-style traffic-light dots for the window/panel titlebar.
 * Decorative when no handlers are supplied; becomes interactive (and focusable)
 * only for the actions that actually exist in the host component.
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
