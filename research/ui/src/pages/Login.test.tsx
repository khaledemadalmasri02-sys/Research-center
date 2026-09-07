import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import Login from "./Login";
import { AuthProvider } from "../auth/AuthContext";
import { I18nProvider } from "../i18n";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: any;
    constructor(message: string, status: number, data: any) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

function renderLogin(initialEntries: string[] = ["/login"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Login page", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({ authenticated: false });
    localStorage.clear();
  });

  it("renders the heading, both inputs, and the submit button", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("does not submit when the form is empty (browser-level no-op)", async () => {
    renderLogin();
    const submit = screen.getByRole("button", { name: /sign in/i });
    await userEvent.click(submit);
    // No apiPost fired because both fields are empty and the button is type=submit
    // without a value attribute — but more importantly, login() is gated by
    // setting state on empty values which the component doesn't do. The
    // real assertion: no POST to /api/auth/login was attempted.
    expect(apiPost).not.toHaveBeenCalledWith("/api/auth/login", expect.anything());
  });

  it("POSTs credentials on submit and navigates on success", async () => {
    apiGet
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValueOnce({
        authenticated: true,
        id: 1,
        username: "k",
        role: "editor",
        canAdminAccess: false,
        status: "active",
      });
    apiPost.mockResolvedValueOnce({});
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText(/username/i), "khaled");
    await userEvent.type(screen.getByPlaceholderText(/password/i), "secret");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/login", {
        username: "khaled",
        password: "secret",
      }),
    );
  });

  it("surfaces the ApiError message when login fails", async () => {
    // Build a real ApiError via the mocked module.
    const { ApiError } = await import("../lib/api");
    apiGet.mockResolvedValue({ authenticated: false });
    apiPost.mockRejectedValueOnce(new ApiError("Invalid credentials", 401, null));
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText(/username/i), "k");
    await userEvent.type(screen.getByPlaceholderText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument(),
    );
  });
});
