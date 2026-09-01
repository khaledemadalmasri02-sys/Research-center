import { useLocation } from "wouter";
import { isDesktopMode } from "@/lib/desktop-mode";
import { useDesktopOptional } from "@/components/desktop/window-store";

// In desktop mode, wouter navigation alone does not open a window. This helper
// opens the matching desktop app (when available) and keeps the wouter URL in
// sync so route-based pages that read `useParams()` still resolve correctly.
export function useDesktopNav() {
  const [, navigate] = useLocation();
  const desktop = isDesktopMode() ? useDesktopOptional() : null;

  function open(appId: string, route: string) {
    if (desktop) desktop.open(appId);
    navigate(route);
  }

  return {
    isDesktop: !!desktop,
    open,
    navigate,
  };
}
