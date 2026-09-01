import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useNotifications, useMarkNotificationRead } from "@/hooks/use-notifications";

interface Toast {
  key: string;
  id: number;
  title: string;
  body: string;
}

const TTL = 6000;

export function DesktopToasts() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef<Set<number>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    const items = data?.notifications ?? [];
    if (!seeded.current) {
      items.forEach((n) => shown.current.add(n.id));
      seeded.current = true;
      return;
    }
    const fresh = items.filter((n) => !shown.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => shown.current.add(n.id));
    const newToasts: Toast[] = fresh.map((n) => ({
      key: `t-${n.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      id: n.id,
      title: n.title,
      body: n.body,
    }));
    setToasts((prev) => [...prev, ...newToasts]);
    newToasts.forEach((tt) => {
      setTimeout(() => {
        setToasts((prev) => prev.filter((p) => p.key !== tt.key));
      }, TTL);
    });
  }, [data]);

  const dismiss = (tt: Toast) => {
    setToasts((prev) => prev.filter((p) => p.key !== tt.key));
    markRead.mutate(tt.id);
  };

  return (
    <div className="pointer-events-none absolute right-3 top-12 z-50 flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((tt) => (
          <motion.div
            key={tt.key}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto rounded-lg border border-white/10 bg-zinc-900/90 p-3 text-white shadow-2xl backdrop-blur"
          >
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">{tt.title}</p>
                {tt.body && (
                  <p className="line-clamp-3 text-xs text-white/70">{tt.body}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(tt)}
                className="text-white/60 transition hover:text-white"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
