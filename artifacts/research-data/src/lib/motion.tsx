import { motion, type Variants, type HTMLMotionProps, type TargetAndTransition } from "framer-motion";
import { type ReactNode } from "react";

/** Smooth, slightly overshooting easing used across the app. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Container that staggers the entrance of its direct <StaggerItem> children. */
export const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

/** Entrance animation for a single staggered child. */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE_OUT },
  },
};

/** Subtle lift used on hover for interactive cards. */
export const hoverLift: TargetAndTransition = {
  y: -4,
  transition: { type: "spring", stiffness: 320, damping: 24 },
};

interface StaggerProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /** Delay before the first child animates in. */
  delay?: number;
  /** Gap between each child's animation. */
  stagger?: number;
}

export function Stagger({
  children,
  delay = 0.04,
  stagger = 0.07,
  ...props
}: StaggerProps) {
  return (
    <motion.div
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      initial="hidden"
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /** Apply a hover lift (great for cards). */
  lift?: boolean;
}

export function StaggerItem({
  children,
  lift = false,
  ...props
}: StaggerItemProps) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={lift ? hoverLift : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface FadeInProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  delay?: number;
  y?: number;
}

/** Fades + slides a single block of content into view. */
export function FadeIn({ children, delay = 0, y = 12, ...props }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
