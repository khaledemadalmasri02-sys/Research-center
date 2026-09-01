import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarHeaderProps = {
  expanded: boolean;
  brandName: string;
  brandIcon: LucideIcon;
  onToggle: () => void;
};

export function SidebarHeader({
  expanded,
  brandName,
  brandIcon,
  onToggle,
}: SidebarHeaderProps) {
  const BrandIcon = brandIcon;
  const ToggleIcon = expanded ? PanelLeftClose : PanelLeftOpen;

  return (
    <div className="flex h-12 items-center justify-between px-3">
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.1 }}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <BrandIcon className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="truncate text-sm font-bold uppercase tracking-wide text-gray-800">
              {brandName}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <ToggleIcon className="h-5 w-5" strokeWidth={2} />
      </button>
    </div>
  );
}
