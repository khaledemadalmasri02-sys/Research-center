import { useLocation } from "wouter";
import { isDesktopMode } from "@/lib/desktop-mode";
import { useDesktopOptional } from "@/components/desktop/window-store";

// In desktop mode, wouter navigation alone does not open a window. This helper
// opens the matching desktop app (when available) and keeps the wouter URL in
// sync so route-based pages that read `useParams()` still resolve correctly.
//
// IMPORTANT (hook-order): `isDesktopMode()` flips when the viewport crosses
// 767px, so the desktop hook must be called *unconditionally* and the mode
// check applied to its result. `isDesktopMode() ? useDesktopOptional() : null`
// changes the hook count on resize and makes React throw
// "Rendered fewer hooks than expected", which the root ErrorBoundary turns
// into a blank application.
export function useDesktopNav() {
  const [, navigate] = useLocation();
  const ctx = useDesktopOptional();
  const desktop = ctx && isDesktopMode() ? ctx : null;

  // In desktop mode the window itself is the navigation target: pages read the
  // window's `route` prop, and `Desktop` mirrors the *active* window into the
  // address bar. Calling `navigate(route)` here would race that and leave the
  // URL pointing at the last-opened record while several windows are open, so
  // only the classic shell (where `navigate` is the only navigation) uses it.
  function open(appId: string, route: string) {
    if (desktop) desktop.open(appId, { route });
    else navigate(route);
  }

  return {
    isDesktop: !!desktop,
    open,
    navigate,
  };
}