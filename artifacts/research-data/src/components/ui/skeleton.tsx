import { shouldReduceMotion, useMotionPrefs } from "@/lib/motion"

import { cn } from "@/lib/utils"

/**
 * Loading placeholder.
 *
 * MOTION. The shimmer is a moving linear-gradient rather than an opacity
 * pulse, because it reads as "content is arriving" instead of as "something is
 * waiting". It is the only looping animation in the primitives layer, which
 * makes it the most expensive thing here — an indefinitely repeating repaint
 * over whatever is behind it.
 *
 * Reduced motion AND reduced data both switch it off, via two independent
 * paths that cannot disagree:
 *   - this component, from `useMotionPrefs()` — the authoritative check, and
 *     the one that also covers `prefers-reduced-data`.
 *   - `@media (prefers-reduced-motion: reduce)` and
 *     `@media (prefers-reduced-data: reduce)` in src/index.css, which kill the
 *     animation on the very first paint, before React has rendered anything.
 * The static gradient below is kept in both cases, so a reduced-motion user
 * still sees the shape of what is loading — only the sheen is gone. Removing
 * the placeholder entirely would be worse: the box is the layout the page is
 * about to fill in, and without it the content jumps.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const animate = !shouldReduceMotion(useMotionPrefs())

  return (
    <div
      role="status"
      aria-label="Loading"
      aria-live="polite"
      data-shimmer={animate ? "on" : "off"}
      className={cn(
        "rounded-md",
        // Stops are theme-aware via the `--skeleton-base` and
        // `--skeleton-highlight` CSS vars in index.css.
        "bg-[linear-gradient(90deg,var(--skeleton-base)_0%,var(--skeleton-highlight)_50%,var(--skeleton-base)_100%)] bg-[length:200%_100%]",
        animate && "skeleton-shimmer",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }