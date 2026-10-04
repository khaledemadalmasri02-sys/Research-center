import type { ReactNode } from "react";
import { LayoutGrid, Palette, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { Z } from "./z-index";
import { useDesktopMotion } from "./desktop-motion";

interface Props {
  /** The surface the menu attaches to (the wallpaper, in practice). */
  children: ReactNode;
  onOpenLauncher: () => void;
  onOpenThemes: () => void;
  onReset: () => void;
}

/**
 * Desktop background context menu.
 *
 * Previously a hand-rolled `position: fixed` `<div>` at raw pointer
 * coordinates with no viewport clamping (right-clicking near an edge put the
 * menu off-screen), no `role="menu"`/`menuitem`, no focus handling and no
 * keyboard path at all. Radix's `ContextMenu` supplies collision detection /
 * flipping against the viewport, menu semantics, roving arrow-key focus, and
 * the `contextmenu` event that the Menu key and Shift+F10 dispatch — so the
 * menu is reachable without a mouse.
 */
export function DesktopContextMenu({
  children,
  onOpenLauncher,
  onOpenThemes,
  onReset,
}: Props) {
  const { t } = useTranslation();
  const { reducedMotion } = useDesktopMotion();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/*
        The shared `ContextMenuContent` ships a 200 ms `animate-in` / `zoom-in-95`
        / `fade-in-0`. A context menu is a *right-click* target, so 200 ms of
        entrance reads as lag before the menu even appears. `data-[state=open]:`
        and `data-[state=closed]:` variants outrank the unconditional
        `duration-200` (specificity 0-2-0 vs 0-1-0), so open drops to 110 ms and
        close to 70 ms. Under reduced motion `index.css` already collapses every
        `transition-duration`/`animation-duration` to 0.001 ms, and the
        `duration-*` utilities are dropped entirely for the same reason.
      */}
      <ContextMenuContent
        className={cn(
          "min-w-[200px] border-border bg-popover text-popover-foreground shadow-2xl backdrop-blur",
          reducedMotion
            ? "data-[state=open]:animate-none data-[state=closed]:animate-none"
            : "data-[state=open]:duration-[110ms] data-[state=closed]:duration-[70ms] data-[state=open]:ease-out",
        )}
        style={{ zIndex: Z.menu }}
      >
        <ContextMenuItem onSelect={onOpenLauncher} className="gap-2 focus:bg-accent">
          <LayoutGrid className="h-4 w-4" aria-hidden />
          {t("desktop.showApps")}
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem onSelect={onOpenThemes} className="gap-2 focus:bg-accent">
          <Palette className="h-4 w-4" aria-hidden />
          {t("desktop.themes")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onReset} className="gap-2 focus:bg-accent">
          <RotateCcw className="h-4 w-4" aria-hidden />
          {t("desktop.resetDesktop")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}