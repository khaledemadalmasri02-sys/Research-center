"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      // `transition-all` -> `transition-transform`. The indicator's only animated
      // property is the inline `transform: translateX(-N%)`; `transition-all`
      // also made `width` animatable, which is a per-frame layout on a
      // determinate progress bar that is updated many times a second.
      // `dur-base` (280ms) so a fast stream of value updates reads as motion.
      className="h-full w-full flex-1 bg-primary transition-transform dur-base ease-curve-out"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
