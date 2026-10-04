/**
 * Shared fixtures for the Playwright page-level a11y specs.
 *
 * The SPA resolves authentication from a `__Host-` httpOnly cookie that the
 * backend reads on `/api/auth/me` (`src/hooks/use-auth.ts`). Nothing in the
 * bundle reads a `session-token` localStorage key, so seeding one used to be
 * a no-op: `fetchMe()` threw, `ProtectedRoutes` fell through to its
 * catch-all `Welcome` route, and every "authenticated" a11y test silently
 * re-scanned the marketing page.
 *
 * The fix is to mock the network boundary itself with `page.route()` and
 * return the JSON shapes the app expects, so `authenticated` is genuinely
 * true and the target route really renders.
 */
import type { Page, Route } from "@playwright/test";

/** Mirrors the `AuthMe` interface in `src/hooks/use-auth.ts`. */
export const AUTH_ME = {
  authenticated: true,
  username: "ci-a11y-user",
  role: "admin",
  canAdminAccess: true,
} as const;

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const iso = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();

/**
 * Fixtures keyed by pathname. Only the endpoints the scanned routes actually
 * request are listed; `mockAuthenticatedSession` falls back to `{}` so an
 * unmocked endpoint surfaces as a visible render error rather than silently
 * hanging on a pending fetch.
 */
const FIXTURES: Record<string, unknown> = {
  "/api/auth/me": AUTH_ME,

  // src/pages/sessions.tsx -> { sessions: SessionRow[] }
  "/api/sessions": {
    sessions: [
      { sid: "ci-current", username: "ci-a11y-user", current: true, expiresAt: iso(60) },
      { sid: "ci-other", username: "ci-a11y-user", current: false, expiresAt: iso(1440) },
    ],
  },

  // src/pages/api-tokens.tsx
  "/api/tokens": {
    tokens: [
      {
        id: "ci-token-1",
        name: "ci-fixture-token",
        prefix: "mn_ci",
        createdAt: iso(-1440),
        lastUsedAt: iso(-60),
        expiresAt: null,
      },
    ],
  },

  // src/pages/activity-me.tsx
  "/api/audit/me": {
    events: [
      {
        id: 1,
        at: iso(-10),
        action: "record.view",
        actor: "ci-a11y-user",
        target: "patient/1",
        ip: "127.0.0.1",
      },
    ],
  },

  // src/pages/data-analysis/api.ts -> analysis/datasets
  "/api/analysis/datasets": {
    datasets: [
      { id: "ds-1", name: "CI fixture dataset", rows: 0, columns: 0, createdAt: iso(-1440) },
    ],
  },

  // src/hooks/use-notifications.ts
  "/api/notifications": {
    notifications: [
      {
        id: "n-1",
        title: "CI fixture",
        body: "Seeded by the a11y harness.",
        read: false,
        at: iso(-5),
      },
    ],
  },
};

function fixtureFor(pathname: string): unknown {
  if (pathname in FIXTURES) return FIXTURES[pathname];
  // `/api/tokens/<id>` style sub-resources have no GET representation here.
  return {};
}

async function fulfill(route: Route, pathname: string) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(fixtureFor(pathname)),
  });
}

/**
 * Intercepts every `/api/**` request the SPA makes and answers it from
 * {@link FIXTURES}, so `useAuth().authenticated` resolves to `true` without a
 * backend. Safe to call before any `page.goto`.
 */
export async function mockAuthenticatedSession(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
      return;
    }
    await fulfill(route, url.pathname.replace(/\/$/, "") || url.pathname);
  });
}

/**
 * Pins the top-level shell for a spec run.
 *
 * `isDesktopMode()` picks the apex desktop shell for any host that does not
 * start with `www.`, so both specs would otherwise scan the *same* shell from
 * a `127.0.0.1` static server. The `?desktop=` query override is deliberately
 * dead in production builds (`import.meta.env.DEV` is false), so the only way
 * to select a shell deterministically is the documented local opt-in:
 * `localStorage["desktop-shell-debug"] === "1"` plus `?desktop=0|1`.
 */
export async function forceShell(page: Page, shell: "classic" | "desktop") {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("desktop-shell-debug", "1");
    } catch {
      /* storage blocked — the host fallback still applies */
    }
  });
}

/** `path` with the shell override query applied (`/` -> `/?desktop=1`). */
export function withShell(path: string, shell: "classic" | "desktop"): string {
  const flag = shell === "desktop" ? "1" : "0";
  return path === "/" ? `/?desktop=${flag}` : `${path}?desktop=${flag}`;
}
