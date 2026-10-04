import * as React from "react"

import { cn } from "@/lib/utils"

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Is this card itself activatable — a link, a button, or a `tabIndex` +
   * `onClick` / `role="button"` container?
   *
   * Default false, and that default is the point. The legacy `hoverLift`
   * (applied via `<StaggerItem lift>`, still used in src/pages/home.tsx) lifted
   * every card it wrapped, including read-only ones whose only controls were
   * buttons nested inside them. A card that rises under the pointer advertises
   * "click me", and a radiologist aiming for the Open button inside a
   * non-interactive card gets a target that moved. So the lift, the pointer
   * cursor and the shadow change are opt-in and must be paired with the
   * keyboard semantics that make it real — do not use this prop as a
   * substitute for a link.
   *
   * Set it on the card, then put `role="button"` + `tabIndex={0}` (or
   * `role="link"`) and a keyboard handler on it, or leave it false and put
   * motion on the actual control inside.
   */
  interactive?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      data-interactive={interactive ? "" : undefined}
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow",
        // `.card-interactive` (src/index.css) is a 2px lift plus a shadow
        // step, on --dur-base/--ease-out. `transform` and `box-shadow` are
        // both layout-neutral, and the reduced-motion + reduced-data blocks
        // null the transform so nothing is displaced under the pointer.
        interactive && "card-interactive",
        className
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }