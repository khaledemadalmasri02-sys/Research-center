/**
 * Sessions page: the current-session handling, revocation, and the
 * "sign out everywhere" path.
 *
 * The invariants under test are security invariants, not cosmetic ones:
 *   - the raw session id is never rendered, and revocation uses `ref`;
 *   - the current session cannot be revoked from here, and that is EXPLAINED
 *     with a working alternative rather than being a hidden button;
 *   - a row the server did not mark as current/current-unknown is never offered
 *     for revocation, because we cannot prove it is not us;
 *   - "sign out everywhere" says exactly what it will do before it does it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SessionsPage from "@/pages/sessions";
import {
  baselineRoutes,
  installFetch,
  installMatchMedia,
  jsonResponse,
  renderWithProviders,
} from "./mfa-fixtures";

let restoreMatchMedia: (() => void) | null = null;

beforeEach(() => {
  restoreMatchMedia = installMatchMedia();
});

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  vi.unstubAllGlobals();
});

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const CURRENT = {
  ref: "ref_current_1",
  current: true,
  ip: "203.0.113.7",
  userAgent: CHROME_WINDOWS,
  createdAt: hoursAgo(6),
  lastActivityAt: hoursAgo(0.02),
  expiresAt: hoursAgo(-72),
};
const LAPTOP = {
  ref: "ref_laptop_2",
  current: false,
  ip: "198.51.100.22",
  userAgent: SAFARI_MAC,
  createdAt: hoursAgo(24 * 12),
  lastActivityAt: hoursAgo(2),
  expiresAt: hoursAgo(-24),
};
const SERVER = {
  ref: "ref_ci_3",
  current: false,
  ip: "192.0.2.44",
  userAgent: "curl/8.5.0",
  createdAt: hoursAgo(24 * 60),
  lastActivityAt: hoursAgo(24 * 40),
  expiresAt: hoursAgo(-1),
};

function stubSessions(sessions: unknown[], extra: Parameters<typeof installFetch>[0] = []) {
  /*
   * PREPENDED, not appended. `installFetch` matches in order and
   * `baselineRoutes` already carries a `/api/sessions` stub returning an empty
   * list, so appending here would silently shadow this one with zero rows.
   */
  return installFetch([
    {
      match: (url) => url === "/api/sessions",
      respond: () => jsonResponse({ sessions }),
    },
    ...extra,
    ...baselineRoutes(),
  ]);
}

describe("sessions page — rendering", () => {
  it("labels each device coarsely and marks the current one", async () => {
    stubSessions([CURRENT, LAPTOP, SERVER]);
    renderWithProviders(<SessionsPage />);

    const rows = await screen.findAllByTestId("session-row");
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText("Chrome on Windows")).toBeInTheDocument();
    expect(within(rows[0]).getByTestId("session-current-badge")).toHaveTextContent(
      "sessions.current",
    );
    expect(within(rows[1]).getByText("Safari on macOS")).toBeInTheDocument();
    // A non-browser client is named as such, not dressed up as a device.
    expect(within(rows[2]).getByText("sessions.device.bot")).toBeInTheDocument();

    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.22")).toBeInTheDocument();
  });

  it("never renders a raw session id or a raw user agent", async () => {
    // A legacy server that still sends `sid`, plus a distinctive UA marker.
    stubSessions([
      { ...CURRENT, sid: "SUPER-SECRET-SESSION-ID", ref: "ref_current_1" },
      LAPTOP,
    ]);
    const { container } = renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    const html = container.innerHTML;
    expect(html).not.toContain("SUPER-SECRET-SESSION-ID");
    expect(html).not.toContain("Mozilla/5.0");
    expect(html).not.toContain("AppleWebKit");
    // The opaque ref IS safe to have in the DOM as a React key, but it must not
    // be rendered as text either.
    expect(screen.queryByText("ref_current_1")).toBeNull();
  });

  it("drops rows the server gave no usable ref for", async () => {
    // Without a ref there is no way to revoke the session, so offering a button
    // that cannot work is worse than not rendering the row.
    stubSessions([{ sid: "legacy-only", current: true }, LAPTOP]);
    renderWithProviders(<SessionsPage />);

    const rows = await screen.findAllByTestId("session-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Safari on macOS")).toBeInTheDocument();
  });

  it("groups by recency and labels each group", async () => {
    stubSessions([LAPTOP, CURRENT, SERVER]);
    renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    expect(screen.getByText("sessions.group.current")).toBeInTheDocument();
    expect(screen.getByText("sessions.group.today")).toBeInTheDocument();
    expect(screen.getByText("sessions.group.older")).toBeInTheDocument();
  });

  it("shows the device label as the subject of the revoke confirmation", async () => {
    stubSessions([CURRENT, LAPTOP]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    await user.click(screen.getAllByTestId("session-revoke")[0]);

    // The dialog names the device, so "which one?" is never ambiguous.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Safari on macOS")).toBeInTheDocument();
  });
});

