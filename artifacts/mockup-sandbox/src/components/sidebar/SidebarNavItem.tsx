import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Renders a logout / destructive style row. */
  variant?: "default" | "logout";
};

type SidebarNavItemProps = {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  index: number;
  onSelect: (id: string) => void;
};

export function SidebarNavItem({
  item,
  active,
  expanded,
  index,
  onSelect,
}: SidebarNavItemProps) {
  const Icon = item.icon;
  const isLogout = item.variant === "logout";

  const labelColor = active
    ? "text-violet-600"
    : isLogout
      ? "text-gray-400 group-hover:text-rose-500"
      : "text-gray-400 group-hover:text-gray-600";

  const iconColor = active
    ? "text-violet-600"
    : isLogout
      ? "text-gray-400 group-hover:text-rose-500"
      : "text-gray-400 group-hover:text-gray-600";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      title={!expanded ? item.label : undefined}
      className={cn(
        "group relative flex w-full items-center rounded-xl py-2.5 text-sm font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        expanded ? "gap-3 px-3" : "justify-center",
        !active && (isLogout ? "hover:bg-rose-50" : "hover:bg-gray-100"),
      )}
    >
      {/* Active pill (expanded) — shared layout element so it slides between items */}
      {active && expanded && (
        <>
          <motion.span
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl bg-violet-50"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
          <motion.span
            layoutId="sidebar-active-bar"
            className="absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l-full bg-violet-600"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          />
        </>
      )}

      {/* Active highlight (collapsed) */}
      {active && !expanded && (
        <span className="absolute inset-x-2 inset-y-1 rounded-xl bg-violet-50" />
      )}

      <Icon
        className={cn(
          "relative z-10 h-5 w-5 shrink-0 transition-colors",
          iconColor,
        )}
        strokeWidth={2}
      />

      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{
              duration: 0.2,
              ease: "easeOut",
              delay: 0.08 + index * 0.025,
            }}
            className={cn(
              "relative z-10 truncate whitespace-nowrap font-semibold",
              labelColor,
              active && "font-bold",
            )}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
