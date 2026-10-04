import * as React from "react"
import { Loader2 } from "lucide-react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  // `.pressable` (src/index.css) supplies the transition AND the ~2% press
  // scale. It is a plain CSS class rather than more Tailwind utilities because
  // it has to be expressible in one place for the `disabled` /
  // `aria-disabled` exclusion and the reduced-motion override to line up.
    " hover-elevate active-elevate-2 pressable",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Show a spinner in place of the label, without changing the button's box.
   *
   * WHY NOT THE OBVIOUS `disabled` + swap-the-label. Two reasons, both of them
   * usability bugs rather than style issues:
   *
   *  1. LAYOUT SHIFT. Swapping "Save report" for "Saving…" changes the intrinsic
   *    width of the button, which moves every control to its right — often the
   *    Cancel button, on the exact frame the user is most likely to be moving
   *    toward it. On a submit that is a real mis-click. The label here keeps
   *    its box and the spinner is absolutely positioned over it, so the
   *    measured width of the button is identical in both states.
   *  2. DOUBLE SUBMIT. The native `disabled` attribute is set, so Enter-to-
   *    submit from a field in the same form cannot fire a second request
   *    either — `aria-disabled` alone would not stop that. `aria-disabled` is
   *    set as well so assistive tech reports the state rather than silently
   *    swallowing the click. This matches LoadingButton, which also disables.
   *
   * The label is faded with `opacity-0` rather than hidden, because
   * `visibility: hidden` would remove it from the accessibility tree and the
   * button would announce itself as "Loading" instead of by its own name.
   */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, onClick, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button"
    // `asChild` renders onto whatever the caller passed — usually an <a> via
    // DesktopLink, where `disabled` is not a valid attribute and does nothing.
    // For those, `aria-disabled` plus a dead click handler is the equivalent.
    const inert = disabled || loading || undefined
    const handleClick = loading
      ? (event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          event.stopPropagation()
        }
      : onClick

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? disabled : inert}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        data-loading={loading ? "" : undefined}
        onClick={handleClick}
        {...props}
      >
        <span className="relative inline-flex items-center justify-center gap-2">
          <span
            className={cn(
              "inline-flex items-center justify-center gap-2",
              loading && "opacity-0",
            )}
          >
            {children}
          </span>
          {loading && (
            <span
              className="absolute inset-0 grid place-items-center"
              aria-hidden="true"
            >
              <Loader2 className="size-4 animate-motion-spin" />
            </span>
          )}
        </span>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }