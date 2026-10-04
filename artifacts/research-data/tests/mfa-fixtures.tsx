import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Shared fixtures for the MFA / sessions tests.
 *
 * `tests/vitest.setup.tsx` mocks `react-i18next` with `t: (key) => key`, so
 * every assertion here matches against an i18n KEY, never against English copy.
 * That is deliberate: it means a test failing on copy means a key changed, and
 * a test passing on copy would only prove the English string is still English.
 */

export const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const URI = `otpauth://totp/Research%20Centre:dr.chen?secret=${SECRET}&issuer=Research%20Centre`;
export const RECOVERY_CODES = [
  "K7M2P-9QRTX",
  "B4ZWD-6HNVJ",
  "X3FLC-8WPAE",
  "M5QDY-2TKRH",
  "P9VBN-4JXWL",
  "C6GTH-7YUDM",
  "R1ZQP-3NKEV",
  "D8MWF-5AXCB",
  "L4HJS-9TQPM",
  "V2BNX-6WDKR",
];

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

interface Route {
  match: (url: string, init: RequestInit) => boolean;
  respond: (url: string, init: RequestInit) => Response | Promise<Response>;
}

export interface FetchStub {
  mock: ReturnType<typeof vi.fn>;
  calls: () => Array<{ url: string; method: string; body: unknown }>;
  setRoutes: (routes: Route[]) => void;
}

/**
 * A `fetch` stub driven by an ordered route table.
 *
 * Order matters: `POST /api/auth/mfa/enroll` and `POST /api/auth/mfa/enroll/confirm`
 * share a prefix, so the more specific one has to be matched first.
 */
export function installFetch(routes: Route[]): FetchStub {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let table = routes;

  const mock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? "");
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    for (const route of table) {
      if (route.match(url, init)) return route.respond(url, init);
    }
    return jsonResponse({ error: `No stub for ${method} ${url}` }, 404);
  });

  vi.stubGlobal("fetch", mock);

  return {
    mock,
    calls: () => calls,
    setRoutes: (next) => {
      table = next;
    },
  };
}

/** Routes for a signed-in account with MFA off. */
export function baselineRoutes(overrides: Route[] = []): Route[] {
  return [
    {
      match: (url) => url === "/api/auth/me",
      respond: () => jsonResponse({ authenticated: true, username: "dr.chen", role: "editor" }),
    },
    {
      match: (url) => url === "/api/sessions",
      respond: () => jsonResponse({ sessions: [] }),
    },
    ...overrides,
  ];
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

/**
 * jsdom 30 does not implement `window.matchMedia` at all.
 *
 * `@/lib/motion-preferences` degrades safely without it (that is deliberate —
 * SSR has no matchMedia either), but `useIsMobile` / `useIsTablet` in
 * `src/hooks/use-mobile.tsx`, which `Layout` calls, do not. So any test that
 * renders a page inside `Layout` must stub it. Matches `false` for everything
 * by default, which puts the page in the desktop shell — the widest layout, so
 * nothing is conditionally unmounted.
 */
export function installMatchMedia(matches: (query: string) => boolean = () => false) {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => {
    if (original) Object.defineProperty(window, "matchMedia", original);
    else Reflect.deleteProperty(window as unknown as Record<string, unknown>, "matchMedia");
  };
}

/**
 * Give jsdom a working async clipboard.
 *
 * `navigator.clipboard` is undefined in jsdom, and `document.execCommand` is not
 * implemented — so without this, every copy in the app falls into the legacy
 * path and reports failure. Tests that assert the FAILURE path must delete it
 * again (see `removeClipboard`).
 */
export function installClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

export function removeClipboard() {
  Reflect.deleteProperty(globalThis.navigator as unknown as Record<string, unknown>, "clipboard");
}