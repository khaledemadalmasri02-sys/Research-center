import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

import {
  DURATION,
  EASE_OUT,
  MAX_STAGGERED_CHILDREN,
  STAGGER_BUDGET_S,
  shouldReduceMotion,
  useMotionPrefs,
  type MotionPrefs,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Page-level motion helpers.
 *
 * The tokens, variants and preference hooks all live in `@/lib/motion` (owned
 * by the motion-system agent) and are re-exported here so page code has one
 * import site. What stays in this module is only what is genuinely a
 * *page* concern rather than a motion-system concern:
 *
 *   - {@link StaggeredList} / {@link StaggeredItem}: a list entrance that
 *     refuses to animate past {@link MAX_STAGGERED_CHILDREN}. framer's
 *     `staggerChildren` keeps applying to every child, so on a 2,000-row list
 *     the cap has to be enforced by *not mounting a tween at all* past the
 *     limit rather than by shrinking the gap.
 *   - {@link CrossFade}: skeleton -> content without a flash.
 *   - {@link useInvalidShake}: invalid-submit feedback.
 *   - {@link useChartAnimation}: recharts has no reduced-motion awareness.
 */

export {
  DURATION,
  EASE_OUT,
  fadeIn,
  fadeOut,
  scaleIn,
  slideUp,
  listContainer,
  listItem,
  useMotionPrefs,
  shouldReduceMotion,
  LAYOUT_REDUCED_MOTION,
  MAX_STAGGERED_CHILDREN,
  FadeIn,
} from "@/lib/motion";

/** Re-exported for call sites that only need the collapsed boolean. */
export function useReduceMotion(): boolean {
  return shouldReduceMotion(useMotionPrefs());
}

/** The `MotionPrefs` shape, re-exported so page code need not import motion. */
export type { MotionPrefs };

/* -------------------------------------------------------------------------- */
/* List entrance — with the cap enforced by construction                       */
/* -------------------------------------------------------------------------- */

/** Container for {@link StaggeredItem}. */
export function StaggeredList({ children, ...props }: HTMLMotionProps<"div">) {
  const prefs: MotionPrefs = useMotionPrefs();
  const reduced = shouldReduceMotion(prefs);
  return (
    <motion.div
      variants={{
        hidden: {},
        show: { transition: { delayChildren: reduced ? 0 : 0.02 } },
      }}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * A list row that animates in **only** inside the stagger cap.
 *
 * `index >= MAX_STAGGERED_CHILDREN` renders a plain `<div>`: no tween is
 * mounted, so a 2,000-row list costs eight animations and the remaining 1,992
 * rows appear with the content. Combined with the motion system's own
 * `cappedStagger` budget ({@link STAGGER_BUDGET_S}), the last animated row
 * settles well inside 200ms regardless of list length.
 *
 * `lift` is deliberately NOT offered here: a hover lift on a card that is not
 * itself activatable lies about the affordance. Use the motion system's
 * `Stagger`/`StaggerItem` with `lift` + `interactive` for genuinely clickable
 * cards.
 */
export function StaggeredItem({
  children,
  index,
  className,
  ...props
}: Omit<HTMLMotionProps<"div">, "custom"> & {
  children: ReactNode;
  /** Position in the list. Drives whether this row is inside the cap. */
  index: number;
}) {
  if (index >= MAX_STAGGERED_CHILDREN) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      initial="hidden"
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton -> content cross-fade                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cross-fade between two mutually exclusive blocks.
 *
 * Several pages render a skeleton and then swap in content with no transition,
 * so the page visibly flashes when the request lands. Both blocks sit in the
 * same flow position and cross-fade, which means the incoming content is never
 * delayed — the outgoing skeleton simply stops being opaque.
 *
 * Only `opacity` is animated: no `height`, `width`, `top` or `left`, so nothing
 * reflows and the swap cannot shift the layout out from under a pointer.
 *
 * `absolute` on the outgoing layer is the one exception to "no positioning", and
 * it is required: without it the skeleton would push the content down while
 * fading. Callers pass a skeleton of roughly the right height.
 */
export function CrossFade({
  loading,
  skeleton,
  children,
  className,
  /** Accessible label for the live region while the swap happens. */
  label,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const reduced = useReduceMotion();
  const duration = reduced ? 0 : DURATION.fast;

  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden={!loading}
        className={cn(loading ? "block" : "pointer-events-none absolute inset-0")}
        style={{ opacity: loading ? 1 : 0, transition: `opacity ${duration}s ease-out` }}
      >
        {skeleton}
      </div>
      <div
        style={{ opacity: loading ? 0 : 1, transition: `opacity ${duration}s ease-out` }}
        {...(label
          ? { role: "status", "aria-live": "polite", "aria-busy": loading }
          : { "aria-hidden": loading })}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Invalid-submit feedback                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A short horizontal shake for an invalid submit.
 *
 * Secondary signal only — the border/colour transition carries the meaning, and
 * `role="alert"` on the summary carries it for a screen reader. Runs at
 * `DURATION.fast`, is skipped entirely under reduced motion, and fires at most
 * once per `trigger` value so a user hammering the button does not get a
 * repeating motion loop.
 */
export function useInvalidShake(trigger: unknown) {
  const reduced = useReduceMotion();
  const [shakeKey, setShakeKey] = useState(0);
  const last = useRef<unknown>(undefined);

  useEffect(() => {
    if (reduced) return;
    if (last.current !== undefined && last.current === trigger) return;
    last.current = trigger;
    setShakeKey((k) => k + 1);
  }, [trigger, reduced]);

  if (reduced) return undefined;
  return {
    key: shakeKey,
    animate: { x: [0, -5, 5, -3, 3, 0] },
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  };
}

/* -------------------------------------------------------------------------- */
/* Recharts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `isAnimationActive` for recharts series.
 *
 * recharts animates bars for 1.5s by default, which is long enough to read as a
 * hang on a slow analysis result. This shortens the sweep and switches it off
 * entirely under reduced motion — recharts has no such awareness of its own.
 */
export function useChartAnimation(): {
  isAnimationActive: boolean;
  animationDuration: number;
} {
  const reduced = useReduceMotion();
  return useMemo(
    () => ({
      isAnimationActive: !reduced,
      animationDuration: reduced ? 0 : 420,
    }),
    [reduced],
  );
}
