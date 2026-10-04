// Runtime switch between the classic SPA shell (www.research-center.fit) and the
// Ubuntu desktop shell (research-center.fit). Single build, single Cloudflare
// Worker: the SPA chooses its top-level shell from the hostname (or a
// developer-only override), so no server-side branching or second worker is
// required.
import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

/**
 * THREAT MODEL for the `?desktop=1` / `?desktop=0` override.
 *
 * Two shells serve the *same* origin and the *same* `rc_sid` cookie domain
 * (`.research-center.fit`). That makes shell selection a UI-spoofing surface:
 * a link like `https://research-center.fit/?desktop=0` renders a visually
 * different application on a trusted domain, which is exactly the shape of a
 * phishing lure, and `?desktop=1` can force the pointer/keyboard-only window
 * manager onto a phone where it is unusable (and where drag handles and hover
 * affordances do not exist).
 *
 * It is NOT a privilege escalation: every shell mounts the same `@/pages/*`
 * modules and the same API client, and the backend enforces authz. But on a
 * PHI application, "two different-looking apps on one trusted domain" is not a
 * risk worth shipping, so the override is:
 *
 *   1. evaluated *after* the phone guard, so it can never impose the
 *      drag/resize window manager on a touch device;
 *   2. gated behind `import.meta.env.DEV` or an explicit local opt-in
 *      (`desktop-shell-debug === "1"`) so it is unreachable in production;
 *   3. stripped from the URL on mount (`stripDesktopOverride`) so it never
 *      propagates into bookmarks, shared links, or Referer headers.
 */
function isDebugOverrideEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem("desktop-shell-debug") === "1";
  } catch {
    // Private mode / blocked storage: treat as "not enabled".
    return false;
  }
}

function readDesktopOverride(search: string): "1" | "0" | null {
  if (!isDebugOverrideEnabled()) return null;
  const value = new URLSearchParams(search).get("desktop");
  return value === "1" || value === "0" ? value : null;
}

function matchMobile(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Non-reactive snapshot of which shell should render. Safe for plain callers
 * (event handlers, module-level checks). React components that need to react
 * to a viewport/orientation change must use `useIsDesktopMode()` instead —
 * `isDesktopMode()` is evaluated once per call and never subscribes, so a
 * resize across the 767px boundary would otherwise leave the wrong shell
 * mounted (and, historically, change a component's hook count mid-render).
 */
export function isDesktopMode(): boolean {
  if (typeof window === "undefined") return false;

  // Phones always get the classic shell: the window manager is built around
  // drag/resize/keyboard shortcuts and is broken on touch (no maximize, no
  // close-from-dock gesture, no launcher FAB). Tablets and up keep the host
  // switch. NOTE: this guard runs BEFORE the debug override on purpose — see
  // the threat-model comment above.
  if (matchMobile()) return false;

  const override = readDesktopOverride(window.location.search);
  if (override === "1") return true;
  if (override === "0") return false;

  // Apex host (research-center.fit) => desktop; www host => classic.
  return !window.location.host.startsWith("www.");
}

export function isClassicMode(): boolean {
  return !isDesktopMode();
}

/* -------------------------------------------------------------------------- */
/* Reactive variant                                                           */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();
let mql: MediaQueryList | null = null;

/**
 * Subscribe a component to `isDesktopMode()`. Re-renders when the
 * mobile/desktop media query flips (rotate a tablet, resize across 767px,
 * change browser zoom to 200%) so the correct shell is (re)mounted.
 *
 * Module-level (shared) subscription: one `change` listener fans out to every
 * consumer, and `getSnapshot` returns a cached boolean so
 * `useSyncExternalStore` does not loop on referential inequality.
 */
export function subscribeToDesktopMode(listener: Listener): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(listener);

  if (!mql && typeof window.matchMedia === "function") {
    mql = window.matchMedia(MOBILE_QUERY);
    mql.addEventListener("change", handleMediaChange);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && mql) {
      mql.removeEventListener("change", handleMediaChange);
      mql = null;
    }
  };
}

function handleMediaChange() {
  cachedSnapshot = null;
  listeners.forEach((l) => l());
}

let cachedSnapshot: boolean | null = null;

export function getDesktopModeSnapshot(): boolean {
  if (cachedSnapshot === null) cachedSnapshot = isDesktopMode();
  return cachedSnapshot;
}

/** Test seam: force the cached snapshot (used by unit tests). */
export function resetDesktopModeSnapshot() {
  cachedSnapshot = null;
}

/**
 * Hook form of `isDesktopMode()`. Always call it unconditionally — never
 * `isDesktopMode() ? useSomething() : null`, which changes the hook count
 * when the viewport crosses 767px and makes React throw
 * "Rendered fewer hooks than expected".
 */
export function useIsDesktopMode(): boolean {
  return useSyncExternalStore(subscribeToDesktopMode, getDesktopModeSnapshot, () => false);
}

/**
 * Remove `?desktop=…` from the address bar once, on mount, so the debug
 * override cannot leak into bookmarks, shared links, or the `Referer` header.
 * Uses `history.replaceState` (no re-render, no navigation). Idempotent.
 */
export const stripDesktopOverride = () => {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("desktop")) return;
    url.searchParams.delete("desktop");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
    // The snapshot depends on the search string; drop the cache so the next
    // read re-evaluates.
    cachedSnapshot = null;
  } catch {
    /* malformed URL / sandboxed history: nothing to strip */
  }
};

/**
 * One-shot bootstrap for the SPA root: strips the override before the first
 * shell decision is committed. Returns the resolved mode.
 */
export function initDesktopMode(): boolean {
  stripDesktopOverride();
  cachedSnapshot = null;
  return isDesktopMode();
}