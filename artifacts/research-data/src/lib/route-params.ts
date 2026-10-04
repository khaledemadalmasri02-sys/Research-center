// In the Ubuntu desktop shell, pages render inside windows without a wouter
// <Route>, so `useParams()` returns `{}`. These helpers parse the window
// `route` prop (e.g. "/patients/133", "/patients/133/edit", "/records/5/133")
// so desktop-rendered record pages can still resolve their route params.

export function routeSegments(route?: string): string[] {
  if (!route) return [];
  return route.replace(/^\/+/, "").split("/").filter(Boolean);
}

// "/patients/133" | "/patients/133/edit" -> "133"
export function extractIdFromRoute(route?: string): string | undefined {
  const segs = routeSegments(route);
  if (segs[0] === "patients" && segs[1]) return segs[1];
  return undefined;
}
