import { useEffect, type RefObject } from "react";
import { camera } from "./cameraStore";

const WHEEL_SENSITIVITY = 1.6; // px per pixel of delta
const TOUCH_SENSITIVITY = 1.1;
const KEY_STEP = 160;

type Options = {
  scopeRef: RefObject<HTMLElement | null>;
};

export function useSideScrollInput({ scopeRef }: Options) {
  useEffect(() => {
    let touchStartX: number | null = null;
    let touchLastX: number | null = null;

    const isInScope = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      const el = scopeRef.current;
      if (!el) return false;
      return el.contains(target);
    };

    const onWheel = (e: WheelEvent) => {
      if (!isInScope(e.target)) return;
      e.preventDefault();
      const dominant =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      camera.setTargetX(camera.getTargetX() + dominant * WHEEL_SENSITIVITY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!isInScope(e.target)) return;
      touchStartX = e.touches[0].clientX;
      touchLastX = touchStartX;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStartX === null) return;
      if (!isInScope(e.target)) return;
      const x = e.touches[0].clientX;
      const dx = (touchLastX ?? x) - x;
      touchLastX = x;
      e.preventDefault();
      camera.setTargetX(camera.getTargetX() + dx * TOUCH_SENSITIVITY);
    };

    const onTouchEnd = () => {
      touchStartX = null;
      touchLastX = null;
      camera.snapToCurrent();
    };

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
      if (!isInScope(e.target) && scopeRef.current) return;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        camera.shiftIndex(1);
      } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        camera.shiftIndex(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        camera.jumpToIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        camera.jumpToIndex(camera.getStopPositions().length - 1);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        camera.setTargetX(camera.getTargetX() + KEY_STEP * 4);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        camera.setTargetX(camera.getTargetX() - KEY_STEP * 4);
      } else if (e.key === "Enter" || e.key === " ") {
        const el = scopeRef.current?.querySelector<HTMLElement>(
          "[data-active-stop] button[data-open]",
        );
        if (el) {
          e.preventDefault();
          el.click();
        }
      }
    };

    const el = scopeRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKey);
    };
  }, [scopeRef]);
}
