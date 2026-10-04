import { useEffect, type RefObject } from "react";
import { camera } from "./cameraStore";

// Click-and-drag to pan the camera. Only fires on a primary-button drag
// that crosses a small threshold so single clicks on cards still work.
export function useDragPan({ scopeRef, disabled }: { scopeRef: RefObject<HTMLElement | null>; disabled?: boolean }) {
  useEffect(() => {
    if (disabled) return;
    const el = scopeRef.current;
    if (!el) return;

    let startX = 0;
    let startCamX = 0;
    let active = false;
    let moved = false;
    const THRESHOLD = 6;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element) {
        const card = e.target.closest("[data-card], button, a, input, textarea, select");
        if (card) return;
      }
      startX = e.clientX;
      startCamX = camera.getTargetX();
      active = true;
      moved = false;
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!active) return;
      const dx = startX - e.clientX;
      if (!moved && Math.abs(dx) < THRESHOLD) return;
      moved = true;
      camera.setTargetX(startCamX + dx);
    };

    const onUp = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved) camera.snapToCurrent();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [scopeRef, disabled]);
}
