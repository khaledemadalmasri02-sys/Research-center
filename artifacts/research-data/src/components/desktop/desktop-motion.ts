import { shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

/**
 * The desktop shell's motion entry point.
 *
 * Every animation in `components/desktop/**`, `pages/settings.tsx` and
 * `pages/theme-manager.tsx` imports its tokens from HERE rather than from
 * `lib/motion` directly. That is deliberate: the shell needs two things the
 * shared module does not provide, and keeping them in one shell-owned file means
 * a future change to either side touches exactly one place.
 *
 * Re-exported from `@/lib/motion` (the system-wide vocabulary): `DURATION`,
 * `EASE_OUT`, `EASE_IN`, `EASE_IN_OUT`, `EASE_EMPHASIZED`, `SPRING`,
 * `fadeIn`, `fadeOut`, `scaleIn`, `slideUp`, `listContainer`, `listItem`,
 * `LAYOUT_REDUCED_MOTION`.
 *
 * Shell-local additions:
 *
 *  - `INSTANT` — a zero-length tween used as the *target-side* fallback. It
 *    matters that this is a distinct value from simply "omit the animation":
 *    `MotionConfig reducedMotion="user"` SUPPRESSES transform/opacity
 *    animation but still APPLIES the target values, so a reduced-motion target
 *    of `scale: 0.05` would land as a jump rather than a fade. Reduced-motion
 *    branches therefore change the target values, not just the timing.
 *
 *  - `staggerFor` — the shell's stagger cap. `lib/motion`'s `cappedStagger`
 *    deliberately bounds the per-child GAP (it clamps the effective count to
 *    `MAX_STAGGERED_CHILDREN`), which is the right trade-off for page content.
 *    For a grid of unknown length — the launcher, the dock, the preset list —
 *    the shell's rule is stricter: the TOTAL delay is capped, so the last item
 *    starts inside `cap` seconds no matter how many there are. A 40-tile
 *    launcher at a 25 ms gap is still a full second of cascade.
 *
 *  - `useDesktopMotion` — wraps `useMotionPrefs()` so every call site in the
 *    shell reads the same two booleans, and adds the `layout` escape hatch.
 *
 *  - `isRtlDoc` — the shell mirrors in RTL (`end-*` classes), so an entrance
 *    offset has to come from the correct edge.
 */
export {
  DURATION,
  EASE_OUT,
  EASE_IN,
  EASE_IN_OUT,
  EASE_EMPHASIZED,
  SPRING,
  fadeIn,
  fadeOut,
  scaleIn,
  slideUp,
  listContainer,
  listItem,
  LAYOUT_REDUCED_MOTION,
} from "@/lib/motion";

export { cappedStagger, staggerStartDelay, layoutTransition } from "@/lib/motion";

import type { Transition } from "framer-motion";

/** Zero-length tween: the value is applied on the next frame, not tweened. */
export const INSTANT: Transition = { duration: 0 };

/**
 * Per-child stagger gap for a group of `count` items.
 *
 * `per` is the ideal gap; `cap` is the TOTAL delay budget. The gap shrinks as
 * the list grows, so the last item always starts within `cap` seconds — a
 * 4-item list still gets the full `per` gap, a 400-item list gets under 0.5 ms.
 *
 * This is the shell's version of `cappedStagger` and it is intentionally
 * stricter; see the module header.
 */
export function staggerFor(count: number, per: number, cap: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  return Math.min(per, cap / (count - 1));
}

/**
 * Reduced-motion access for the shell.
 *
 * `useMotionPrefs()` ORs framer's own hook with a direct `matchMedia` read and
 * adds `prefers-reduced-data: reduce`, and `shouldReduceMotion()` collapses both
 * — which is the correct reading of `motion-preferences.ts`'s policy: a
 * reduced-data user loses non-essential motion (travel, stagger, layout
 * projection) but keeps motion that carries feedback (focus rings, presses).
 * The shell's `layout` gate uses exactly this.
 */
export function useDesktopMotion(): {
  /** Skip anything that moves: travel, stagger, layout projection. */
  reducedMotion: boolean;
  /** `true` only when framer's `layout` prop may be used at all. */
  layout: boolean;
  /** Map a transition to `INSTANT` when motion is reduced. */
  t: (transition: Transition) => Transition;
} {
  const prefs = useMotionPrefs();
  const reducedMotion = shouldReduceMotion(prefs);
  return {
    reducedMotion,
    layout: !reducedMotion,
    t: (transition: Transition) => (reducedMotion ? INSTANT : transition),
  };
}

/** True when the document is laid out right-to-left (for edge-relative motion). */
export function isRtlDoc(): boolean {
  if (typeof document === "undefined") return false;
  try {
    if (typeof getComputedStyle === "function") {
      return getComputedStyle(document.documentElement).direction === "rtl";
    }
    return document.documentElement.dir === "rtl";
  } catch {
    return false;
  }
}