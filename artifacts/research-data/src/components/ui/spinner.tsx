import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      // `animate-motion-spin` is our own keyframe on the --dur-spin loop scale
      // (900ms), rather than Tailwind's `animate-spin`. A busy indicator is the
      // one animation in the app that is *never* reduced away: removing it
      // leaves the user with no signal that anything is happening. The global
      // `prefers-reduced-motion` block still clamps its duration to ~0, which
      // for a loop means it holds its first frame instead of spinning.
      className={cn("size-4 animate-motion-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
