import * as React from "react"
import { Loader2 } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface LoadingButtonProps extends ButtonProps {
  loading?: boolean
  /** Text shown while loading. Defaults to children. */
  loadingLabel?: React.ReactNode
  /** Position of the loading spinner. Default "left". */
  loadingPosition?: "left" | "right"
  /**
   * Pre-load width capture: when true, the button measures itself on
   * first render and reserves the same width while in the loading
   * state to prevent layout shift. Default true.
   */
  preserveWidth?: boolean
}

/**
 * Button with an inline loading state.
 *
 * - Reserves width on first render so a pending request doesn't shift
 *   surrounding controls.
 * - Disables the button while `loading` is true.
 * - Exposes `aria-busy` for assistive tech.
 *
 * NOTE: `Button` now has a built-in `loading` prop that reserves the box by
 * overlaying the spinner instead of measuring, so it works in environments
 * where `getBoundingClientRect()` returns 0 (jsdom, hidden ancestors). Prefer
 * `<Button loading>` for new call sites; this component is kept because ~20
 * existing pages import it, and because `loadingLabel` has no Button equivalent.
 */
export const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  function LoadingButton(
    {
      loading = false,
      loadingLabel,
      loadingPosition = "left",
      preserveWidth = true,
      disabled,
      className,
      children,
      onClick,
      type = "button",
      ...props
    },
    ref,
  ) {
    const innerRef = React.useRef<HTMLSpanElement | null>(null)
    const [reservedWidth, setReservedWidth] = React.useState<number | null>(null)

    // Measure on first non-loading render so the loading state keeps the
    // same outer width.
    React.useEffect(() => {
      if (!preserveWidth) return
      if (loading) return
      if (reservedWidth != null) return
      const el = innerRef.current
      if (!el) return
      const w = el.getBoundingClientRect().width
      if (w > 0) setReservedWidth(Math.ceil(w))
    }, [preserveWidth, loading, reservedWidth, children])

    const isDisabled = !!disabled || loading
    const label = loading && loadingLabel != null ? loadingLabel : children

    return (
      <Button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        onClick={onClick}
        style={reservedWidth != null ? { width: reservedWidth } : undefined}
        className={cn(className)}
        {...props}
      >
        <span
          ref={innerRef}
          className="inline-flex items-center justify-center gap-2"
          aria-live="polite"
        >
          {loading && loadingPosition === "left" && (
            <Loader2 className="h-4 w-4 animate-motion-spin" aria-hidden="true" />
          )}
          <span>{label}</span>
          {loading && loadingPosition === "right" && (
            <Loader2 className="h-4 w-4 animate-motion-spin" aria-hidden="true" />
          )}
        </span>
      </Button>
    )
  },
)
