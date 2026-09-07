import { test, expect } from "@playwright/test";

/**
 * Smoke tests for the research-ui Worker portal. These run against a
 * freshly-built dev server (see playwright.config.ts) and only verify
 * the critical paths:
 *
 *   1. The login page renders.
 *   2. Submitting the login form with no backend (or an unreachable
 *      backend) shows an error rather than hanging the UI.
 *   3. The 404 page renders for unknown routes.
 *   4. The language toggle flips <html lang> and <html dir>.
 *
 * Anything that needs a real authenticated session is left as `test.skip`
 * with a comment pointing at the test user setup.
 */

test.describe("Smoke", () => {
  test("loads login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText(/sign in/i);
  });

  test("login form is visible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[placeholder*="username" i]')).toBeVisible();
    await expect(page.locator('input[placeholder*="password" i]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign in")')).toBeVisible();
  });

  test("language toggle switches <html lang> between en and ar", async ({ page }) => {
    await page.goto("/login");
    const toggle = page.getByRole("button", { name: /switch language/i });
    await expect(toggle).toBeVisible();
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
    await toggle.click();
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
  });

  test("404 page renders for an unknown route", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    // The dev server still returns 200; the SPA shows the 404 component.
    expect(response, "response should be defined").toBeTruthy();
    await expect(page.locator("h1")).toContainText("404");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /home/i })).toBeVisible();
  });

  test("submitting login with bad creds shows an error inline", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[placeholder*="username" i]').fill("nobody");
    await page.locator('input[placeholder*="password" i]').fill("wrongpassword");
    await page.locator('button:has-text("Sign in")').click();
    // Either the API returned an error, or the network failed; either
    // way the UI should not hang and should show some error text. The
    // exact message depends on the backend, so we assert on a generic
    // error region instead.
    await expect(page.locator(".text-red-600, [role=alert]").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("navigates to home after login (with mocked auth)", async ({ page }) => {
    // This test would require a test user - skip for now
    test.skip();
  });
});
