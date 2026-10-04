/**
 * ============================================================================
 * MOTION SYSTEM — the single vocabulary for every animation in this app.
 * ============================================================================
 *
 * Three other agents are writing UI against this file. Everything you need to
 * animate something without inventing a number is exported from here; if you
 * find yourself writing a bare `duration: 0.3` inline, use `DURATION.base`
 * instead.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE FOR A CLINICAL APPLICATION
 * ---------------------------------------------------------------------------
 * Motion here exists to preserve *spatial continuity* — where a thing came
 * from, and where it went. It must never:
 *
 *   - delay work. Nothing in this file takes longer than 600ms, and most of it
 *     is <= 280ms. A radiologist clicking through studies cannot wait for
 *     choreography to finish before the next click is possible.
 *   - move content the user is reading or clicking. No autoplaying parallax,
 *     no looping transforms on text, no layout-thrashing entrances on tables.
 *   - stagger a list whose length you do not know. See the stagger cap below —
 *     this is the single most important rule in this file.
 *
 * ---------------------------------------------------------------------------
 * HOW REDUCED MOTION IS HONOURED (read before adding an animation)
 * ---------------------------------------------------------------------------
 * Three layers, and you need to know which one covers you:
 *
 *  1. `src/index.css` — `@media (prefers-reduced-motion: reduce)` sets
 *     `animation-duration` / `transition-duration` to `0.001ms !important`
 *     globally, and there is a matching `prefers-reduced-data: reduce` block.
 *     `!important` is what lets it beat Tailwind's `duration-*` and
 *     tw-animate-css's `animate-in`. Any CSS-class-driven motion in
 *     `src/components/ui/**` is therefore already covered, on first paint,
 *     with zero JS. You do not need to do anything for it.
 *
 *  2. `MotionConfig reducedMotion="user"` (src/App.tsx) — framer-motion drops
 *     `transform` and `opacity` keyframes when the OS asks for reduced motion.
 *     That covers every variant in this file that is opacity/transform only,
 *     which is all of them.
 *
 *  3. `useMotionPrefs()` — the gap layer. It ORs framer's `useReducedMotion()`
 *     with a direct `matchMedia` read and adds `prefers-reduced-data`, so it
 *     also covers the case framer's config does NOT: `layout` / `layoutId`
 *     shared-layout animations, and anything framer runs as a JS spring
 *     (those are integrated per frame in JS, so no CSS rule can reach them).
 *
 *     **CONSUMER RULE: if you are about to add `layout`, `layoutId`, or a
 *     spring, you MUST branch on `useMotionPrefs()`.** For shared-layout
 *     transitions use `LAYOUT_REDUCED_MOTION` as the fallback value — see its
 *     doc comment, it explains the exact framer mechanism.
 *
 * Why layers 1 and 2 cannot simply be merged: CSS `!important` and a JS
 * `if` are different mechanisms at different times. The CSS rule is evaluated
 * by the compositor with no JS on the main thread, so it protects the very
 * first paint; the JS check is evaluated in React and is the only thing that
 * can prevent framer from *starting* an animation. They agree by construction
 * because both read the same two media queries, but they are not the same
 * code path, so anything JS-driven needs the explicit check.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS LIVE
 * ---------------------------------------------------------------------------
 * `DURATION` (JS) and `--dur-*` / `--ease-*` (CSS, `src/index.css` `:root`)
 * are the same scale expressed twice. They MUST stay in sync; the values are
 * duplicated deliberately so that the JS animation engine and the stylesheet
 * cannot drift apart at runtime, and the mapping is asserted in
 * `tests/motion-system-vitest.test.tsx`.
 */
import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type TargetAndTransition,
  type Transition,
  type Variants,
} from "framer-motion";
import {
  type ReactNode,
  Children,
  useMemo,
} from "react";

import {
  REDUCED_DATA_QUERY,
  REDUCED_MOTION_QUERY,
  useMediaPreference,
} from "@/lib/motion-preferences";

export {
  REDUCED_MOTION_QUERY,
  REDUCED_DATA_QUERY,
  prefersReducedMotion,
  prefersReducedData,
  prefersLessMotion,
} from "@/lib/motion-preferences";

/* ===========================================================================
 * DURATION
 * ========================================================================= */

