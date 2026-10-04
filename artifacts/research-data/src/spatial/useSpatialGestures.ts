import { useEffect, type RefObject } from "react";
import { camera } from "./spatialCamera";

const WHEEL_X_SENSITIVITY = 1.4;
const TOUCH_SENSITIVITY = 1.2;

type Options = {
  scopeRef: RefObject<HTMLElement | null>;
};

export function useSpatialGestures({ scopeRef }: Options) {
  useEffect(() => {
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;
    let touchLastX: number | null = null;
    let touchLastY: number | null = null;
    let dragAxis: "x" | "y" | null = null;
    const DRAG_THRESHOLD = 6;

    const inScope = (target: EventTarget | null) => {
      const el = scopeRef.current;
      if (!el) return false;
      if (!(target instanceof Node)) return false;
      return el.contains(target);
    };

    const findScrollable = (target: EventTarget | null): HTMLElement | null => {
      let el = target instanceof Element ? (target as HTMLElement) : null;
      while (el && el !== scopeRef.current) {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
          el.scrollHeight > el.clientHeight
        ) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const onWheel = (e: WheelEvent) => {
      if (!inScope(e.target)) return;
      const dxRaw = e.deltaX;
      const dyRaw = e.deltaY;
      const dx = dxRaw + (e.shiftKey ? dyRaw : 0);
      const dy = e.shiftKey ? 0 : dyRaw;
      // Vertical wheel → let the active section's scroll container handle it,
      // unless we're explicitly scrolling X (Shift) or deltaX dominates.
      const horizontalDominant = Math.abs(dx) > Math.abs(dy) * 1.5;
      if (!horizontalDominant && Math.abs(dy) > 0) {
        const scrollable = findScrollable(e.target);
        if (scrollable) {
          // Browser handles scroll natively; do not preventDefault.
          return;
        }
        // No scrollable container under the cursor → consume Y so it doesn't
        // double up with page scroll, and use it to navigate fields via arrows.
        e.preventDefault();
        return;
      }
      // Horizontal scroll → camera X
      e.preventDefault();
      if (Math.abs(dx) > 0) camera.panX(dx * WHEEL_X_SENSITIVITY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!inScope(e.target)) return;
      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchLastX = t.clientX;
      touchLastY = t.clientY;
      dragAxis = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX === null || touchStartY === null) return;
      if (!inScope(e.target)) return;
      const t = e.touches[0];
      const dx = (touchLastX ?? t.clientX) - t.clientX;
      const dy = (touchLastY ?? t.clientY) - t.clientY;
      touchLastX = t.clientX;
      touchLastY = t.clientY;
      if (!dragAxis) {
        const totalDx = touchStartX - t.clientX;
        const totalDy = touchStartY - t.clientY;
        if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD) return;
        dragAxis = Math.abs(totalDx) > Math.abs(totalDy) ? "x" : "y";
      }
      if (dragAxis === "y") {
        // Let the section's scroll container handle it natively.
        return;
      }
      e.preventDefault();
      if (Math.abs(dx) > 0) camera.panX(dx * TOUCH_SENSITIVITY);
    };

    const onTouchEnd = () => {
      touchStartX = null;
      touchStartY = null;
      touchLastX = null;
      touchLastY = null;
      if (dragAxis === "x") camera.snap();
      dragAxis = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!inScope(e.target)) return;
      // Don't hijack clicks on cards / nav / buttons
      if (e.target instanceof Element) {
        if (e.target.closest("button, a, [role='tab'], [data-card], [data-skip-drag]")) return;
      }
      // If the pointer is over a scrollable section stack, let it handle vertical drag.
      if (findScrollable(e.target)) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let lastX = startX;
      let lastY = startY;
      let axis: "x" | "y" | null = null;
      const el = scopeRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const dx = lastX - ev.clientX;
        const dy = lastY - ev.clientY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (!axis) {
          if (Math.hypot(startX - ev.clientX, startY - ev.clientY) < DRAG_THRESHOLD) return;
          axis = Math.abs(startX - ev.clientX) > Math.abs(startY - ev.clientY) ? "x" : "y";
        }
        if (axis === "x") {
          camera.panX(dx * TOUCH_SENSITIVITY);
        }
      };
      const onUp = () => {
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (axis === "x") camera.snap();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (!inScope(e.target)) return;
      switch (e.key) {
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          camera.shiftX(1);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          camera.shiftX(-1);
          break;
        case "ArrowUp":
        case "w":
        case "W":
          e.preventDefault();
          camera.shiftY(-1);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          e.preventDefault();
          camera.shiftY(1);
          break;
        case "Home":
          e.preventDefault();
          camera.setSection(0);
          break;
        case "End":
          e.preventDefault();
          camera.setSection(Number.MAX_SAFE_INTEGER);
          break;
        case "Escape":
        case "Enter":
        case " ":
          // Handled elsewhere.
          break;
      }
    };

    const el = scopeRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [scopeRef]);
}
