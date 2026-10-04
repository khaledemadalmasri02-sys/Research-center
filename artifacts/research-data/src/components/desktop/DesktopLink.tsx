import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useDesktopActionsOptional } from "./window-store";
import { getApp } from "./app-registry";

/**
 * `href` -> desktop `appId` mapping, ordered most-specific first.
 *
 * The desktop shell mounts no wouter `<Route>`s, so `useParams()` returns `{}`
 * inside a window and every route-driven page must be opened *with* an explicit
 * `route`. Before this existed, `navigate("/patients/133")` from any `<Link>`
 * changed the address bar and nothing else: deep links opened the Home window,
 * the dashboard's View/Edit CTAs and the whole Collections -> Records -> New
 * Record workflow were dead, and browser back/forward did nothing.
 */
const MATCHERS: { appId: string; re: RegExp }[] = [
  { appId: "patients/new", re: /^\/patients\/new\/?$/ },
  { appId: "patient-edit", re: /^\/patients\/([^/]+)\/edit\/?$/ },
  { appId: "patient-view", re: /^\/patients\/([^/]+)\/?$/ },
  { appId: "patients", re: /^\/patients\/?$/ },
  { appId: "collections/new", re: /^\/collections\/new\/?$/ },
  { appId: "collections/:id/edit", re: /^\/collections\/([^/]+)\/edit\/?$/ },
  { appId: "collections", re: /^\/collections\/?$/ },
  // `/records/12/new` must beat `/records/12/:recordId`.
  { appId: "records/:definitionId/new", re: /^\/records\/([^/]+)\/new\/?$/ },
  { appId: "record-detail", re: /^\/records\/([^/]+)\/([^/]+)\/?$/ },
  { appId: "records/:definitionId", re: /^\/records\/([^/]+)\/?$/ },
  { appId: "home", re: /^\/?$/ },
  { appId: "data-analysis", re: /^\/data-analysis\/?$/ },
  { appId: "feedback", re: /^\/feedback\/?$/ },
  { appId: "more-features", re: /^\/more-features\/?$/ },
  { appId: "activity/me", re: /^\/activity\/me\/?$/ },
  { appId: "activity", re: /^\/activity\/?$/ },
  { appId: "api-tokens", re: /^\/api-tokens\/?$/ },
  { appId: "sessions", re: /^\/sessions\/?$/ },
  { appId: "database", re: /^\/database\/?$/ },
  { appId: "admin", re: /^\/admin\/?$/ },
  { appId: "settings", re: /^\/settings\/?$/ },
  { appId: "theme-manager", re: /^\/theme-manager\/?$/ },
];

/** Strip query string / hash; the window route never needs them. */
export function normalizeHref(href: string): string {
  const raw = href.split("?")[0].split("#")[0];
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

/** Resolve a classic-app href to the desktop app that should display it. */
export function appIdForHref(href: string): string | null {
  const path = normalizeHref(href);
  for (const { appId, re } of MATCHERS) {
    if (re.test(path)) return getApp(appId) ? appId : null;
  }
  return null;
}

export interface DesktopLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Classic-app href, e.g. `/records/12/55` or `/collections/9/edit`. */
  href: string;
  children?: React.ReactNode;
  /**
   * Force a specific app id instead of deriving it from `href` (use when the
   * same route is served by two apps, e.g. `/records/:d` -> records list).
   */
  appId?: string;
  /** Skip opening a window and fall back to plain URL navigation. */
  navigateOnly?: boolean;
  className?: string;
}

/**
 * Anchor that opens the matching desktop window instead of navigating.
 *
 * Renders a real `<a href>` so "open in new tab", middle-click and
 * ctrl/cmd-click still work for users who want the classic route. A plain
 * left-click is intercepted: the matching app is opened with `href` as its
 * `route`, and `Desktop` mirrors the focused window into the address bar, so
 * the URL still reflects where the user is.
 *
 * Props: `href` (required classic route), `appId` (optional override),
 * `navigateOnly` (opt out of window-opening), plus every native
 * `<a>` attribute (`className`, `onClick`, `aria-*`, `target`, ...).
 */
export const DesktopLink = forwardRef<HTMLAnchorElement, DesktopLinkProps>(function DesktopLink(
  { href, children, appId, navigateOnly = false, onClick, ...rest },
  ref,
) {
  // `null` in the classic shell (no WindowStoreProvider) — the anchor then
  // behaves like a plain wouter/`<a>` navigation.
  const desktop = useDesktopActionsOptional();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // Let the browser handle modified clicks and non-primary buttons.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    if (navigateOnly || !desktop) return;

    const resolved = appId ?? appIdForHref(href);
    if (!resolved) return;
    e.preventDefault();
    desktop.open(resolved, { route: normalizeHref(href) });
  };

  return (
    <a ref={ref} href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
});