describe("sessions page — the current session", () => {
  it("makes revoking the current session impossible AND explains why", async () => {
    const stub = stubSessions([CURRENT, LAPTOP]);
    renderWithProviders(<SessionsPage />);

    const rows = await screen.findAllByTestId("session-row");
    const currentRow = rows[0];

    expect(within(currentRow).getByTestId("session-current-revoke")).toBeDisabled();
    expect(within(currentRow).getByText("sessions.cannotRevokeCurrent")).toBeInTheDocument();

    // A working alternative is offered instead of a dead button.
    expect(within(currentRow).getByTestId("session-signout-button")).toBeEnabled();

    // And nothing was sent: the server would answer 400 anyway.
    expect(stub.calls().some((c) => c.method === "DELETE")).toBe(false);
  });

  it("offers sign out as the alternative action, and it really signs out", async () => {
    const stub = stubSessions([CURRENT, LAPTOP]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    await user.click(screen.getByTestId("session-signout-button"));

    // Goes through `useAuth().logout()`, which POSTs /api/auth/logout AND
    // clears the cached PHI. Routing it through the shared hook is the point:
    // a bespoke fetch here would leave the previous user's data in memory.
    await waitFor(() => {
      expect(stub.calls().some((c) => c.url === "/api/auth/logout")).toBe(true);
    });
    // And it is not a revoke: the server refuses that, and the row stays put.
    expect(stub.calls().some((c) => c.method === "DELETE")).toBe(false);
  });

  it("refuses to revoke any row when the server does not mark the current one", async () => {
    // Guessing would either 400 or, worse, sign the user out mid-read.
    stubSessions([
      { ...CURRENT, current: undefined },
      { ...LAPTOP, current: undefined },
    ]);
    renderWithProviders(<SessionsPage />);

    const rows = await screen.findAllByTestId("session-row");
    expect(rows).toHaveLength(2);
    expect(screen.queryAllByTestId("session-revoke")).toHaveLength(0);
    expect(screen.getAllByTestId("session-unknown-current")).toHaveLength(2);
  });
});

describe("sessions page — revocation", () => {
  it("DELETEs by ref, not by session id", async () => {
    const stub = stubSessions([CURRENT, LAPTOP]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    await user.click(screen.getAllByTestId("session-revoke")[0]);

    const confirm = await screen.findByRole("button", { name: "sessions.revoke" });
    await user.click(confirm);

    await waitFor(() => {
      const deletes = stub.calls().filter((c) => c.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0].url).toBe(`/api/sessions/${LAPTOP.ref}`);
    });
  });

  it("POSTs to /api/sessions/revoke-others for sign-out-everywhere", async () => {
    const stub = stubSessions([CURRENT, LAPTOP, SERVER]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsPage />);

    await user.click(await screen.findByTestId("sessions-revoke-others"));

    // Before confirming, the dialog must state the blast radius.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("sessions.revokeOthersBody")).toHaveTextContent(
      "sessions.revokeOthersBody",
    );

    await user.click(within(dialog).getByRole("button", { name: "sessions.revokeOthersConfirm" }));

    await waitFor(() => {
      const posts = stub.calls().filter((c) => c.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe("/api/sessions/revoke-others");
    });
    // And it is NOT the legacy `DELETE /api/sessions`.
    expect(stub.calls().some((c) => c.method === "DELETE" && c.url === "/api/sessions")).toBe(false);
  });

  it("disables sign-out-everywhere when there is nothing else signed in", async () => {
    stubSessions([CURRENT]);
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByTestId("sessions-revoke-others")).toBeDisabled();
  });

  it("surfaces a failed revocation instead of reporting success", async () => {
    const stub = stubSessions([CURRENT, LAPTOP], [
      {
        match: (url, init) => url.includes("/api/sessions/") && init.method === "DELETE",
        respond: () => jsonResponse({ code: "AUTH_SESSION_REVOKED", error: "gone" }, 400),
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SessionsPage />);

    await screen.findAllByTestId("session-row");
    await user.click(screen.getAllByTestId("session-revoke")[0]);
    await user.click(await screen.findByRole("button", { name: "sessions.revoke" }));

    // The dialog stays open with an inline role="alert" — the row is NOT gone.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("gone"))).toBe(true);
    expect(stub.calls().some((c) => c.method === "DELETE")).toBe(true);
  });
});

describe("sessions page — degraded server", () => {
  it("shows an honest error and does not claim there are no sessions", async () => {
    // Prepended for the same reason as `stubSessions`: `baselineRoutes` already
    // stubs `/api/sessions`, and the first matching route wins.
    installFetch([
      {
        match: (url) => url === "/api/sessions",
        respond: () => jsonResponse({ code: "AUTH_ENDPOINT_MISSING" }, 404),
      },
      ...baselineRoutes(),
    ]);
    renderWithProviders(<SessionsPage />);

    const banner = await screen.findByTestId("sessions-load-error");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("mfa.error.unavailableTitle");
    // Explicitly NOT the empty state: "no signed-in devices" would be a lie.
    expect(screen.queryByText("sessions.empty")).toBeNull();
  });

  it("renders an empty list honestly", async () => {
    stubSessions([]);
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText("sessions.empty")).toBeInTheDocument();
  });
});