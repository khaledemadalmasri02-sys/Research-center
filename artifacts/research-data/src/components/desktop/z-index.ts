/**
 * Single source of truth for the desktop shell's stacking order.
 *
 * WHY THIS EXISTS (D15): the shell previously hardcoded `z-20` (dock), `z-30`
 * (top bar), `z-40`/`z-50` (launcher / context menu) in class strings while
 * Radix portals mounted at `z-50` / `z-[100]` on `<body>`. Modals only covered
 * the chrome *by luck* — any future chrome above `z-50` (and both shells'
 * chrome already sits in the same narrow band) breaks layering silently,
 * because stacking contexts and portal-vs-in-tree ordering are easy to get
 * wrong when the numbers are scattered through class strings.
 *
 * These values are ALSO declared as CSS custom properties in `src/index.css`
 * (`--z-wallpaper` … `--z-toast`) so third-party code and Radix portals can
 * reference the same scale by name rather than re-deriving it. This module stays
 * the authority: consumers set the value through the inline `style` prop
 * (see `z()` below), because an inline style wins over any class the theme might
 * introduce, and because a missing CSS token must never silently drop an element
 * out of the stacking order.
 *
 * If you change a value here, change it in `index.css` too.
 */
export const Z = {
  /** Wallpaper layer; behind every window. */
  wallpaper: 0,
  /** Inside a window: resize handles, snap preview. */
  window: 10,
  /** Snap preview rectangle (portal into the workspace area). */
  snapPreview: 11,
  /** Dock rail / mobile dock. */
  dock: 20,
  /** Top bar. */
  topbar: 30,
  /** Non-modal menus: desktop context menu, Radix DropdownMenu portals. */
  menu: 50,
  /** Modal layer: Radix Dialog / AlertDialog overlays and content. */
  modal: 60,
  /** The app launcher is a modal dialog, so it shares the modal layer. */
  launcher: 60,
  /** Tooltips and other transient non-modal overlays. */
  popover: 70,
  /** Toasts / notifications. */
  toast: 80,
} as const;

export type ZLayer = keyof typeof Z;

/** Style fragment, for spreading into a `style` prop. */
export function z(layer: ZLayer): { zIndex: number } {
  return { zIndex: Z[layer] };
}

/**
 * Base stacking value for a window. Window `zIndex` is tracked in the store and
 * rendered here; it is offset above `Z.window` so a window can never fall
 * behind the dock/top bar, and the 1000-step stride keeps the arithmetic
 * obvious.
 */
export const WINDOW_Z_BASE = 100;
export const WINDOW_Z_STRIDE = 10;

/** Never returns a value below `Z.window`. */
export function windowZ(winZIndex: number): number {
  if (!Number.isFinite(winZIndex)) return WINDOW_Z_BASE;
  return WINDOW_Z_BASE + Math.max(0, Math.round(winZIndex));
}

/**
 * Detects an open Radix layer (dialog, dropdown, popover, menu, tooltip).
 * Radix binds Escape on `document` in the **capture** phase and only calls
 * `preventDefault()` — which does not stop propagation — so the shell's own
 * window-level Escape handler still fires and would close the window behind
 * the dialog. Callers use this to bail out of window-close handling.
 */
export function hasOpenRadixLayer(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"],' +
        '[role="alertdialog"][data-state="open"],' +
        '[data-radix-popper-content-wrapper],' +
        '[data-radix-menu-content],' +
        '[data-radix-portal][data-state="open"]',
    ) !== null
  );
}

/** True when the event target is a text-entry surface. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable === true;
}

/** True on macOS/iOS, where Alt+Tab is an OS-level app switcher we must not steal. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}