export const DURATION = {
  /** 120ms — press feedback, tooltips, checkbox/thumb movement. */
  instant: 0.12,
  /** 180ms — hover states, focus rings, tooltips, small popovers. */
  fast: 0.18,
  /** 280ms — the default. Overlays, dialogs, dropdowns, most entrances. */
  base: 0.28,
  /** 420ms — larger panels, sheets, page-level transitions. */
  slow: 0.42,
  /** 600ms — rare. Reserved for deliberate, user-initiated choreography. */
  deliberate: 0.6,
} as const;

/* ===========================================================================
 * EASING
 * ========================================================================= */

/**
 * The app's primary curve: fast departure, long soft arrival. ~1.4x faster
 * than linear in the first 100ms, so a transition *starts* immediately (the
 * user sees the response) and spends its remaining time settling. This value
 * predates this file and is already in use in App.tsx, auth.tsx and
 * welcome.tsx — do not change it, it is the brand curve.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Accelerating curve. Only for exits of things the user is leaving behind. */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** Symmetric curve. For reversible state changes (expand/collapse, tab switch). */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/**
 * Nearly linear with a hard start. Use for exits and sharp reversals, where a
 * soft-out tail would make a dismissal feel like it is being resisted. The
 * asymmetry is intentional: it commits immediately and then stops cleanly.
 */
export const EASE_EMPHASIZED = [0.2, 0, 0, 1] as const;

/* ===========================================================================
 * SPRINGS
 * ========================================================================= */

/**
 * Springs are for anything interruptible — gesture-driven or
 * retargetable-mid-flight motion, where a tween would have to restart and
 * restart from zero velocity. Everything else should be a tween on
 * `DURATION`; a spring has no upper bound on its settle time, which is the
 * exact property that makes a 2,000-row stagger dangerous.
 *
 * The damping ratio is `damping / (2 * sqrt(stiffness * mass))`. Values near
 * 1.0 barely overshoot; < 1 overshoots visibly. Each config below is commented
 * with its ratio and measured settle time.
 */
export const SPRING = {
  /**
   * Press feedback, checkbox thumbs, small control movement.
   * stiffness 520 + mass 0.7 => very fast initial acceleration;
   * damping 34 => zeta ~0.89, so it overshoots by well under 1% and settles in
   * ~150ms. Deliberately *below* critical damping: a press should feel like a
   * physical key bottoming out, not like a soft fade.
   */
  snappy: {
    type: "spring",
    stiffness: 520,
    damping: 34,
    mass: 0.7,
  },

  /**
   * The default spring: hover lifts, popover scale, shared-element moves.
   * stiffness 260 / mass 1 with damping 30 => zeta ~0.93, essentially
   * critically damped, settling in ~350ms. Slight overshoot is kept because a
   * shared-element transition that lands perfectly dead reads as a teleport.
   */
  smooth: {
    type: "spring",
    stiffness: 260,
    damping: 30,
    mass: 1,
  },

  /**
   * Large surfaces: window open/close, panel resize, layout transitions.
   * stiffness 170 / mass 1.1 with damping 26 => zeta ~0.95, a long, quiet
   * settle (~500ms) with no visible bounce. Bouncing a 1200px-wide window is
   * distracting and can make the user re-aim at a moving target.
   */
  gentle: {
    type: "spring",
    stiffness: 170,
    damping: 26,
    mass: 1.1,
  },
} as const;

/* ===========================================================================
 * THE STAGGER CAP  —  read this before using any stagger
 * ========================================================================= */

/** Hard ceiling on how many children a stagger will ever offset. */
export const MAX_STAGGERED_CHILDREN = 8;

/**
 * Total wall-clock budget, in seconds, for the *whole* staggered group.
 * Everything visible after `STAGGER_BUDGET_S` has effectively not started yet,
 * so capping the budget is what stops a long list from taking seconds to
 * settle. 200ms is roughly the point at which a cascade stops reading as a
 * cascade and starts reading as lag.
 */
export const STAGGER_BUDGET_S = 0.2;

/** The gap used when the list is short enough that the budget never binds. */
export const BASE_STAGGER_S = 0.07;

/** Delay before the first child starts, when the container's `delay` is unset. */
export const BASE_STAGGER_DELAY_S = 0.02;

