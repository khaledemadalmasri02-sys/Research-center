import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `.field-focus-transition` (src/index.css) animates `border-color`
        // AND `box-shadow` together, on --dur-fast. The previous
        // `transition-colors` listed neither shadow, so the focus ring popped
        // in over a single frame while the border was still easing — the two
        // halves of one focus indicator arrived at different times.
        //
        // `focus-visible:border-ring` is what actually gives that transition
        // something to animate: the border used to be static across focus, so
        // the whole transition was invisible and only the ring appeared.
        //
        // Nothing here animates a layout property. `border-color` keeps the
        // border width, and the ring is a box-shadow, so focusing a field can
        // never reflow the form around it.
        //
        // NOTE: the global `:focus-visible` outline in index.css is
        // deliberately NOT suppressed here. See the comment above Input's
        // variant list for why that suppression was removed.
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm field-focus-transition file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
