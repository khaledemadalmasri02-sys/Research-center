import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  type Transition,
} from "framer-motion";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  MIN_W,
  MIN_H,
  clampRect,
  useActiveWindowId,
  useDesktopActions,
  type DesktopWindow,
} from "./window-store";
import { useSound } from "@/components/sound-provider";
import { resolveAppTitle, type AppDef } from "./app-registry";
import { Z, windowZ } from "./z-index";
import { getDockAnchor, getDockAnchorVersion } from "./dock-anchor";
import {
  DURATION,
  EASE_IN_OUT,
  EASE_OUT,
  INSTANT,
  SPRING,
  useDesktopMotion,
} from "./desktop-motion";

interface WindowProps {
  win: DesktopWindow;
  app: AppDef;
  areaRef: RefObject<HTMLDivElement | null>;
  mobile?: boolean;
}

/* ---- SVG window controls (Ubuntu/Adwaita style) ---- */
function MinIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
      <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function MaxIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
      <rect x="3" y="2" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 4.5 V9.5 a1 1 0 0 0 1 1 H8.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
      <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function GripIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-3 w-3 text-foreground/40" fill="currentColor" aria-hidden>
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

// ---- Ubuntu-style edge snapping (drag to edge/corner to tile) ----
type SnapZone = "left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br";

function computeSnapZone(left: number, top: number, w: number, h: number, W: number, H: number): SnapZone | null {
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
}

/* ---- minimize / restore choreography ----------------------------------- */

/**
 * Offsets + scale for one leg of the dock choreography.
 *
 * Everything is expressed relative to the window's OWN top-left corner so it
 * composes with framer's drag `x`/`y` motion values, which live on the parent
 * element (see the `style={{ x, y }}` below). The animated frame uses
 * `transform-origin: 0 0`, so a point `(px, py)` inside the window paints at
 * `(winX + x + scale*px, winY + y + scale*py)`.
 *
 * NOT a `layoutId`. See `dock-anchor.ts` for the full reason: both
 * participants would have to be mounted at all times (a minimized window must
 * stay in the DOM carrying `inert`/`aria-hidden`, and `visibility: hidden`
 * measures as a zero box), so framer's shared-layout projection would never see
 * a mount to animate from, and a per-app `layoutId` would be ambiguous for the
 * non-singleton apps. An explicit transform is exact, frame-budget-cheap and
 * testable — and it removes the one thing framer does *not* gate on
 * `prefers-reduced-motion`.
 */
interface DockTravel {
  scale: number;
  /** Puts the *centre* of the collapsed window on the dock icon's centre. */
  x: number;
  y: number;
  /** Puts the *top-left* of the collapsed window on the dock icon's top-left. */
  topLeftX: number;
  topLeftY: number;
}

const MIN_TRAVEL_SCALE = 0.05;
const MAX_TRAVEL_SCALE = 0.42;
/** No dock icon reachable (mobile rail hidden, app not pinned): shrink in place. */
const IN_PLACE_SCALE = 0.88;

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return IN_PLACE_SCALE;
  return Math.min(MAX_TRAVEL_SCALE, Math.max(MIN_TRAVEL_SCALE, value));
}

/**
 * Centre-preserving offsets for a frame with `transform-origin: 0 0`. Used when
 * there is no dock anchor, so the window scales from its own centre rather than
 * from its top-left corner (which is what a raw `0 0` origin would do).
 */
function centreTravel(win: DesktopWindow, scale: number): DockTravel {
  const dx = (win.w * (1 - scale)) / 2;
  const dy = (win.h * (1 - scale)) / 2;
  return { scale, x: dx, y: dy, topLeftX: dx, topLeftY: dy };
}