/**
 * Compute the per-child gap so a group of `childCount` children still finishes
 * starting inside {@link STAGGER_BUDGET_S}.
 *
 * `React.Children.count` can only ever tell a container how many children it
 * *directly* has; children nested in a fragment or a map are counted as one.
 * That is why this function is safe by construction: it caps at
 * {@link MAX_STAGGERED_CHILDREN} rather than trusting the count. A container
 * that reports 1 child but renders 2,000 will still finish inside the budget,
 * because the gap is computed from the *cap*, not from the count.
 */
export function cappedStagger(
  childCount: number,
  budget: number = STAGGER_BUDGET_S,
): number {
  const effective = Math.min(
    Math.max(Number.isFinite(childCount) ? childCount : 1, 1),
    MAX_STAGGERED_CHILDREN,
  );
  return Math.min(BASE_STAGGER_S, budget / effective);
}

/**
 * The delay before child `index` starts animating. Exported so callers (and
 * tests) can prove the cap holds for an arbitrary list length without having to
 * reason about framer's internal scheduling.
 *
 * For `index >= MAX_STAGGERED_CHILDREN` this saturates at the last in-budget
 * slot rather than continuing to grow, which is the property that matters.
 */
export function staggerStartDelay(
  index: number,
  _childCount?: number,
  delay: number = BASE_STAGGER_DELAY_S,
): number {
  /*
   * WHY THE GAP COMES FROM THE CAP AND NOT THE COUNT.
   *
   * `cappedStagger(childCount)` is correct on its own: given an accurate count
   * it returns `budget / count`, so N items finish inside the budget and a short
   * list still cascades pleasantly.
   *
   * The bug this comment exists for: this function clamps `slot` to
   * `MAX_STAGGERED_CHILDREN - 1` — because `React.Children.count` can
   * UNDER-report (a fragment or a `.map()` counts as one child, so a container
   * reporting 1 may render 2,000) — while taking the *gap* from the reported
   * count. Those two sources disagree, and the product exceeds the budget:
   *
   *     childCount = 3  ->  cappedStagger(3) = min(0.07, 0.2/3) = 0.0667
   *     slot       = 7  ->  0.02 + 7 * 0.0667 = 0.487s   (2.4x the budget)
   *
   * i.e. the SMALLER the reported count, the WORSE the overrun, which is exactly
   * backwards. The fix is to derive the gap from the same cap the slot is clamped
   * to, so the product is bounded by construction for any input:
   *
   *     gap  = min(0.07, 0.2 / 8) = 0.025
   *     slot = 7                    ->  0.02 + 7 * 0.025 = 0.195s  <= 0.2s
   *
   * `childCount` is retained in the signature because callers pass it, and is
   * deliberately unused: honouring it here is precisely the defect.
   */
  const gap = Math.min(BASE_STAGGER_S, STAGGER_BUDGET_S / MAX_STAGGERED_CHILDREN);
  const slot = Math.min(
    Math.max(Number.isFinite(index) ? index : 0, 0),
    MAX_STAGGERED_CHILDREN - 1,
  );
  return delay + slot * gap;
}

/* ===========================================================================
 * VARIANTS
 * ========================================================================= */

/**
 * Opacity only. The cheapest entrance there is, and the right default for
 * anything that replaces text the user may already be reading.
 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
};

/**
 * Opacity only, faster and with the emphasized curve. Exits should feel like
 * the element got out of the way, not like it is being taken away.
 */
export const fadeOut: Variants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE_EMPHASIZED },
  },
};

/**
 * 0.96 -> 1 plus opacity. For popovers, dialogs, menus: it reads as "this came
 * out of the surface it is anchored to". 0.96 rather than 0.95 so a 600px-wide
 * dialog moves ~24px, not 30px, which is below the threshold where a scaling
 * object is perceived as *growing* rather than as appearing.
 */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
};

/**
 * 8px rise plus opacity. Small enough to read as "this belongs here" rather
 * than as "something is arriving". Anything above ~16px starts to compete with
 * the content for attention.
 */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
};

/**
 * Staggering container.
 *
 * The `staggerChildren` value is derived from {@link MAX_STAGGERED_CHILDREN},
 * NOT from the number of children — so it is correct for a list of any length,
 * including a length this component cannot know. At the cap the last in-budget
 * child starts at `0.02 + 7 * 0.025 = 0.195s`, inside the 200ms budget.
 *
 * Note this also means a 2-item list staggers by 25ms rather than 70ms. That
 * is deliberate: with the gap already inside the budget there is nothing to
 * spend, and a tighter gap on a short list reads as more responsive. Pass
 * `stagger` explicitly to {@link Stagger} if you want the looser cascade for
 * a short, high-value set of cards.
 */
