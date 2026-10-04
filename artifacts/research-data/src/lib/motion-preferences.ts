/**
 * OS-level motion / data preferences, safe in SSR, jsdom and the browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY FROM index.css
 * ---------------------------------------------------------------------------
 * There are two independent motion-preference mechanisms in this app and they
 * must never disagree:
 *
 *  1. CSS  — the `@media (prefers-reduced-motion: reduce)` block in
 *     `src/index.css` sets `animation-duration` / `transition-duration` to
 *     `0.001ms !important` on every element. `!important` is what makes it win
 *     over Tailwind's `duration-*` utilities and over tw-animate-css's
 *     `animate-in` shorthand. This covers *everything declarative*: hover
 *     transitions, Radix `data-state` keyframes, the skeleton shimmer, the
 *     auth gradients. It needs no JavaScript and is correct on first paint.
 *
 *  2. JS   — framer-motion is a JS animation engine. CSS cannot reach it:
 *     springs are integrated per frame in JS, and shared-layout
 *     (`layout` / `layoutId`) animations are driven by the projection node,
 *     not by CSS transitions at all. `MotionConfig reducedMotion="user"`
 *     (set in src/App.tsx) makes framer *skip transform/opacity keyframes*
 *     but it explicitly does NOT cover layout animations. So anything JS-driven
 *     must ask this module.
 *
 * Rule of thumb:
 *   - CSS-only motion (class-driven)  -> you get reduced motion for free.
 *   - JS-driven motion (framer, vaul) -> wrap in `useMotionPrefs()`
 *     (src/lib/motion.tsx) and branch on it.
 *
 * The global CSS `!important` block also fires for `prefers-reduced-data:
 * reduce` in the blocks declared in index.css, but a `prefers-reduced-data`
 * user is not necessarily a `prefers-reduced-motion` user, so the JS side has
 * to opt in separately. See `prefersLessMotion()` for the policy decision.
 */
import { useCallback, useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const REDUCED_DATA_QUERY = "(prefers-reduced-data: reduce)";

/**
 * Read a media query without ever throwing.
 *
 * `window.matchMedia` does not exist in jsdom and does not exist during SSR.
 * Every call site has to degrade rather than throw, so this returns `null`
 * instead of a `MediaQueryList` when the query cannot be evaluated. Callers
 * treat `null` as "no preference expressed" (i.e. motion allowed), which is
 * the pre-existing behaviour of `prefersReducedMotion()` — kept deliberately:
 * an environment that cannot answer the question must never silently opt a
 * user *into* reduced motion either, or every component would lose its
 * animation in tests and in any non-DOM render path.
 */
function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof window.matchMedia !== "function") return null;
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/**
 * `prefers-reduced-motion: reduce` — non-imperative: the user wants less or no
 * animation that could trigger vestibular discomfort.
 *
 * Unchanged from the original implementation, including the SSR/jsdom fallback.
 */
export function prefersReducedMotion(): boolean {
  return getMediaQueryList(REDUCED_MOTION_QUERY)?.matches === true;
}

/**
 * `prefers-reduced-data: reduce` — imperative: the user wants less data
 * transferred, so background video, animated imagery and other "expensive"
 * decoration should be dropped.
 *
 * NEW. Until this existed, `prefers-reduced-data` was honoured in exactly one
 * place — the `@media (prefers-reduced-data: reduce)` block in index.css, which
 * strips `backdrop-filter` and gradient backgrounds. See `prefersLessMotion()`
 * below for why it now also gates non-essential motion.
 */
export function prefersReducedData(): boolean {
  return getMediaQueryList(REDUCED_DATA_QUERY)?.matches === true;
}

/**
 * THE POLICY DECISION — "less data" also implies "less motion".
 *
 * `prefers-reduced-data` is nominally about bytes, not about vestibular
 * comfort. But in practice the two preferences are set by the same users and
 * the same platform settings: someone on a metered connection on a hospital
 * hotspot is also the person who has "reduce motion" switched on at the OS
 * level. Treating them as orthogonal produced a UI that streamed a 200-row
 * staggered table entrance over a slow link — the animation cost both
 * bandwidth-equivalent CPU and made the first screen take seconds to settle.
 *
 * So: `prefers-reduced-data` disables *non-essential* motion (entrances,
 * shimmer loops, ambient gradients, shared-layout choreography). It does NOT
 * disable motion that carries meaning or feedback — press states, focus
 * transitions, spinners, and anything that confirms an action happened — and it
 * never removes a state indicator. Nothing a clinician needs in order to read
 * a study is animation-gated.
 */
export function prefersLessMotion(): boolean {
  return prefersReducedMotion() || prefersReducedData();
}

/**
 * Subscribe to a media query, tolerating both the modern (`addEventListener`)
 * and legacy (`addListener`) MediaQueryList shapes and a completely missing
 * `matchMedia`. Returns an unsubscribe function that is always safe to call.
 */
export function subscribeToMediaQuery(
  query: string,
  onChange: () => void,
): () => void {
  const mql = getMediaQueryList(query);
  if (!mql) return () => {};

  if (typeof mql.addEventListener === "function") {
    const handler = () => onChange();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }

  // Safari < 14 and jsdom polyfills only expose the deprecated API.
  if (typeof mql.addListener === "function") {
    const handler = () => onChange();
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }

  return () => {};
}

/**
 * Reactive, SSR-safe subscription to a single media query.
 *
 * Uses `useSyncExternalStore` so the value is read during render (no flash of
 * "motion allowed" on the first frame) while still tearing down cleanly.
 * `getServerSnapshot` returns `false`, i.e. motion allowed, which matches the
 * imperative fallback above.
 */
export function useMediaPreference(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToMediaQuery(query, onChange),
    [query],
  );
  const getSnapshot = useCallback(
    () => getMediaQueryList(query)?.matches === true,
    [query],
  );
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Reactive form of {@link prefersReducedMotion}. */
export function usePrefersReducedMotion(): boolean {
  return useMediaPreference(REDUCED_MOTION_QUERY);
}

/** Reactive form of {@link prefersReducedData}. */
export function usePrefersReducedData(): boolean {
  return useMediaPreference(REDUCED_DATA_QUERY);
}