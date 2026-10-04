import * as React from "react"

/**
 * Viewport tiers.
 *
 * `MOBILE_BREAKPOINT` is FROZEN. `useIsMobile()` gates the bottom nav and is
 * mirrored by the non-reactive `matchMobile()` guard in `@/lib/desktop-mode`
 * (`max-width: 767px`), so moving this number would change which shell boots
 * on a phone in a way no single owner could reason about. It stays at 768.
 */
const MOBILE_BREAKPOINT = 768

/**
 * Tablet tier. Between MOBILE_BREAKPOINT and this width the layout gets the
 * desktop chrome (sidebar + top bar), but at 768–1280 there is not enough room
 * for a 280px sidebar *plus* a readable data table, and the desktop shell's
 * window manager is landscape-designed: below 1280 two side-by-side windows
 * leave ~380px each, which is unusable for a patient record.
 *
 * Consumers use this to pick a single-column shell instead of asserting
 * `!useIsMobile()` and being wrong in the 768–1280 band.
 */
const TABLET_BREAKPOINT = 1024

export type ViewportTier = "mobile" | "tablet" | "desktop"

/**
 * Subscribes to a max-width query. Starts as `false` and is corrected in the
 * first effect, matching the previous `useIsMobile()` contract exactly: the
 * first render commits the desktop shell and the very next tick corrects it.
 * Reading `window.innerWidth` during render instead would desynchronise
 * jsdom (where the viewport is fixed at 1024) from the matchMedia query other
 * code (`lib/desktop-mode`) evaluates, which is how the phone guard and the
 * chrome disagree on first paint.
 *
 * The listener is also re-armed whenever the query changes, so a future
 * non-constant query cannot leak a listener bound to a stale threshold.
 */
function useMaxWidth(breakpoint: number): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`
  const [matches, setMatches] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => {
      setMatches(window.innerWidth < breakpoint)
    }
    mql.addEventListener("change", onChange)
    setMatches(window.innerWidth < breakpoint)
    return () => mql.removeEventListener("change", onChange)
  }, [query, breakpoint])

  return matches
}

/** True below 768px. Unchanged behaviour — see MOBILE_BREAKPOINT. */
export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT)
}

/**
 * True from 768px up to 1023px: a tablet in landscape, or a small window on a
 * desktop. Mutually exclusive with `useIsMobile()` by construction (the phone
 * query is strictly narrower).
 */
export function useIsTablet() {
  return useMaxWidth(TABLET_BREAKPOINT) && !useMaxWidth(MOBILE_BREAKPOINT)
}

/**
 * Single-subscriber tier for code that needs the label rather than a boolean.
 * Prefer the dedicated hooks above: this one re-renders on every crossing of
 * 768 *and* 1024 even when the caller only cares about one edge.
 */
export function useViewportTier(): ViewportTier {
  const tablet = useMaxWidth(TABLET_BREAKPOINT)
  const mobile = useMaxWidth(MOBILE_BREAKPOINT)
  if (mobile) return "mobile"
  if (tablet) return "tablet"
  return "desktop"
}

export { MOBILE_BREAKPOINT, TABLET_BREAKPOINT }