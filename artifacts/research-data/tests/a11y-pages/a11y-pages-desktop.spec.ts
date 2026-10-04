import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockAuthenticatedSession, forceShell, withShell } from "./fixtures";

/**
 * Page-level accessibility scans for the desktop shell (apex host).
 * Loads each route with `?desktop=1` to force the Ubuntu-style
 * windowed shell (which `lib/desktop-mode.ts` reads from the query
 * string). The desktop shell has very different DOM (window chrome,
 * dock, wallpaper) so violations found here don't always show up in
 * the classic scan and vice-versa.
 */

const PUBLIC_ROUTES = ["/", "/login", "/signup"];

const AUTH_ROUTES = ["/patients", "/collections", "/data-analysis"];

// `AxeBuilder` needs the Page up front; `analyze()` then runs against it.
function axe(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
}

/**
 * The desktop shell has no `main-content` landmark (window chrome replaces
 * `<main>`), so this asserts the dock plus a heading instead, and hard-fails
 * when the auth boundary redirects. It used to swallow a missing dock with
 * `test.skip()`, which meant a desktop-shell regression could never fail CI.
 */
async function assertDesktopRoute(
  page: Page,
  path: string,
  { authenticated }: { authenticated: boolean },
) {
  const url = new URL(page.url());
  expect(
    ["/login", "/signup", "/"],
    `auth boundary redirected ${path} to ${url.pathname} — the a11y scan would only cover the public shell`,
  ).not.toContain(url.pathname);

  // Desktop shell renders the Wallpaper / Dock / TopBar asynchronously behind
  // a lazy Suspense. Wait for the dock rail before scanning; no skip.
  await expect(page.getByRole("navigation", { name: /apps/i }).first()).toBeVisible({
    timeout: 20_000,
  });

  if (authenticated) {
    // `main.tsx` seeds an empty desktop window on the apex host; the window
    // body is what carries the page heading once a route is open.
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  }
}

async function assertNoBlockingViolations(page: Page) {
  const results = await axe(page).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

for (const path of PUBLIC_ROUTES) {
  test(`desktop public: ${path} has no serious/critical a11y violations`, async ({ page }) => {
    await forceShell(page, "desktop");
    await page.goto(withShell(path, "desktop"));
    await page.waitForLoadState("domcontentloaded");
    await assertDesktopRoute(page, path, { authenticated: false });
    await assertNoBlockingViolations(page);
  });
}

for (const path of AUTH_ROUTES) {
  test(`desktop authed: ${path} has no serious/critical a11y violations`, async ({ page }) => {
    await forceShell(page, "desktop");
    await mockAuthenticatedSession(page);
    await page.goto(withShell(path, "desktop"));
    await page.waitForLoadState("domcontentloaded");
    await assertDesktopRoute(page, path, { authenticated: true });
    await assertNoBlockingViolations(page);
  });
}
