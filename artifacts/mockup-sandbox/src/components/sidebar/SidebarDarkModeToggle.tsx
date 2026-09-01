import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarDarkModeToggleProps = {
  dark: boolean;
  expanded: boolean;
  onToggle: () => void;
  index: number;
};

export function SidebarDarkModeToggle({
  dark,
  expanded,
  onToggle,
  index,
}: SidebarDarkModeToggleProps) {
  return (
    <div
      className={cn(
        "group relative flex w-full items-center rounded-xl py-2.5",
        expanded ? "gap-3 px-3" : "justify-center",
        "hover:bg-gray-100",
      )}
    >
      <Moon
        className={cn(
          "h-5 w-5 shrink-0 transition-colors",
          dark ? "text-violet-600" : "text-gray-400",
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
            className="relative z-10 flex-1 truncate whitespace-nowrap text-sm font-semibold text-gray-500"
          >
            Dark Mode
          </motion.span>
        )}
      </AnimatePresence>

      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Toggle dark mode"
        onClick={onToggle}
        className={cn(
          "relative z-10 inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          dark ? "bg-violet-600" : "bg-gray-300",
        )}
      >
        <motion.span
          animate={{ x: dark ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="mx-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </button>
    </div>
  );
}
