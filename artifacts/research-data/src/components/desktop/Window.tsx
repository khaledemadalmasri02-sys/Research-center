import { Suspense, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion, useMotionValue } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useDesktop } from "./window-store";
import { TrafficLights } from "./chrome";
import type { DesktopWindow } from "./window-store";
import type { AppDef } from "./app-registry";

const MIN_W = 360;
const MIN_H = 240;

interface WindowProps {
  win: DesktopWindow;
  app: AppDef;
  areaRef: RefObject<HTMLDivElement | null>;
  mobile?: boolean;
}

/* ---- SVG window controls (Ubuntu-style) ---- */
function MinIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function MaxIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <rect x="3" y="2" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 4.5 V9.5 a1 1 0 0 0 1 1 H8.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function GripIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-3 w-3 text-white/40" fill="currentColor">
      <circle cx="7" cy="7" r="1" />
      <circle cx="9" cy="9" r="1" />
      <circle cx="7" cy="9" r="1" />
      <circle cx="9" cy="7" r="1" />
    </svg>
  );
}

const RESIZE_HANDLES: { dir: string; cls: string }[] = [
  { dir: "n", cls: "top-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { dir: "s", cls: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { dir: "e", cls: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize" },
  { dir: "w", cls: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize" },
  { dir: "ne", cls: "top-0 right-0 h-3 w-3 cursor-nesw-resize" },
  { dir: "nw", cls: "top-0 left-0 h-3 w-3 cursor-nwse-resize" },
  { dir: "se", cls: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize" },
  { dir: "sw", cls: "bottom-0 left-0 h-3 w-3 cursor-nwse-resize" },
];

export function Window({ win, app, areaRef, mobile }: WindowProps) {
  const { t } = useTranslation();
  const { activeId, focus, minimize, close, toggleMaximize, move, setRect } = useDesktop();
  const isActive = activeId === win.id;

  const x = useMotionValue(win.x);
  const y = useMotionValue(win.y);
  useEffect(() => {
    x.set(win.x);
    y.set(win.y);
  }, [win.x, win.y, x, y]);

  const handleMaximize = () => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    toggleMaximize(win.id, { x: 0, y: 0, w: rect.width, h: rect.height });
  };

  const clampToArea = (rect: { x: number; y: number; w: number; h: number }) => {
    const area = areaRef.current;
    if (!area) return rect;
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const w = Math.max(MIN_W, Math.min(rect.w, aw));
    const h = Math.max(MIN_H, Math.min(rect.h, ah));
    const x = Math.max(0, Math.min(rect.x, aw - w));
    const y = Math.max(0, Math.min(rect.y, ah - h));
    return { x, y, w, h };
  };

  useEffect(() => {
    if (win.maximized || mobile) return;
    const c = clampToArea({ x: win.x, y: win.y, w: win.w, h: win.h });
    if (c.x !== win.x || c.y !== win.y || c.w !== win.w || c.h !== win.h) {
      x.set(c.x);
      y.set(c.y);
      setRect(win.id, { x: c.x, y: c.y, w: c.w, h: c.h });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startResize = (dir: string) => (e: React.PointerEvent) => {
    if (win.maximized || mobile) return;
    e.preventDefault();
    e.stopPropagation();
    const area = areaRef.current;
    if (!area) return;
    const areaRect = area.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const s = { x: win.x, y: win.y, w: win.w, h: win.h };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let { x, y, w, h } = s;
      if (dir.includes("e")) w = s.w + dx;
      if (dir.includes("s")) h = s.h + dy;
      if (dir.includes("w")) {
        w = s.w - dx;
        x = s.x + (s.w - w);
      }
      if (dir.includes("n")) {
        h = s.h - dy;
        y = s.y + (s.h - h);
      }
      // Enforce minimum size, adjusting the anchored edge so it stays put.
      if (w < MIN_W) {
        if (dir.includes("w")) x = s.x + (s.w - MIN_W);
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes("n")) y = s.y + (s.h - MIN_H);
        h = MIN_H;
      }
      // Clamp inside the workspace like Ubuntu (no dragging the window off-screen).
      if (x < 0) {
        if (dir.includes("w")) w += x;
        x = 0;
      }
      if (y < 0) {
        if (dir.includes("n")) h += y;
        y = 0;
      }
      if (x + w > areaRect.width) w = areaRect.width - x;
      if (y + h > areaRect.height) h = areaRect.height - y;
      setRect(win.id, {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const Icon = app.iconSvg ?? app.icon;

  // ---- Ubuntu-style edge snapping (drag to edge/corner to tile) ----
  type SnapZone = "left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br";
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);

  const computeSnapZone = (left: number, top: number, w: number, h: number, W: number, H: number): SnapZone | null => {
    const t = 18;
    const right = left + w;
    const bottom = top + h;
    const nearLeft = left <= t;
    const nearRight = right >= W - t;
    const nearTop = top <= t;
    const nearBottom = bottom >= H - t;
    if (nearTop && nearLeft) return "tl";
    if (nearTop && nearRight) return "tr";
    if (nearBottom && nearLeft) return "bl";
    if (nearBottom && nearRight) return "br";
    if (nearLeft) return "left";
    if (nearRight) return "right";
    if (nearTop) return "top";
    if (nearBottom) return "bottom";
    return null;
  };

  const applySnap = (zone: SnapZone, W: number, H: number) => {
    const halfW = Math.round(W / 2);
    const halfH = Math.round(H / 2);
    switch (zone) {
      case "left":
        return setRect(win.id, { x: 0, y: 0, w: halfW, h: H });
      case "right":
        return setRect(win.id, { x: W - halfW, y: 0, w: halfW, h: H });
      case "top":
        return toggleMaximize(win.id, { x: 0, y: 0, w: W, h: H });
      case "bottom":
        return setRect(win.id, { x: 0, y: H - halfH, w: W, h: halfH });
      case "tl":
        return setRect(win.id, { x: 0, y: 0, w: halfW, h: halfH });
      case "tr":
        return setRect(win.id, { x: W - halfW, y: 0, w: halfW, h: halfH });
      case "bl":
        return setRect(win.id, { x: 0, y: H - halfH, w: halfW, h: halfH });
      case "br":
        return setRect(win.id, { x: W - halfW, y: H - halfH, w: halfW, h: halfH });
    }
  };

  const snapPreviewStyle = (zone: SnapZone, W: number, H: number): React.CSSProperties => {
    const halfW = Math.round(W / 2);
    const halfH = Math.round(H / 2);
    const m = 4;
    const base = { position: "absolute" as const, pointerEvents: "none" as const, borderRadius: 12, inset: m };
    switch (zone) {
      case "left":
        return { ...base, left: m, top: m, width: halfW - m, height: H - m * 2 };
      case "right":
        return { ...base, left: halfW, top: m, width: halfW - m, height: H - m * 2 };
      case "top":
        return { ...base, left: m, top: m, right: m, bottom: m, width: "auto", height: "auto" };
      case "bottom":
        return { ...base, left: m, top: H - halfH, width: W - m * 2, height: halfH - m };
      case "tl":
        return { ...base, left: m, top: m, width: halfW - m, height: halfH - m };
      case "tr":
        return { ...base, left: halfW, top: m, width: halfW - m, height: halfH - m };
      case "bl":
        return { ...base, left: m, top: H - halfH, width: halfW - m, height: halfH - m };
      case "br":
        return { ...base, left: halfW, top: H - halfH, width: halfW - m, height: halfH - m };
    }
  };

  return (
    <motion.div
      drag={!win.maximized && !mobile}
      dragMomentum={false}
      dragConstraints={areaRef as unknown as RefObject<HTMLElement>}
      dragElastic={0}
      whileDrag={{ cursor: "grabbing" }}
      onPointerDown={() => focus(win.id)}
      onDrag={(_, info) => {
        const area = areaRef.current;
        if (!area) return;
        setSnapZone(computeSnapZone(x.get(), y.get(), win.w, win.h, area.clientWidth, area.clientHeight));
      }}
      onDragEnd={() => {
        const area = areaRef.current;
        if (area && snapZone) {
          applySnap(snapZone, area.clientWidth, area.clientHeight);
          setSnapZone(null);
          return;
        }
        setSnapZone(null);
        const c = clampToArea({ x: x.get(), y: y.get(), w: win.w, h: win.h });
        x.set(c.x);
        y.set(c.y);
        move(win.id, c.x, c.y);
      }}
      style={{ x, y, width: win.w, height: win.h, pointerEvents: win.minimized ? "none" : "auto" }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={win.minimized ? { opacity: 0, scale: 0.85 } : { opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "absolute left-0 top-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-2xl backdrop-blur-[var(--glass-blur)] backdrop-saturate-150",
        isActive ? "ring-1 ring-[var(--accent-brand)]" : "",
        win.maximized && "rounded-none",
      )}
    >
      <div
        onDoubleClick={mobile ? undefined : handleMaximize}
        className={cn(
          "glass-titlebar flex h-9 shrink-0 items-center gap-2 px-2 select-none",
          !mobile && "cursor-grab active:cursor-grabbing",
          isActive ? "bg-[var(--accent-soft)]" : "bg-black/20",
        )}
      >
        <TrafficLights
          onClose={() => close(win.id)}
          onMinimize={() => minimize(win.id)}
          onMaximize={handleMaximize}
          className="pl-1"
        />
        <Icon className="h-4 w-4 shrink-0 text-[var(--accent-brand)]" />
        <span className="flex-1 truncate text-sm font-medium">{t(app.titleKey)}</span>
        <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" title={t("desktop.minimize")} aria-label={t("desktop.minimize")} onClick={() => minimize(win.id)} className="grid h-7 w-7 place-items-center rounded text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10">
            <MinIcon />
          </button>
          <button type="button" title={win.maximized ? t("desktop.restore") : t("desktop.maximize")} aria-label={win.maximized ? t("desktop.restore") : t("desktop.maximize")} onClick={handleMaximize} className="grid h-7 w-7 place-items-center rounded text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10">
            {win.maximized ? <RestoreIcon /> : <MaxIcon />}
          </button>
          <button type="button" title={t("desktop.close")} aria-label={t("desktop.close")} onClick={() => close(win.id)} className="grid h-7 w-7 place-items-center rounded text-foreground/80 hover:bg-destructive hover:text-destructive-foreground">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-background/90">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          }
        >
          <app.loader />
        </Suspense>
      </div>

      {!win.minimized && !win.maximized && !mobile &&
        RESIZE_HANDLES.map((h) => (
          <div key={h.dir} onPointerDown={startResize(h.dir)} className={cn("absolute z-10", h.cls)}>
            {h.dir === "se" && (
              <div className="absolute bottom-0.5 right-0.5">
                <GripIcon />
              </div>
            )}
          </div>
        ))}

      {snapZone && areaRef.current &&
        createPortal(
          <div
            style={snapPreviewStyle(snapZone, areaRef.current.clientWidth, areaRef.current.clientHeight)}
            className="pointer-events-none absolute z-[1] bg-primary/20 ring-2 ring-primary/40"
          />,
          areaRef.current,
        )}
    </motion.div>
  );
}
