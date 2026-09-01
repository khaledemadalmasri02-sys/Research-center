import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type SidebarUserProps = {
  expanded: boolean;
  name: string;
  role: string;
  avatarUrl?: string;
};

export function SidebarUser({
  expanded,
  name,
  role,
  avatarUrl,
}: SidebarUserProps) {
  return (
    <div
      className={cn(
        "flex items-center rounded-xl py-2",
        expanded ? "gap-3 px-3" : "justify-center px-0",
      )}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-100 text-sm font-semibold text-violet-700 ring-1 ring-violet-200">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
        )}
      </span>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: 0.1 }}
            className="min-w-0 flex-1 leading-tight"
          >
            <p className="truncate text-sm font-bold text-gray-800">{name}</p>
            <p className="truncate text-xs font-medium text-gray-400">{role}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
