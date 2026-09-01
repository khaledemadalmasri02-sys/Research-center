// Runtime switch between the classic SPA shell (www.research-center.fit) and the
// Ubuntu desktop shell (research-center.fit). Single build, single Cloudflare
// Worker: the SPA chooses its top-level shell from the hostname (or an override
// query param), so no server-side branching or second worker is required.
export function isDesktopMode(): boolean {
  if (typeof window === "undefined") return false;

  const override = new URLSearchParams(window.location.search).get("desktop");
  if (override === "1") return true;
  if (override === "0") return false;

  // Apex host (research-center.fit) => desktop; www host => classic.
  return !window.location.host.startsWith("www.");
}

export function isClassicMode(): boolean {
  return !isDesktopMode();
}
