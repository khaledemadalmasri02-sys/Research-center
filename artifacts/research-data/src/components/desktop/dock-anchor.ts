/**
 * Dock button geometry registry.
 *
 * `Window` needs to know where a dock icon is *in the workspace area's
 * coordinate space* so minimize can travel there and open can emerge from
 * there. Reading it with a `querySelector` + `getBoundingClientRect()` from
 * inside `Window` would mean a forced layout on a state-transition render,
 * per window, and — worse — a `SET_RECT` during a drag would re-run it, since
 * a minimize/restore can follow a drag at any time.
 *
 * So the dock publishes instead. `Dock` owns the only measurement; `Window`
 * only reads a plain object. Publishing is a `Map.set` of four numbers: no
 * React state, no re-render, no effect on the drag path.
 *
 * WHY NOT `layoutId`: framer's shared-layout projection needs one of the two
 * participants to *mount or unmount*, and here both are mounted for the whole
 * life of the window — a minimized window must stay in the DOM (it carries
 * `inert` + `aria-hidden` and `visibility: hidden`, which framer measures as a
 * zero-size box, so a projection measured from it would animate from nothing).
 * A `layoutId` shared with the dock button would also be ambiguous for the
 * non-singleton apps, where two windows of the same app would claim it. An
 * explicit transform is exact, cheap and testable. See `Window.tsx`.
 */

export interface DockAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const anchors = new Map<string, DockAnchorRect>();

/** Sub-pixel movement is not worth a Map write. */
const EPSILON = 0.5;

function sameRect(a: DockAnchorRect, b: DockAnchorRect): boolean {
  return (
    Math.abs(a.left - b.left) < EPSILON &&
    Math.abs(a.top - b.top) < EPSILON &&
    Math.abs(a.width - b.width) < EPSILON &&
    Math.abs(a.height - b.height) < EPSILON
  );
}

/** Viewport rect of the dock button for `appId`, or `null` when not mounted. */
export function getDockAnchor(appId: string): DockAnchorRect | null {
  return anchors.get(appId) ?? null;
}

/** Publish (or retract, with `null`) one dock button's viewport rect. */
export function setDockAnchor(appId: string, rect: DockAnchorRect | null): void {
  if (rect === null) {
    if (anchors.delete(appId)) bumpVersion();
    return;
  }
  const prev = anchors.get(appId);
  if (prev && sameRect(prev, rect)) return;
  anchors.set(appId, rect);
  bumpVersion();
}

export function clearDockAnchors(): void {
  if (anchors.size === 0) return;
  anchors.clear();
  bumpVersion();
}

/**
 * Monotonic counter bumped on every publish. It exists so a component can
 * depend on "the geometry changed" without subscribing to anything React —
 * `Window` reads the map inside a `useMemo` keyed on this counter through
 * `useDockAnchorVersion()`, which is a primitive and therefore cheap to
 * compare. Nothing in the drag path depends on it.
 */
let version = 0;
function bumpVersion(): void {
  version += 1;
}

export function getDockAnchorVersion(): number {
  return version;
}

/**
 * Re-measure every `[data-dock-app-id]` button currently in the document and
 * publish the results. Called by `Dock` (never by `Window`).
 *
 * `document`-scoped rather than scoped to the dock element on purpose: the
 * mobile dock and the expanded rail are two different subtrees and both must be
 * published, and an app can appear in the "running but not pinned" tail.
 */
export function measureAllDockAnchors(): void {
  if (typeof document === "undefined") return;
  const nodes = document.querySelectorAll<HTMLElement>("[data-dock-app-id]");
  const seen = new Set<string>();
  for (const node of nodes) {
    const appId = node.dataset.dockAppId;
    if (!appId) continue;
    const r = node.getBoundingClientRect();
    // A `display: none` button reports a zero rect; publishing that would make
    // a window fly to (0,0) on minimize.
    if (r.width <= 0 || r.height <= 0) continue;
    seen.add(appId);
    setDockAnchor(appId, { left: r.left, top: r.top, width: r.width, height: r.height });
  }
  for (const appId of Array.from(anchors.keys())) {
    if (!seen.has(appId)) anchors.delete(appId);
  }
  bumpVersion();
}

/**
 * Keep the registry fresh for the whole shell: dock expand/collapse, app
 * add/remove, workspace resize, list scroll and browser zoom all move a dock
 * button. `measureAllDockAnchors` is rAF-throttled so a scroll or resize
 * gesture costs one measurement per frame rather than one per event. The
 * `ResizeObserver` on `<html>` is what catches browser zoom and devtools
 * device-mode changes, which fire neither `resize` nor `scroll`.
 */
export function installDockAnchorTracking(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      measureAllDockAnchors();
    });
  };
  const onScroll = () => schedule();
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", onScroll, true);
  const ro =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
  ro?.observe(document.documentElement);
  return () => {
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", onScroll, true);
    ro?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}