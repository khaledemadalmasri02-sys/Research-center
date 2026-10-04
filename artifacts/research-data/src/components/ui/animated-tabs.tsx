import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

/**
 * AnimatedTabs — a drop-in `<Tabs>` alternative that slides a
 * background pill between triggers using framer-motion's `layoutId`.
 *
 * How it works: every trigger renders an absolutely-positioned
 * <motion.span> with the same `layoutId`. Only the active one is
 * visible (opacity 1, others opacity 0). When the active trigger
 * changes, framer measures both elements' bounding boxes and animates
 * the pill from the old to the new position.
 *
 * Respects `prefers-reduced-motion` because the global
 * `<MotionConfig reducedMotion="user">` in App.tsx short-circuits the
 * layout animation — the pill snaps to position instead of sliding.
 *
 * Usage:
 *   <AnimatedTabs defaultValue="overview">
 *     <AnimatedTabsList>
 *       <AnimatedTabsTrigger value="overview">Overview</AnimatedTabsTrigger>
 *       <AnimatedTabsTrigger value="results">Results</AnimatedTabsTrigger>
 *     </AnimatedTabsList>
 *     <AnimatedTabsContent value="overview">…</AnimatedTabsContent>
 *     <AnimatedTabsContent value="results">…</AnimatedTabsContent>
 *   </AnimatedTabs>
 */

const AnimatedTabs = TabsPrimitive.Root

const AnimatedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "relative inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </TabsPrimitive.List>
))
AnimatedTabsList.displayName = "AnimatedTabsList"

/**
 * Each trigger renders its own motion pill with the shared layoutId.
 * The pill is only visible (opacity 1) when the trigger is active.
 * Framer animates the pill's position between consecutive active
 * triggers because both motion spans are mounted simultaneously.
 */
const AnimatedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
      className,
    )}
    {...props}
  >
    <motion.span
      aria-hidden
      layoutId="animated-tabs-pill"
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-background opacity-0 shadow-sm transition-opacity data-[state=active]:opacity-100"
    />
    <span className="relative z-10 inline-flex items-center gap-2">
      {children}
    </span>
  </TabsPrimitive.Trigger>
))
AnimatedTabsTrigger.displayName = "AnimatedTabsTrigger"

const AnimatedTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
))
AnimatedTabsContent.displayName = "AnimatedTabsContent"

export {
  AnimatedTabs,
  AnimatedTabsList,
  AnimatedTabsTrigger,
  AnimatedTabsContent,
}