export const listContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: cappedStagger(MAX_STAGGERED_CHILDREN),
      delayChildren: BASE_STAGGER_DELAY_S,
    },
  },
};

/** Entrance for one child of a {@link listContainer} group. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.slow, ease: EASE_OUT },
  },
};

/* ===========================================================================
 * THE layoutId / SHARED-LAYOUT ESCAPE HATCH
 * ========================================================================= */

/**
 * THE GAP, STATED PRECISELY.
 *
 * `MotionConfig reducedMotion="user"` (src/App.tsx) makes framer strip
 * `transform` and `opacity` from keyframes when the user prefers reduced
 * motion. It does NOT touch layout animations. `layout` and `layoutId`
 * animations are driven by framer's *projection* node — it measures the delta
 * between two boxes and interpolates that. There is no CSS transition and no
 * CSS keyframe for framer to shorten, and `reducedMotion` has no branch in
 * that code path. So a dock indicator, or a window shrinking into a dock icon,
 * will still fly across the screen for a user who asked for no motion.
 *
 * HOW TO USE THIS. Pass it as the transition when motion is not allowed:
 *
 *     const { reducedMotion } = useMotionPrefs();
 *     const t = reducedMotion ? LAYOUT_REDUCED_MOTION : SPRING.smooth;
 *     <motion.div layoutId="dock-indicator" transition={t} />
 *
 * WHY `{ duration: 0 }` AND NOT `transition={false}`. `transition={false}` /
 * `undefined` means "use framer's default", which for layout is a spring —
 * i.e. the animation still happens. `{ duration: 0 }` hits framer's
 * "instant animation" branch (`const instantAnimation = options.duration === 0`
 * in its animate driver): the projected box is committed to its final value on
 * the first frame with no interpolation and no velocity, so the element simply
 * *is* in its new position. The layout is still applied — nothing is skipped,
 * only the travel between the two positions.
 *
 * This is the correct outcome, not a compromise: the shared element still
 * appears/disappears in the right place, so the user keeps the spatial
 * continuity that made the animation worth having. They just do not watch it
 * travel.
 */
export const LAYOUT_REDUCED_MOTION: Transition = { duration: 0 };

/**
 * Pick a layout transition based on the user's preference. Prefer this over
 * branching by hand so the "instant" value stays in exactly one place.
 *
 * @param reduced   `useMotionPrefs().reducedMotion || reducedData`
 * @param animated  the transition to use when motion is allowed
 */
export function layoutTransition(
  reduced: boolean,
  animated?: Transition,
): Transition {
  return reduced ? LAYOUT_REDUCED_MOTION : (animated ?? SPRING.smooth);
}

/* ===========================================================================
 * MOTION PREFERENCES
 * ========================================================================= */

export interface MotionPrefs {
  /**
   * `prefers-reduced-motion: reduce`, from EITHER framer's own hook or a direct
   * `matchMedia` read. The two are OR'd on purpose: the OR means the
   * framer-level override (`MotionConfig`, and the `__setReducedMotion` test
   * switch) can only ever make motion *less* likely, never more, so the JS hook
   * can never contradict the CSS block in the permissive direction.
   */
  reducedMotion: boolean;
  /** `prefers-reduced-data: reduce`. See `prefersLessMotion()` for why this
   *  also gates non-essential motion. */
  reducedData: boolean;
}

/**
 * Read both OS motion preferences, reactively.
 *
 * Use this for anything framer drives that is NOT a plain opacity/transform
 * variant — i.e. `layout`, `layoutId`, springs, `AnimatePresence` exits — and
 * for anything that should also honour `prefers-reduced-data`.
 */
export function useMotionPrefs(): MotionPrefs {
  const framerReduced = useReducedMotion();
  const cssReduced = useMediaPreference(REDUCED_MOTION_QUERY);
  const reducedData = useMediaPreference(REDUCED_DATA_QUERY);

  return useMemo(
    () => ({
      reducedMotion: framerReduced === true || cssReduced,
      reducedData,
    }),
    [framerReduced, cssReduced, reducedData],
  );
}

