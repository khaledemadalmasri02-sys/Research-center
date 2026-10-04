/**
 * The recovery-code reveal and the confirm-before-leave guard.
 *
 * This is the only screen in the flow whose contents cannot be reproduced. If
 * a user loses these codes they lose their account, so the tests below are
 * mostly about what CANNOT happen: no silent exit, no empty reveal, no claim of
 * success, and no navigation away without an acknowledgement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MfaSetupPage from "@/pages/mfa-setup";
import { RecoveryCodesPanel } from "@/components/auth/mfa";
import {
  RECOVERY_CODES,
  SECRET,
  URI,
  baselineRoutes,
  installFetch,
  installMatchMedia,
  jsonResponse,
  renderWithProviders,
} from "./mfa-fixtures";

let restoreMatchMedia: (() => void) | null = null;

beforeEach(() => {
  restoreMatchMedia = installMatchMedia();
  // Every test starts at a known URL: the leave guard reverts the address bar,
  // and a leaked pushState would make later assertions lie.
  window.history.replaceState({}, "", "/mfa-setup");
});

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  vi.unstubAllGlobals();
});

function routes(recoveryCodes = RECOVERY_CODES) {
  return installFetch(
    baselineRoutes([
      {
        match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
        respond: () => jsonResponse({ ok: true }),
      },
      {
        match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
        respond: () => jsonResponse({ secret: SECRET, otpauthUri: URI }),
      },
      {
        match: (url, init) => url === "/api/auth/mfa/enroll/confirm" && init.method === "POST",
        respond: () => jsonResponse({ recoveryCodes }),
      },
    ]),
  );
}

async function reachRecovery(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<MfaSetupPage />);
  await user.click(await screen.findByTestId("mfa-intro-start"));
  await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
  await user.click(screen.getByTestId("mfa-reauth-submit"));
  await user.click(await screen.findByTestId("mfa-enroll-continue"));
  for (const [i, d] of ["4", "1", "9", "2", "0", "7"].entries()) {
    await user.type(screen.getAllByRole("textbox")[i], d);
  }
  await user.click(screen.getByTestId("mfa-verify-submit"));
  return screen.findByTestId("mfa-recovery-codes");
}

/** Same walk, but tolerating a confirm that fails instead of advancing. */
async function reachRecoveryOrError(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<MfaSetupPage />);
  await user.click(await screen.findByTestId("mfa-intro-start"));
  await user.type(await screen.findByLabelText("mfa.reauth.fieldLabel", { selector: "input" }), "pw");
  await user.click(screen.getByTestId("mfa-reauth-submit"));
  await user.click(await screen.findByTestId("mfa-enroll-continue"));
  for (const [i, d] of ["4", "1", "9", "2", "0", "7"].entries()) {
    await user.type(screen.getAllByRole("textbox")[i], d);
  }
  await user.click(screen.getByTestId("mfa-verify-submit"));
  await screen.findByTestId("mfa-error");
}

describe("recovery codes — the once-only reveal", () => {
  it("warns, unmissably, that the codes are shown only once", async () => {
    routes();
    const panel = await reachRecovery(userEvent.setup());

    const warning = within(panel).getByRole("alert");
    expect(warning).toHaveTextContent("mfa.recovery.onceTitle");
    expect(warning).toHaveTextContent("mfa.recovery.onceBody");
  });

  it("renders every returned code, exactly once each", async () => {
    routes();
    const panel = await reachRecovery(userEvent.setup());

    const rendered = within(panel).getAllByTestId("mfa-recovery-code").map((n) => n.textContent);
    expect(rendered).toEqual(RECOVERY_CODES);
    expect(within(panel).getByTestId("mfa-recovery-count")).toHaveTextContent("10 mfa.recovery.countUnit");
  });

  it("never reaches the reveal when the server returns no usable codes", async () => {
    // A 200 with an empty list means the account has no way back in. The page
    // must fail at the verify step rather than advance to a reveal of nothing.
    routes([]);
    const user = userEvent.setup();
    await reachRecoveryOrError(user);

    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_UNKNOWN");
  });

  it("renders an empty panel as a hard failure, not as 'you have no codes'", async () => {
    // Defence in depth: if the panel is ever handed an empty list it must not
    // present it as a completed reveal.
    renderWithProviders(
      <RecoveryCodesPanel codes={[]} acknowledgeLabel="mfa.recovery.acknowledge" onAcknowledge={() => {}} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("mfa.recovery.missingTitle");
    expect(alert).toHaveTextContent("mfa.recovery.missingBody");
    expect(screen.queryAllByTestId("mfa-recovery-code")).toHaveLength(0);
  });

  it("refuses the leave until the codes are acknowledged", async () => {
    routes();
    const user = userEvent.setup();
    await reachRecovery(user);

    expect(screen.queryByTestId("mfa-leave-guard")).toBeNull();

    window.history.pushState({}, "", "/somewhere-else");

    const guard = await screen.findByTestId("mfa-leave-guard");
    expect(guard).toHaveAttribute("role", "alertdialog");
    expect(within(guard).getByText("mfa.recovery.guardBody")).toBeInTheDocument();
    // The URL was reverted: the navigation did not happen.
    expect(window.location.pathname).toBe("/mfa-setup");
    // Still on the codes.
    expect(screen.getByTestId("mfa-recovery-codes")).toBeInTheDocument();
  });

  it("keeps the codes when the user chooses to stay", async () => {
    routes();
    const user = userEvent.setup();
    await reachRecovery(user);

    window.history.pushState({}, "", "/somewhere-else");
    await screen.findByTestId("mfa-leave-guard");
    await user.click(screen.getByTestId("mfa-leave-guard-stay"));

    await waitFor(() => expect(screen.queryByTestId("mfa-leave-guard")).toBeNull());
    expect(screen.getByTestId("mfa-recovery-codes")).toBeInTheDocument();

    // And it blocks again on the next attempt: cancelling is not a release.
    window.history.pushState({}, "", "/elsewhere");
    expect(await screen.findByTestId("mfa-leave-guard")).toBeInTheDocument();
  });

  it("releases the guard only after the explicit acknowledgement", async () => {
    routes();
    const user = userEvent.setup();
    await reachRecovery(user);

    await user.click(screen.getByTestId("mfa-recovery-acknowledge"));
    await screen.findByText("mfa.done.title");

    window.history.pushState({}, "", "/mfa-setup");
    expect(screen.queryByTestId("mfa-leave-guard")).toBeNull();
  });

  it("registers a beforeunload block while the codes are on screen", async () => {
    routes();
    const user = userEvent.setup();
    const addSpy = vi.spyOn(window, "addEventListener");
    await reachRecovery(user);

    expect(
      addSpy.mock.calls.some(([type]) => type === "beforeunload"),
    ).toBe(true);
    addSpy.mockRestore();
  });

  it("offers a download of the codes as text", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    routes();
    const user = userEvent.setup();
    const panel = await reachRecovery(user);

    await user.click(within(panel).getByText("mfa.recovery.download"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
    const text = await blob.text();
    for (const code of RECOVERY_CODES) expect(text).toContain(code);
    expect(text).toContain("mfa.recovery.fileWarning");
  });

  it("keeps the codes out of every persistent store", async () => {
    routes();
    const user = userEvent.setup();
    await reachRecovery(user);

    // Recovery codes are unrecoverable by design. Caching them anywhere would
    // silently undo that, so assert nothing was written.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.href).not.toMatch(/%7B|code=/);
  });
});