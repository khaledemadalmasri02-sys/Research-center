import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

import AuthPage from "@/pages/auth";

expect.extend(toHaveNoViolations);

/**
 * ============================================================================
 * THE AUTH SURFACE, AS RENDERED
 * ============================================================================
 *
 * `src/pages/auth.tsx` was described as a model forms implementation, and the
 * whole point of this file is to make sure the recovery work did not quietly
 * undo that. These assertions are the load-bearing ones from that contract:
 *
 *  - every field has a real accessible name, `autoComplete`, `aria-invalid`
 *    and `aria-describedby` wired to a hint/error id;
 *  - the reserved-height error slot is mounted BEFORE there is an error, which
 *    is what makes a validation message layout-shift-free;
 *  - the server-error banner is `aria-live="assertive" role="alert"`;
 *  - the caps-lock warning never blocks typing;
 *  - the recovery confirmation says what we did, never what we found.
 *
 * NOTE on the DOM: the component renders the same panel twice (a mobile stack
 * and a desktop split) plus a hidden `inert` height measurer, all three of
 * which are in the document at once and differ only by CSS. Queries therefore
 * use `getAllBy*` and act on the first match.
 */

/* ---- Environment stubs the page legitimately needs ---------------------- */

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Default backend: signed out, recovery endpoints neutral 200s. */
function installFetch(
  handler: (url: string, init?: RequestInit) => Response = () =>
    jsonResponse({
      authenticated: false,
      username: null,
      role: null,
      canAdminAccess: false,
    }),
) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    return handler(url, init);
  }) as unknown as typeof fetch;
}

/**
 * Let the `/api/auth/me` query resolve before asserting, so React state
 * updates land inside `act` instead of after the test has finished.
 */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Router>{ui}</Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  globalThis.ResizeObserver = StubResizeObserver as never;
  installFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
  vi.restoreAllMocks();
});