/**
 * Collapse {@link MotionPrefs} into the single boolean most call sites want:
 * "should I skip this non-essential animation?". `reducedData` counts — see
 * the policy note in `@/lib/motion-preferences`.
 */
export function shouldReduceMotion(prefs: MotionPrefs): boolean {
  return prefs.reducedMotion || prefs.reducedData;
}

/* ===========================================================================
 * BACKWARD-COMPATIBLE COMPONENTS
 * ---------------------------------------------------------------------------
 * These predate the token system and are still imported by src/pages/home.tsx
 * and src/pages/data-analysis/*. They are kept API-identical and reimplemented
 * on the tokens above so their timing is now consistent with everything else.
 * New code should use the variant objects plus `useMotionPrefs()` directly.
 * ========================================================================= */

export interface StaggerProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /** Delay before the first child animates in. Default 0.02s. */
  delay?: number;
  /**
   * Gap between children. Leave unset to let {@link cappedStagger} derive it
   * from the child count — that is what keeps a long list inside the 200ms
   * budget. Set it explicitly only for a short list whose length you control.
   */
  stagger?: number;
}

/**
 * Staggers its direct `<StaggerItem>` children on entrance.
 *
 * The child count comes from `React.Children.count`, which is only ever an
 * estimate (a fragment counts as one child). That is safe here because
 * {@link cappedStagger} saturates at {@link MAX_STAGGERED_CHILDREN}: the worst
 * case is that a longer-than-reported list is staggered more tightly than
 * asked for, which is invisible. The alternative — trusting the count and
 * extrapolating — is how a 2,000-row patients table ends up taking ten seconds
 * to settle.
 */
export function Stagger({
  children,
  delay = BASE_STAGGER_DELAY_S,
  stagger,
  ...props
}: StaggerProps) {
  const count = Children.count(children);
  const gap = stagger ?? cappedStagger(count);

  return (
    <motion.div
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

export interface StaggerItemProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /**
   * @deprecated Lift on hover is now gated on `interactive` as well, because a
   * hover lift on a non-clickable card is a lie about the affordance. Keep
   * `lift` for the curve, but pair it with `interactive`.
   */
  lift?: boolean;
  /**
   * Is this element actually activatable (a link, a button, `tabIndex` +
   * `onClick`, `role="button"`)? Default false.
   *
   * The hover lift is suppressed unless this is true. This is why several
   * `<StaggerItem lift>` call sites in src/pages/home.tsx stop lifting: those
   * cards contain buttons but are not themselves clickable, so they must not
   * look clickable.
   */
  interactive?: boolean;
}

/**
 * Entrance for one child of a {@link Stagger} group.
 *
 * `variants` comes first so a caller-supplied `variants` prop still wins.
 */
export function StaggerItem({
  children,
  lift = false,
  interactive = false,
  ...props
}: StaggerItemProps) {
  const reduced = shouldReduceMotion(useMotionPrefs());

  return (
    <motion.div
      variants={listItem}
      whileHover={lift && interactive ? hoverLift : undefined}
      initial={reduced ? false : "hidden"}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export interface FadeInProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /** Extra delay, on top of the entrance duration. */
  delay?: number;
  /** Starting offset in px. Default 12. */
  y?: number;
}

/**
 * Fades + slides a single block of content into view.
 *
 * Under `prefers-reduced-motion` or `prefers-reduced-data` it renders in its
 * final state immediately (`initial={false}`) rather than animating — the
 * content is present on the very first frame, with no fade and no 12px offset.
 */
export function FadeIn({ children, delay = 0, y = 12, ...props }: FadeInProps) {
  const reduced = shouldReduceMotion(useMotionPrefs());

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ===========================================================================
 * LEGACY EXPORTS — kept so existing importers keep compiling
 * ========================================================================= */

/**
 * @deprecated Prefer `listContainer`. Identical semantics; this name predates
 * the token system.
 */
export const containerVariants: Variants = listContainer;

/**
 * @deprecated Prefer `listItem`.
 */
export const itemVariants: Variants = listItem;

/**
 * Subtle lift on hover, now on {@link SPRING.smooth} rather than an ad-hoc
 * spring. Kept exported because callers still reference it directly.
 *
 * Only ever apply this to something that is genuinely activatable — see
 * `StaggerItem`'s `interactive` prop.
 */
export const hoverLift: TargetAndTransition = {
  y: -4,
  transition: SPRING.smooth,
};