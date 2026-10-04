import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  // WCAG 2.5.8 Target Size (Minimum, AA) requires a 24x24 CSS px pointer
  // target. The visual box stays 16px so dense table rows do not change
  // height; the hit area is grown with a `::after` overlay on the button
  // itself (16px + 2 x 6px from -inset-1.5 = 28px). The wrapper span keeps a
  // 24px layout box so the control does not crowd its neighbours and so the
  // enlarged region has room, and it is `pointer-events-none` so every click
  // inside it lands on the button. `peer` stays on the button because the
  // `peer-disabled:` / `peer-checked:` variants in label.tsx resolve against a
  // following sibling, which is unchanged by the wrapper.
  <span
    className="pointer-events-none relative inline-flex h-6 w-6 shrink-0 items-center justify-center"
  >
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer relative grid place-content-center h-4 w-4 rounded-sm border border-primary shadow after:absolute after:-inset-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("grid place-content-center text-current")}
      >
        <Check className="h-4 w-4" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  </span>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