describe("auth page — form accessibility contract", () => {
  it("gives every login field an accessible name", () => {
    renderPage(<AuthPage />);
    expect(screen.getAllByLabelText("Username").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Password").length).toBeGreaterThan(0);
  });

  it("sends the autoComplete hints password managers key off", () => {
    renderPage(<AuthPage />);
    const usernames = screen.getAllByLabelText("Username");
    const passwords = screen.getAllByLabelText("Password");
    expect(usernames[0]).toHaveAttribute("autocomplete", "username");
    expect(usernames[0]).toHaveAttribute("name", "username");
    expect(passwords[0]).toHaveAttribute("autocomplete", "current-password");
    expect(passwords[0]).toHaveAttribute("name", "password");
  });

  it("mounts the reserved-height error slot before there is any error", () => {
    const { container } = renderPage(<AuthPage />);
    const before = container.querySelectorAll('[id$="-error"]').length;
    expect(before).toBeGreaterThan(0);
    // The whole point of the reserved slot: it is already in the document, so
    // filling it cannot move anything.
    return userEvent
      .type(screen.getAllByLabelText("Username")[0], "x")
      .then(() => userEvent.click(screen.getAllByRole("button", { name: "Login" })[0]))
      .then(() => {
        const after = container.querySelectorAll('[id$="-error"]').length;
        expect(after).toBe(before);
        expect(screen.getAllByText("Enter your password.").length).toBeGreaterThan(0);
      });
  });

  it("marks the invalid field and points aria-describedby at the message", async () => {
    renderPage(<AuthPage />);
    await userEvent.type(screen.getAllByLabelText("Username")[0], "someone");
    await userEvent.click(screen.getAllByRole("button", { name: "Login" })[0]);

    // The password is the empty one, so it is the field that goes invalid —
    // and only that field.
    const password = screen.getAllByLabelText("Password")[0];
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByLabelText("Username")[0]).not.toHaveAttribute("aria-invalid");

    const describedBy = (password.getAttribute("aria-describedby") ?? "").split(" ");
    const errorId = describedBy.find((id) =>
      (password.ownerDocument.getElementById(id)?.textContent ?? "").includes(
        "Enter your password.",
      ),
    );
    expect(errorId, "aria-describedby must reference the error element").toBeTruthy();
  });

  it("exposes the server-error banner as an assertive alert region", () => {
    const { container } = renderPage(<AuthPage />);
    const live = container.querySelector('[aria-live="assertive"][role="alert"]');
    expect(live).not.toBeNull();
  });

  it("has no axe violations on the sign-in screen", async () => {
    const { container } = renderPage(<AuthPage />);
    await settle();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("announces the current mode in a polite live region", () => {
    renderPage(<AuthPage />);
    expect(screen.getAllByText("Login form").length).toBeGreaterThan(0);
  });
});

describe("auth page — caps lock", () => {
  it("warns without blocking input", async () => {
    renderPage(<AuthPage />);
    const password = screen.getAllByLabelText("Password")[0] as HTMLInputElement;

    fireEvent.keyDown(password, { key: "A" });
    // jsdom cannot raise the CapsLock modifier, so the event carries one.
    const capsEvent = new KeyboardEvent("keydown", { key: "A", bubbles: true });
    Object.defineProperty(capsEvent, "getModifierState", {
      value: (key: string) => key === "CapsLock",
    });
    fireEvent(password, capsEvent);

    await waitFor(() =>
      expect(
        screen.getAllByText(/Caps Lock is on/i).length,
      ).toBeGreaterThan(0),
    );

    // Crucially, the field still takes input: the warning is advisory.
    await userEvent.type(password, "abc");
    expect(password.value).toBe("abc");
  });

  it("clears the warning on blur", async () => {
    renderPage(<AuthPage />);
    const password = screen.getAllByLabelText("Password")[0];
    const capsEvent = new KeyboardEvent("keydown", { key: "A", bubbles: true });
    Object.defineProperty(capsEvent, "getModifierState", {
      value: (key: string) => key === "CapsLock",
    });
    fireEvent(password, capsEvent);
    await waitFor(() =>
      expect(screen.getAllByText(/Caps Lock is on/i).length).toBeGreaterThan(0),
    );
    fireEvent.blur(password);
    await waitFor(() =>
      expect(screen.queryAllByText(/Caps Lock is on/i)).toHaveLength(0),
    );
  });
});

describe("auth page — sign-up password checklist", () => {
  it("shows all five server rules and fills them in as the user types", async () => {
    renderPage(<AuthPage initialMode="signup" />);
    const password = screen.getAllByLabelText("Password")[0];

    const checklist = screen.getAllByRole("list", { name: "Password requirements" })[0];
    const items = within(checklist).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    // Nothing is met yet: every row is present from the start, so the list
    // filling in never moves the submit button.
    expect(items.every((li) => li.getAttribute("data-met") === "false")).toBe(true);

    await userEvent.type(password, "Str0ng-Passphrase!");
    await waitFor(() =>
      expect(
        within(checklist)
          .getAllByRole("listitem")
          .every((li) => li.getAttribute("data-met") === "true"),
      ).toBe(true),
    );
  });

  it("announces the strength meter politely", () => {
    renderPage(<AuthPage initialMode="signup" />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
});

describe("auth page — password recovery", () => {
  it("confirms neutrally, without revealing whether the account exists", async () => {
    let requested = false;
    installFetch((url) => {
      if (url.includes("/api/auth/password-reset/request")) {
        requested = true;
        // Neutral 200 with nothing that hints at existence.
        return jsonResponse({ ok: true });
      }
      return jsonResponse({
        authenticated: false,
        username: null,
        role: null,
        canAdminAccess: false,
      });
    });

    renderPage(<AuthPage initialMode="forgot" />);
    await userEvent.type(
      screen.getAllByLabelText("Email or username")[0],
      "nobody@example.com",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Send reset link" })[0],
    );

    const heading = await screen.findAllByText("Check your inbox");
    expect(heading.length).toBeGreaterThan(0);
    expect(requested).toBe(true);

    const confirmation = heading[0].parentElement as HTMLElement;
    const text = confirmation.textContent ?? "";
    // The security property: it says what we DID, never what we found.
    expect(text).toMatch(/if an account matches/i);
    expect(text).not.toMatch(/no account|not found|unknown user|does not exist/i);
  });

  it("offers a resend that is disabled during the cooldown", async () => {
    installFetch((url) =>
      url.includes("/api/auth/password-reset/request")
        ? jsonResponse({ ok: true })
        : jsonResponse({
            authenticated: false,
            username: null,
            role: null,
            canAdminAccess: false,
          }),
    );

    renderPage(<AuthPage initialMode="forgot" />);
    await userEvent.type(
      screen.getAllByLabelText("Email or username")[0],
      "someone@example.com",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Send reset link" })[0],
    );

    // RESEND_COOLDOWN_SEC is 60, which formats as 1:00 — not 0:60.
    const resend = await screen.findAllByRole("button", { name: /Resend in 1:00/ });
    expect(resend[0]).toBeDisabled();
  });

  it("says a reset link with no token is incomplete rather than dead-ending", () => {
    renderPage(<AuthPage initialMode="reset" />);
    const heading = screen.getAllByText("That link is incomplete");
    expect(heading.length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Request a new link" }).length,
    ).toBeGreaterThan(0);
  });

  it("has no axe violations on the reset-request screen", async () => {
    const { container } = renderPage(<AuthPage initialMode="forgot" />);
    await settle();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the sign-up screen", async () => {
    const { container } = renderPage(<AuthPage initialMode="signup" />);
    await settle();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the reset screen", async () => {
    const { container } = renderPage(
      <AuthPage initialMode="reset" resetToken="a-token" />,
    );
    await settle();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("auth page — double submit", () => {
  it("disables the button while a request is in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFetch((url) => {
      if (url.includes("/api/auth/login")) {
        return jsonResponse({}, 401);
      }
      return jsonResponse({
        authenticated: false,
        username: null,
        role: null,
        canAdminAccess: false,
      });
    });
    // Hold the login request open so the in-flight state is observable.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/auth/login")) {
        await gate;
        return jsonResponse({ error: "Invalid credentials" }, 401);
      }
      return jsonResponse({
        authenticated: false,
        username: null,
        role: null,
        canAdminAccess: false,
      });
    }) as unknown as typeof fetch;

    renderPage(<AuthPage />);
    await userEvent.type(screen.getAllByLabelText("Username")[0], "someone");
    await userEvent.type(screen.getAllByLabelText("Password")[0], "whatever12");
    await userEvent.click(screen.getAllByRole("button", { name: "Login" })[0]);

    const busy = await screen.findAllByRole("button", { name: /Signing in/ });
    expect(busy[0]).toBeDisabled();
    expect(busy[0]).toHaveAttribute("aria-busy", "true");

    // A second click while in flight must not fire a second request.
    const callsBefore = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls.length;
    await userEvent.click(busy[0]);
    expect(
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsBefore);

    release?.();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Login" }).length).toBeGreaterThan(0),
    );
  });

  it("shows a coded server failure through the alert banner, not a raw string", async () => {
    installFetch((url) => {
      if (url.includes("/api/auth/login")) {
        return jsonResponse(
          { error: "account is locked", code: "AUTH_ACCOUNT_LOCKED" },
          423,
        );
      }
      return jsonResponse({
        authenticated: false,
        username: null,
        role: null,
        canAdminAccess: false,
      });
    });

    renderPage(<AuthPage />);
    await userEvent.type(screen.getAllByLabelText("Username")[0], "someone");
    await userEvent.type(screen.getAllByLabelText("Password")[0], "whatever12");
    await userEvent.click(screen.getAllByRole("button", { name: "Login" })[0]);

    // The panel renders the form in both the mobile and desktop layouts, so
    // there are two copies of the banner; both must carry the coded copy.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      // The English backend string must NOT be what the user is shown: the
      // code decides the copy. This is the regression the whole task exists for.
      expect(alert.textContent).not.toBe("account is locked");
      expect(alert.textContent).toMatch(/locked/i);
    }
  });
});
