import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthProvider, useAuth, canEdit, canAdmin } from "./AuthContext";

/** Test helper: dump the current auth state into the DOM. */
function AuthProbe({ onReady }: { onReady?: (v: ReturnType<typeof useAuth>) => void }) {
  const v = useAuth();
  React.useEffect(() => {
    onReady?.(v);
  }, [v, onReady]);
  return (
    <div>
      <span data-testid="loading">{String(v.loading)}</span>
      <span data-testid="user">{v.user ? v.user.username : "anon"}</span>
      <button onClick={() => v.login("u", "p")}>do-login</button>
      <button onClick={() => v.logout()}>do-logout</button>
      <button onClick={() => v.refresh()}>do-refresh</button>
    </div>
  );
}

/**
 * Mock the api module used by AuthContext. We swap the module-level
 * `apiGet` and `apiPost` so the test controls the network responses.
 */
const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

describe("AuthContext", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts as loading and resolves to anonymous when /me is unauthenticated", async () => {
    apiGet.mockResolvedValueOnce({ authenticated: false });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("anon");
    expect(apiGet).toHaveBeenCalledWith("/api/auth/me");
  });

  it("populates user when /me returns an authenticated session", async () => {
    apiGet.mockResolvedValueOnce({
      authenticated: true,
      id: 7,
      username: "khaled",
      role: "admin",
      canAdminAccess: true,
      status: "active",
    });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("khaled"));
  });

  it("treats a thrown /me as anonymous", async () => {
    apiGet.mockRejectedValueOnce(new Error("network"));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anon"));
  });

  it("login() POSTs credentials and refreshes /me", async () => {
    apiGet
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({ authenticated: true, id: 1, username: "k", role: "editor", canAdminAccess: false, status: "active" });
    apiPost.mockResolvedValueOnce({});
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByTestId("loading").textContent === "false");
    await userEvent.click(screen.getByText("do-login"));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/login", { username: "u", password: "p" });
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("k"));
  });

  it("logout() POSTs to /api/auth/logout and clears the user", async () => {
    apiGet
      .mockResolvedValueOnce({ authenticated: true, id: 1, username: "k", role: "editor", canAdminAccess: false, status: "active" })
      .mockResolvedValueOnce({ authenticated: false });
    apiPost.mockResolvedValueOnce({});
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("k"));
    await userEvent.click(screen.getByText("do-logout"));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/logout");
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anon"));
  });
});

describe("auth helpers", () => {
  it("canEdit returns true for admins and editors", () => {
    expect(canEdit({ id: 1, username: "a", role: "admin", canAdminAccess: false, status: "active" })).toBe(true);
    expect(canEdit({ id: 1, username: "a", role: "editor", canAdminAccess: false, status: "active" })).toBe(true);
    expect(canEdit({ id: 1, username: "a", role: "viewer", canAdminAccess: true, status: "active" })).toBe(true);
    expect(canEdit({ id: 1, username: "a", role: "viewer", canAdminAccess: false, status: "active" })).toBe(false);
    expect(canEdit(null)).toBe(false);
  });

  it("canAdmin requires canAdminAccess=true", () => {
    expect(canAdmin({ id: 1, username: "a", role: "admin", canAdminAccess: true, status: "active" })).toBe(true);
    expect(canAdmin({ id: 1, username: "a", role: "admin", canAdminAccess: false, status: "active" })).toBe(false);
    expect(canAdmin(null)).toBe(false);
  });
});
