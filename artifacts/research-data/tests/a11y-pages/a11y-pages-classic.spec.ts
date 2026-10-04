import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockAuthenticatedSession, forceShell, withShell } from "./fixtures";

/**
 * Page-level accessibility scans for the classic shell (www.host).
 * Every public route and a sample of authenticated routes is loaded
 * with axe. Only `serious` and `critical` violations fail the job;
 * `moderate` and `minor` are logged but don't block, to avoid
 * drowning the team in nits while still surfacing real regressions.
 *
 * Tags: @classic. The desktop shell has a sibling file
 * `a11y-pages-desktop.spec.ts` with the same surface.
 */

const PUBLIC_ROUTES = ["/", "/login", "/signup"];

// Authenticated routes need a session. `useAuth()` resolves the session from
// the `__Host-` cookie via `GET /api/auth/me`, so the only way to get one in
// CI is to mock that endpoint (see ./fixtures.ts). The previous attempt wrote
// `localStorage["session-token"]`, which nothing in the bundle reads, and then
// `test.skip()`ed whenever the app redirected — so a broken auth boundary
// could never fail this suite. `assertAuthenticatedPage` below is the gate
// that makes that impossible.
const AUTH_ROUTES = [
  "/patients",
  "/patients/new",
  "/collections",
  "/data-analysis",
  "/data-table-demo",
  "/feedback",
  "/more-features",
  "/activity/me",
  "/api-tokens",
  "/sessions",
];

// `AxeBuilder` needs the Page up front; `analyze()` then runs against it.
function axe(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
}

/**
 * Fails (rather than skips) when the app did not render the requested
 * authenticated route. Without this, an auth-boundary regression silently
 * re-scans the marketing page and the suite stays green.
 */
async function assertAuthenticatedPage(page: Page, path: string) {
  const url = new URL(page.url());
  expect(
    ["/login", "/signup", "/"],
    `auth boundary redirected ${path} to ${url.pathname} — the a11y scan would only cover the public shell`,
  ).not.toContain(url.pathname);

  // Layout (the authenticated classic chrome) owns the `main-content`
  // landmark that SkipToContent targets; Login/Signup/Welcome never render it.
  await expect(page.locator("#main-content")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("h1")).toBeVisible({ timeout: 15_000 });
}

async function assertNoBlockingViolations(page: Page) {
  const results = await axe(page).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

for (const path of PUBLIC_ROUTES) {
  test(`classic public: ${path} has no serious/critical a11y violations`, async ({ page }) => {
    await forceShell(page, "classic");
    await page.goto(withShell(path, "classic"));
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toBeVisible();
    await assertNoBlockingViolations(page);
  });
}

for (const path of AUTH_ROUTES) {
  test(`classic authed: ${path} has no serious/critical a11y violations`, async ({ page }) => {
    await forceShell(page, "classic");
    await mockAuthenticatedSession(page);
    await page.goto(withShell(path, "classic"));
    await page.waitForLoadState("domcontentloaded");
    await assertAuthenticatedPage(page, path);
    await assertNoBlockingViolations(page);
  });
}