/**
 * Resolve the dock leg for this window.
 *
 * `useMemo`, not a render-phase `querySelector`: the dock publishes its button
 * rects into `dock-anchor.ts`, so this is a `Map.get` plus — only when the
 * memo actually re-runs — one `getBoundingClientRect()` on the workspace area.
 * The memo key includes the geometry and the registry version, so the numbers
 * are recomputed when the window moves or the dock resizes, and NOT on any
 * other re-render (focus changes, unrelated store churn).
 */
function useDockTravel(
  win: DesktopWindow,
  areaRef: RefObject<HTMLDivElement | null>,
): DockTravel | null {
  const version = getDockAnchorVersion();
  return useMemo(() => {
    const dock = getDockAnchor(win.appId);
    const area = areaRef.current;
    if (!dock || !area) return null;
    const areaRect = area.getBoundingClientRect();
    const dockCenterX = dock.left - areaRect.left + dock.width / 2;
    const dockCenterY = dock.top - areaRect.top + dock.height / 2;
    const scale = clampScale(Math.min(dock.width / Math.max(1, win.w), dock.height / Math.max(1, win.h)));
    return {
      scale,
      x: dockCenterX - win.x - (scale * win.w) / 2,
      y: dockCenterY - win.y - (scale * win.h) / 2,
      topLeftX: dock.left - areaRect.left - win.x,
      topLeftY: dock.top - areaRect.top - win.y,
    };
    // `version` is the registry's monotonic publish counter: a primitive, so it
    // is a cheap comparison, and it is what makes this recompute when the dock
    // expands, the app list changes or the workspace resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaRef, win.appId, win.x, win.y, win.w, win.h, version]);
}

/**
 * How long the window stays painted after the store has already flipped
 * `minimized: true`.
 *
 * The store is the single source of truth and flips synchronously, which is
 * what keeps the live-region announcement ("Minimized: <app>") from firing
 * before the visual change — the DOM change must NOT be deferred. So the
 * accessibility contract (`inert` + `aria-hidden` + `pointer-events: none`,
 * immediately) is kept exactly as it is, and only the *paint* is held, for the
 * length of the `SPRING.smooth` flight (~350 ms).
 */
const MINIMIZE_FLIGHT_MS = 400;

/**
 * The window body is memoized on `(loader, route, windowId)` so that a window
 * whose focus / z-index / accent ring changed does not re-render its whole page
 * tree (virtualized DataTable, DICOM canvas, 3D scene).
 */
const WindowBody = memo(function WindowBody({
  loader: Page,
  route,
  windowId,
}: {
  loader: AppDef["loader"];
  route: string | undefined;
  windowId: string;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background/90">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
      >
        <Page route={route} windowId={windowId} />
      </Suspense>
    </div>
  );
});

function WindowImpl({ win, app, areaRef, mobile }: WindowProps) {
  const { t } = useTranslation();
  const activeId = useActiveWindowId();
  const { focus, minimize, close, toggleMaximize, move, setRect } = useDesktopActions();
  const { play } = useSound();
  const { reducedMotion } = useDesktopMotion();
  const isActive = activeId === win.id;
  const titleId = useId();

  // Drag is driven from the title bar only. With framer's default
  // `dragListener` the gesture listener sits on the *root* motion.div, so
  // dragging any table cell, slider, checkbox or link inside a window moved the
  // window and broke text selection (framer only suppresses drag for text
  // inputs).
  const dragControls = useDragControls();

  const rootRef = useRef<HTMLDivElement>(null);

  const x = useMotionValue(win.x);
  const y = useMotionValue(win.y);
  useEffect(() => {
    x.set(win.x);
    y.set(win.y);
  }, [win.x, win.y, x, y]);

  const title = resolveAppTitle(t, app);

  /* ---- motion targets ------------------------------------------------- */
  const dockTravel = useDockTravel(win, areaRef);
  const inPlace = useMemo(() => centreTravel(win, IN_PLACE_SCALE), [win.w, win.h]);

  /**
   * Which leg we are on. `wasMinimizedRef` is written by the effect below, so
   * by the time the store flips back to `minimized: false` the render already
   * knows this is a restore (spring out of the dock) and not a fresh open
   * (spring out of the dock icon, at the dock icon's *top-left* so the small
   * initial box sits exactly on the icon).
   */
  const wasMinimizedRef = useRef(win.minimized);

  const minimizeTarget = dockTravel ?? inPlace;
  const openTarget = dockTravel
    ? { scale: dockTravel.scale, x: dockTravel.topLeftX, y: dockTravel.topLeftY }
    : { scale: 0.94, x: inPlace.topLeftX, y: inPlace.topLeftY };

  /**
   * `transformOrigin: 0 0` is load-bearing: the FLIP maths above assumes it.
   * Under reduced motion there is no travel at all — minimize is a pure fade in
   * place, and open is a fade at rest — because `MotionConfig
   * reducedMotion="user"` applies the target values instantly rather than
   * suppressing them, so a `scale: 0.05` target would otherwise *jump*.
   */
  const animateTarget = reducedMotion
    ? {
        opacity: win.minimized ? 0 : 1,
        x: 0,
        y: 0,
        scale: 1,
        transition: INSTANT,
      }
    : win.minimized
      ? {
          opacity: 0,
          x: minimizeTarget.x,
          y: minimizeTarget.y,
          scale: minimizeTarget.scale,
          transition: SPRING.smooth,
        }
      : {
          opacity: 1,
          x: 0,
          y: 0,
          scale: 1,
          transition: wasMinimizedRef.current ? SPRING.smooth : SPRING.snappy,
        };

  /** Close is faster than open: the user has already decided. */
  const exitTarget = reducedMotion
    ? { opacity: 0, x: 0, y: 0, scale: 1, transition: INSTANT }
    : { opacity: 0, x: 0, y: 0, scale: 0.94, transition: { duration: DURATION.fast, ease: EASE_IN_OUT } };

  const focusTransition = reducedMotion
    ? INSTANT
    : { duration: DURATION.base, ease: EASE_OUT } satisfies Transition;

  /* ---- focus management (D6) ---- */
  // Opening a window must move focus into it, otherwise the next Tab starts
  // from the top of the document. `inert` on every non-active window (below)
  // keeps Tab order inside the focused one.
  useEffect(() => {
    if (!isActive || win.minimized) return;
    const node = rootRef.current;
    if (!node) return;
    // Only steal focus when it is not already inside this window: re-focusing
    // on every state change would fight the user's in-window controls.
    if (node.contains(document.activeElement)) return;
    const id = window.setTimeout(() => node.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [isActive, win.minimized, win.id]);

  /**
   * Hold the paint for the length of the minimize flight, then let
   * `visibility: hidden` take over.
   *
   * A window hydrated as already-minimized starts settled, so it is hidden on
   * the first frame. Everything else starts un-settled so the flight is
   * visible. Restoring is immediate — `visuallyHidden` below is keyed on
   * `win.minimized` directly, so the restore lands on the same commit as the
   * store flip and the live-region announcement.
   */
  const [minimizeSettled, setMinimizeSettled] = useState(win.minimized);
  useEffect(() => {
    if (!win.minimized) {
      wasMinimizedRef.current = false;
      setMinimizeSettled(false);
      return;
    }
    wasMinimizedRef.current = true;
    if (reducedMotion) {
      setMinimizeSettled(true);
      return;
    }
    setMinimizeSettled(false);
    const id = window.setTimeout(() => setMinimizeSettled(true), MINIMIZE_FLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [win.minimized, reducedMotion]);

  const handleMaximize = () => {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    toggleMaximize(win.id, { x: 0, y: 0, w: rect.width, h: rect.height });
  };

  const clampToArea = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const area = areaRef.current;
      if (!area) return rect;
      return clampRect(rect, area.clientWidth, area.clientHeight);
    },
    [areaRef],
  );

  // Re-clamp on every workspace resize instead of once per mount. framer's
  // ref-constraints ResizeObserver rescales *position* but never *size*, so a
  // restored 1320px-wide window in a 900px area kept `w = 1320` and the right
  // 420px of the workspace was unreachable inside the `overflow-hidden` area.
  // This matters at 200% zoom and on 1024x600 clinical laptops.
  const areaSizeRef = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const w = area.clientWidth;
      const h = area.clientHeight;
      const prev = areaSizeRef.current;
      areaSizeRef.current = { w, h };
      if (mobile || win.maximized) return;
      if (prev && prev.w === w && prev.h === h) return;
      const c = clampToArea({ x: win.x, y: win.y, w: win.w, h: win.h });
      if (c.x !== win.x || c.y !== win.y || c.w !== win.w || c.h !== win.h) {
        x.set(c.x);
        y.set(c.y);
        setRect(win.id, { x: c.x, y: c.y, w: c.w, h: c.h });
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(area);
    return () => ro.disconnect();
  }, [areaRef, clampToArea, mobile, win.id, win.maximized, win.x, win.y, win.w, win.h, setRect, x, y]);

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
      // Never shrink below MIN_W/MIN_H to satisfy the right/bottom edge: pull
      // the origin back instead. The old code set `w = areaRect.width - x`,
      // which could drive `w` far below MIN_W (an unreadable 120px window) and,
      // for a maximized-then-restored window, to a negative width.
      if (x + w > areaRect.width) {
        const overflow = x + w - areaRect.width;
        if (w - overflow >= MIN_W) {
          w -= overflow;
        } else {
          x = Math.max(0, areaRect.width - MIN_W);
          w = Math.min(MIN_W, areaRect.width);
        }
      }
      if (y + h > areaRect.height) {
        const overflow = y + h - areaRect.height;
        if (h - overflow >= MIN_H) {
          h -= overflow;
        } else {
          y = Math.max(0, areaRect.height - MIN_H);
          h = Math.min(MIN_H, areaRect.height);
        }
      }
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

  /**
   * `transform-origin` for the snap target, set to the edge/corner the window
   * is being pulled against so the preview grows *out of* that edge rather than
   * out of its centre.
   */
  const snapOrigin = (zone: SnapZone): string => {
    switch (zone) {
      case "left":
      case "tl":
      case "bl":
        return "0% 50%";
      case "right":
      case "tr":
      case "br":
        return "100% 50%";
      case "top":
        return "50% 0%";
      case "bottom":
        return "50% 100%";
    }
  };

  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  /**
   * Drag bookkeeping. `dragging` is set on drag start and cleared on drag end —
   * two renders per gesture, not two per frame. The per-frame work in `onDrag`
   * is a `MotionValue.set()` (no React involvement) plus the existing
   * `setSnapZone`, which React already bails out of because the zone string is
   * unchanged for most frames.
   */
  const [dragging, setDragging] = useState(false);
  const ghostX = useMotionValue(win.x);
  const ghostY = useMotionValue(win.y);

  // `inert` keeps background windows out of the tab order and blocks pointer
  // events; `aria-hidden` removes them from the accessibility tree. Minimized
  // windows additionally get `visibility: hidden` so a screen reader's virtual
  // cursor and browser find-in-page cannot reach content the user cannot see.
  //
  // NOTE: `visibility` is held for the length of the minimize flight (see
  // `minimizeSettled`) so the window is still painted while it flies to the
  // dock. The accessibility half — `inert` + `aria-hidden` + `pointer-events:
  // none` — is applied on the very first commit after the store flips, so
  // nothing about the a11y contract changed.
  const hidden = !isActive || win.minimized;
  const interactive = !hidden;
  const visuallyHidden = win.minimized && minimizeSettled;

  const frameClass = cn(
    "relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-2xl backdrop-blur-[var(--glass-blur)]",
    win.maximized && "rounded-none",
  );

  // One measurement read per render, only while a drag is in flight or a zone
  // is latched — not on the pointermove path.
  const areaNow = areaRef.current;
  const snapPreview =
    snapZone && areaNow
      ? snapPreviewStyle(snapZone, areaNow.clientWidth, areaNow.clientHeight)
      : null;

  return (
    <motion.div
      ref={rootRef}
      tabIndex={-1}
      data-window-id={win.id}
      role="group"
      aria-roledescription="window"
      aria-labelledby={titleId}
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      drag={!win.maximized && !mobile}
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      dragConstraints={areaRef as unknown as RefObject<HTMLElement>}
      dragElastic={0}
      whileDrag={{ cursor: "grabbing" }}
      onPointerDown={() => focus(win.id)}
      onDragStart={() => {
        setDragging(true);
        ghostX.set(x.get());
        ghostY.set(y.get());
      }}
      onDrag={() => {
        const area = areaRef.current;
        ghostX.set(x.get());
        ghostY.set(y.get());
        if (!area) return;
        setSnapZone(computeSnapZone(x.get(), y.get(), win.w, win.h, area.clientWidth, area.clientHeight));
      }}
      onDragEnd={() => {
        setDragging(false);
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
      style={{
        x,
        y,
        width: win.w,
        height: win.h,
        // D1: `zIndex` was tracked in the store but never rendered, so stacking
        // was just DOM array order and the entire focus system was a no-op.
        zIndex: windowZ(win.zIndex),
        pointerEvents: win.minimized ? "none" : "auto",
        visibility: visuallyHidden ? "hidden" : "visible",
        // Keep the focus ring from drawing a huge outline when focus() lands on
        // the window root.
        outline: "none",
      }}
      className="absolute left-0 top-0"
    >
      {/*
        The animated surface. It carries `backdrop-filter`, so opacity and scale
        stay ON this element: an `opacity` ancestor would create a backdrop root
        and the window would lose its frost mid-animation.
      */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, ...openTarget }}
        animate={animateTarget}
        exit={exitTarget}
        style={{ transformOrigin: "0 0" }}
        className={frameClass}
      >
        {/*
          D18: ONE focus treatment, cross-faded instead of swapped. Two ring
          overlays that each animate opacity only — the previous frame dropped a
          `ring-2 ring-[var(--accent-brand)]` and picked up a `ring-1
          ring-border` in the same frame, so focus was a hard cut. Painting
          nothing but a ring keeps the repaint region to a 1-2px band instead of
          the whole blurred window, which is why this is opacity on a child
          rather than a `boxShadow` tween on the frosted frame.
        */}
        <motion.span
          aria-hidden
          initial={false}
          animate={{ opacity: isActive ? 0 : 1 }}
          transition={focusTransition}
          className={cn(
            "pointer-events-none absolute inset-0 ring-1 ring-border",
            win.maximized ? "rounded-none" : "rounded-2xl",
          )}
        />
        <motion.span
          aria-hidden
          initial={false}
          animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 1.014 }}
          transition={focusTransition}
          className={cn(
            "pointer-events-none absolute inset-0 ring-2 ring-[var(--accent-brand)]",
            win.maximized ? "rounded-none" : "rounded-2xl",
          )}
        />

        <div
          onDoubleClick={mobile ? undefined : handleMaximize}
          onPointerDown={(e) => {
            // Only the title bar drags. Left button only, so a right-click
            // context menu or a middle-click paste does not move the window.
            if (e.button !== 0 || mobile || win.maximized) return;
            dragControls.start(e);
          }}
          className={cn(
            "glass-titlebar flex h-9 shrink-0 items-center gap-2 px-2 select-none",
            !mobile && !win.maximized && "cursor-grab active:cursor-grabbing",
            isActive ? "bg-[var(--accent-soft)]" : "bg-background/10",
          )}
        >
          <Icon className="h-4 w-4 shrink-0 text-[var(--accent-brand)]" />
          <span id={titleId} className="flex-1 truncate text-sm font-medium">
            {title}
          </span>
          <div className="flex items-center" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              title={t("desktop.minimize")}
              aria-label={t("desktop.minimize")}
              onClick={() => {
                play("window-minimize");
                minimize(win.id);
              }}
              className="grid h-6 w-8 place-items-center rounded text-foreground/80 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] dark:hover:bg-white/10"
            >
              <MinIcon />
            </button>
            <motion.button
              type="button"
              whileTap={reducedMotion ? undefined : { scale: 0.88 }}
              transition={{ duration: DURATION.instant, ease: EASE_OUT }}
              title={win.maximized ? t("desktop.restore") : t("desktop.maximize")}
              aria-label={win.maximized ? t("desktop.restore") : t("desktop.maximize")}
              onClick={handleMaximize}
              className="grid h-6 w-8 place-items-center rounded text-foreground/80 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] dark:hover:bg-white/10"
            >
              {/* The maximize/restore glyph cross-fades: the window geometry
                  change itself is a hard snap (see the report — animating
                  width/height would fight the drag and resize handlers), so the
                  button is where the feedback has to live. */}
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={win.maximized ? "restore" : "maximize"}
                  initial={reducedMotion ? false : { opacity: 0, rotate: -35, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 35, scale: 0.7 }}
                  transition={
                    reducedMotion
                      ? INSTANT
                      : { duration: DURATION.fast, ease: EASE_OUT }
                  }
                  className="grid place-items-center"
                >
                  {win.maximized ? <RestoreIcon /> : <MaxIcon />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <button
              type="button"
              title={t("desktop.close")}
              aria-label={t("desktop.close")}
              onClick={() => {
                play("window-close");
                close(win.id);
              }}
              className="grid h-6 w-8 place-items-center rounded text-foreground/80 hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <WindowBody loader={app.loader} route={win.route} windowId={win.id} />

        {interactive && !win.maximized && !mobile &&
          RESIZE_HANDLES.map((h) => (
            <div
              key={h.dir}
              onPointerDown={startResize(h.dir)}
              className={cn("absolute z-10", h.cls)}
            >
              {h.dir === "se" && (
                <div className="absolute bottom-0.5 right-0.5">
                  <GripIcon />
                </div>
              )}
            </div>
          ))}
      </motion.div>

      {/* Edge-snap preview: a ghost that tracks the pointer 1:1 plus the
          snapped target that grows out of the edge being snapped to. Portalled
          into the workspace so it can sit under the window chrome at
          `Z.snapPreview`. */}
      {(dragging || snapZone) &&
        areaRef.current &&
        createPortal(
          <>
            <motion.div
              aria-hidden
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: dragging ? 0.5 : 0.35 }}
              transition={
                reducedMotion ? INSTANT : { duration: DURATION.fast, ease: EASE_OUT }
              }
              style={{
                x: ghostX,
                y: ghostY,
                width: win.w,
                height: win.h,
                borderRadius: 16,
                zIndex: Z.snapPreview,
              }}
              className="pointer-events-none absolute left-0 top-0 border-2 border-dashed border-[var(--accent-brand)] bg-[var(--accent-soft)]"
            />
            <AnimatePresence mode="wait" initial={false}>
              {snapZone && snapPreview && (
                <motion.div
                  key={snapZone}
                  aria-hidden
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98 }}
                  transition={reducedMotion ? INSTANT : SPRING.snappy}
                  style={{
                    ...snapPreview,
                    transformOrigin: snapOrigin(snapZone),
                    zIndex: Z.snapPreview + 1,
                  }}
                  className="pointer-events-none absolute bg-primary/20 ring-2 ring-primary/40"
                />
              )}
            </AnimatePresence>
          </>,
          areaRef.current,
        )}
    </motion.div>
  );
}

/**
 * `memo` matters: the store preserves object identity for untouched windows, so
 * without it every FOCUS / MOVE / SET_RECT would re-render every window and its
 * entire page tree.
 */
export const Window = memo(WindowImpl);