import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DURATION, EASE_OUT, INSTANT, useDesktopMotion } from "./desktop-motion";

const GRADIENTS = [
  "radial-gradient(120% 120% at 25% 15%, #6d28d9 0%, #3b0a6b 45%, #1b0635 100%)",
  "radial-gradient(120% 120% at 75% 20%, #1e3a8a 0%, #0f2962 45%, #07142e 100%)",
  "radial-gradient(120% 120% at 50% 10%, #065f46 0%, #043f33 45%, #022b24 100%)",
  "linear-gradient(135deg, #1f2937 0%, #0b1220 100%)",
];

/**
 * Wallpaper cross-fade.
 *
 * The wallpaper is a full-bleed gradient behind every window, so it is the
 * single largest visible surface when a theme preset changes. Animating the
 * CSS `background` shorthand is impossible anyway (gradient stops are not
 * interpolatable), and `ThemePresetProvider` cannot transition the custom
 * properties themselves: a custom property is only animatable if it is
 * registered with `@property`, which lives in `src/index.css` (owned
 * elsewhere — see the report). So the wallpaper cross-fades between two stacked
 * layers instead, which is also the cheap option: opacity on a static layer is
 * a pure compositor operation and never re-runs the `backdrop-filter` on the
 * windows above it.
 *
 * At most two layers are ever mounted: the incoming one fades in over the
 * outgoing one, then the outgoing one is dropped. A third retained gradient
 * would cost a full-viewport raster for nothing.
 */
export function Wallpaper({
  variant = 0,
  background,
  onContextMenu,
}: {
  variant?: number;
  background?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const resolved = background ?? GRADIENTS[variant % GRADIENTS.length];
  const { reducedMotion } = useDesktopMotion();

  /**
   * Newest first. `setLayers` is called *during* render when a new background
   * arrives (React's "derive state during render" pattern) so the outgoing
   * layer is still on screen for the first commit carrying the new background.
   * Doing this in an effect would leave one frame with nothing painted behind
   * the windows — a visible flash.
   */
  const [layers, setLayers] = useState<string[]>(() => [resolved]);
  if (layers[0] !== resolved) {
    setLayers([resolved, ...layers.filter((bg) => bg !== resolved)].slice(0, 2));
  }

  // Reduced motion renders the new layer with no animation at all, so
  // `onAnimationComplete` never fires and the outgoing layer would linger.
  useEffect(() => {
    if (reducedMotion && layers.length > 1) setLayers([layers[0]]);
  }, [reducedMotion, layers]);

  return (
    <div aria-hidden onContextMenu={onContextMenu} className="absolute inset-0 -z-10">
      {layers.map((bg, i) => {
        const incoming = i === 0;
        return (
          <motion.div
            key={bg}
            style={{ background: bg }}
            initial={incoming && !reducedMotion ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={reducedMotion ? INSTANT : { duration: DURATION.slow, ease: EASE_OUT }}
            onAnimationComplete={() => {
              if (incoming) setLayers((prev) => (prev.length > 1 ? [prev[0]] : prev));
            }}
            className="absolute inset-0"
          />
        );
      })}
    </div>
  );
}