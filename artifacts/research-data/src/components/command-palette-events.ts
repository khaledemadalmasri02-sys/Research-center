/**
 * Tiny event bus so the sidebar (and any other chrome) can open the command
 * palette without importing the palette itself, which would pull the whole
 * cmdk tree into every chunk that renders the sidebar.
 */
export const OPEN_COMMAND_PALETTE_EVENT = "mr:command-palette:open";

export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}
