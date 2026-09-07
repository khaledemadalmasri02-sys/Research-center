import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { Layout } from "./Layout";
import { AuthProvider } from "../auth/AuthContext";
import { I18nProvider } from "../i18n";

/** Mock the api module so AuthProvider's /me call doesn't hit the network. */
const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

function renderLayout(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <AuthProvider>
          <Layout>
            <div data-testid="child">child content</div>
          </Layout>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ authenticated: false });
    localStorage.clear();
  });

  it("renders the header, sidebar, and children", async () => {
    renderLayout();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("child content");
  });

  it("shows a Login button when there is no user", async () => {
    renderLayout();
    // The auth provider starts as loading=true, then resolves to anon.
    // The Login button is in the header.
    expect(await screen.findByRole("button", { name: /login/i })).toBeInTheDocument();
  });

  it("shows the username and Logout button when authenticated", async () => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      authenticated: true,
      id: 1,
      username: "khaled",
      role: "admin",
      canAdminAccess: true,
      status: "active",
    });
    renderLayout();
    expect(await screen.findByText("khaled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("language toggle flips document.documentElement.lang and dir", async () => {
    renderLayout();
    const toggle = await screen.findByRole("button", { name: /switch language/i });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    await userEvent.click(toggle);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("renders the home nav link and admin-only links are hidden when anonymous", async () => {
    renderLayout();
    // The sidebar has a Home link visible to everyone.
    const homeLinks = await screen.findAllByRole("link", { name: /home/i });
    expect(homeLinks.length).toBeGreaterThan(0);
    // Admin-only items should not appear for anonymous users.
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gdpr/i })).not.toBeInTheDocument();
  });
});
