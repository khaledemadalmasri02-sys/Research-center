import * as React from "react"
import { useTranslation } from "react-i18next"
import { DURATION, EASE_OUT, shouldReduceMotion, useMotionPrefs } from "@/lib/motion"
import { motion } from "framer-motion"

interface SkipToContentProps {
  /** id of the element to focus when activated. Default "main-content". */
  targetId?: string
}

/**
 * Hidden until focused, then snaps the user past the nav. The
 * corresponding element should have `id="main-content"` and `tabIndex={-1}`
 * (the latter so programmatic focus is allowed even if the element isn't
 * normally focusable).
 *
 * The click is intercepted rather than left to native fragment navigation
 * because `#main-content` is no longer unique: during a route transition the
 * outgoing page stays mounted for 180ms so the two can cross-fade, so the
 * document transiently holds one `#main-content` per page and a fragment jump
 * resolves to the FIRST match — the page being removed. Activating the skip
 * link would then move focus into a subtree that disappears a frame later,
 * leaving a keyboard user on `<body>` with no focus ring anywhere.
 *
 * `href` is kept so the link still works with middle-click / "open in new tab"
 * / JS disabled, and the modifier keys are left to the browser.
 */
export function SkipToContent({ targetId = "main-content" }: SkipToContentProps) {
  const { t } = useTranslation()
  const reducedMotion = shouldReduceMotion(useMotionPrefs())

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return

    const selector = `#${CSS.escape(targetId)}`
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector))
    if (matches.length === 0) return
    // Skip route layers that are mid-exit, then take the last match: the
    // incoming layer is appended after the outgoing one.
    const live = matches.filter((m) => m.closest("[data-route-state='exiting']") === null)
    const pool = live.length > 0 ? live : matches
    const target = pool[pool.length - 1]
    if (!target) return

    e.preventDefault()
    // The target is present and focusable right now (an exiting layer is
    // `inert`), so there is no "wait for the transition" step: focusing and
    // scrolling happen in the same tick as the click.
    target.focus({ preventScroll: true })
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" })
    } else {
      target.scrollTop = 0
    }
  }

  return (
    <a
      href={`#${targetId}`}
      onClick={onClick}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {/* The link is `sr-only` until focused, so the entrance runs exactly when
          it becomes visible. Transform + opacity only. */}
      <motion.span
        className="inline-flex items-center"
        initial={reducedMotion ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: DURATION.fast, ease: EASE_OUT }}
      >
        {t("a11y.skipToContent")}
      </motion.span>
    </a>
  )
}