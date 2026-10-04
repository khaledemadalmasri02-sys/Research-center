/**
 * The MFA setup wizard: step machine, enrolment slot, and the verify step.
 *
 * Every assertion matches an i18n KEY (the suite mocks `t: (key) => key`), so
 * these tests are about behaviour and wiring rather than copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MfaSetupPage from "@/pages/mfa-setup";
import {
  SECRET,
  URI,
  baselineRoutes,
  installClipboard,
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

const enrollRoutes = (extra: Parameters<typeof installFetch>[0] = []) =>
  installFetch(
    baselineRoutes([
      {
        match: (url, init) => url === "/api/auth/reauth" && init.method === "POST",
        respond: () => jsonResponse({ ok: true, reauthenticatedAt: "2026-10-03T12:00:00.000Z" }),
      },
      {
        match: (url, init) => url === "/api/auth/mfa/enroll" && init.method === "POST",
        respond: () => jsonResponse({ secret: SECRET, otpauthUri: URI }),
      },
      ...extra,
    ]),
  );

/**
 * Render the page and walk intro -> reauth -> enroll.
 *
 * The `user` argument is passed IN rather than created here because
 * `userEvent.setup()` installs its own `navigator.clipboard` stub. A test that
 * wants to assert on clipboard calls must create its user first and install its
 * spy afterwards, or `setup()` will silently replace it.
 */
async function walkToEnroll(user: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  renderWithProviders(<MfaSetupPage />);
  await user.click(await screen.findByTestId("mfa-intro-start"));
  const password = await screen.findByLabelText("mfa.reauth.fieldLabel", {
    selector: "input",
  });
  await user.type(password, "correct horse battery");
  await user.click(screen.getByTestId("mfa-reauth-submit"));
  return user;
}

describe("MFA setup — step machine", () => {
  it("starts on the intro step and explains what MFA is for", async () => {
    enrollRoutes();
    renderWithProviders(<MfaSetupPage />);

    expect(await screen.findByText("mfa.intro.p1")).toBeInTheDocument();
    expect(screen.getByText("mfa.intro.p2")).toBeInTheDocument();
    expect(screen.getByText("mfa.intro.p3")).toBeInTheDocument();
    // The user is told about the once-only recovery codes BEFORE enrolling.
    expect(screen.getByText("mfa.intro.headsUp")).toBeInTheDocument();
    expect(screen.getByText("mfa.intro.headsUpBody")).toBeInTheDocument();
  });

  it("says so when the server cannot tell us whether MFA is already on", async () => {
    installFetch(
      baselineRoutes([
        {
          match: (url) => url === "/api/auth/me",
          // A server predating the `mfaEnabled` field.
          respond: () => jsonResponse({ authenticated: true, username: "dr.chen" }),
        },
      ]),
    );
    renderWithProviders(<MfaSetupPage />);

    expect(await screen.findByTestId("mfa-status-unknown")).toBeInTheDocument();
    expect(screen.getByText("mfa.intro.statusUnknown")).toBeInTheDocument();
  });

  it("does not start an enrolment before a password has been re-entered", async () => {
    const stub = enrollRoutes();
    const user = userEvent.setup();
    renderWithProviders(<MfaSetupPage />);

    await user.click(await screen.findByTestId("mfa-intro-start"));
    await screen.findByTestId("mfa-reauth-form");

    const before = stub.calls().filter((c) => c.url === "/api/auth/mfa/enroll").length;
    expect(before).toBe(0);

    // The submit button is inert with an empty password.
    expect(screen.getByTestId("mfa-reauth-submit")).toBeDisabled();
  });

  it("POSTs /api/auth/reauth with the typed password, then enrols", async () => {
    const stub = enrollRoutes();
    await walkToEnroll();

    await screen.findByTestId("mfa-enroll-continue");

    const reauth = stub.calls().find((c) => c.url === "/api/auth/reauth");
    expect(reauth?.method).toBe("POST");
    expect(reauth?.body).toEqual({ password: "correct horse battery" });
    expect(stub.calls().some((c) => c.url === "/api/auth/mfa/enroll")).toBe(true);
  });

  it("shows the media slot with manual entry and no QR image", async () => {
    enrollRoutes();
    await walkToEnroll();

    const slot = await screen.findByTestId("mfa-secret");
    expect(slot.closest("[data-mfa-media-slot]")).not.toBeNull();

    const media = document.querySelector('[data-mfa-media-slot="otpauth"]') as HTMLElement;
    expect(media.dataset.mode).toBe("manual");
    // No QR library exists in this tree, so there must be no <img> in the slot.
    expect(media.querySelector("img")).toBeNull();

    // Manual entry is the current fallback, not buried behind a disclosure.
    expect(media.querySelector("[data-mfa-manual-entry]")).not.toBeNull();
    expect(screen.getByText("mfa.enroll.manualChoice")).toBeInTheDocument();
    expect(screen.getByTestId("mfa-otpauth-uri")).toHaveTextContent(URI);
  });

  it("groups the secret for reading but copies the raw value", async () => {
    const user = userEvent.setup();
    const writeText = installClipboard();
    enrollRoutes();
    await walkToEnroll(user);

    const secret = await screen.findByTestId("mfa-secret");
    // Displayed in groups of four so it can be read aloud and typed.
    expect(secret.textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    // But the clipboard gets the unspaced original.
    const copyButtons = screen.getAllByRole("button", { name: "mfa.copyAria" });
    await user.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
  });

  it("reports a copy failure instead of claiming success", async () => {
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    enrollRoutes();
    await walkToEnroll(user);

    await screen.findByTestId("mfa-secret");
    await user.click(screen.getAllByRole("button", { name: "mfa.copyAria" })[0]);

    // No "Copied" — the honest state is the failure line, which is what stops a
    // user typing a TOTP secret they never actually copied.
    await waitFor(() => {
      expect(screen.getByText("mfa.copyFailed")).toBeInTheDocument();
    });
    expect(screen.queryByText("mfa.copied")).toBeNull();
  });

  it("advances to a 6-box verify step and refuses to submit an incomplete code", async () => {
    const stub = enrollRoutes();
    const user = await walkToEnroll();

    await user.click(await screen.findByTestId("mfa-enroll-continue"));

    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(6);
    expect(screen.getByTestId("mfa-verify-submit")).toBeDisabled();

    await user.type(boxes[0], "123");
    expect(screen.getByTestId("mfa-verify-submit")).toBeDisabled();
    expect(stub.calls().some((c) => c.url.includes("enroll/confirm"))).toBe(false);
  });

  it("submits the joined code to /mfa/enroll/confirm", async () => {
    const stub = enrollRoutes([
      {
        match: (url, init) => url === "/api/auth/mfa/enroll/confirm" && init.method === "POST",
        respond: () =>
          jsonResponse({ recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD", "EEEEE-FFFFF"] }),
      },
    ]);
    const user = await walkToEnroll();

    await user.click(await screen.findByTestId("mfa-enroll-continue"));
    const boxes = screen.getAllByRole("textbox");
    for (const [i, d] of ["4", "1", "9", "2", "0", "7"].entries()) {
      await user.type(boxes[i], d);
    }

    await user.click(screen.getByTestId("mfa-verify-submit"));

    await waitFor(() => {
      expect(
        stub.calls().some((c) => c.url === "/api/auth/mfa/enroll/confirm"),
      ).toBe(true);
    });
    const confirm = stub.calls().find((c) => c.url === "/api/auth/mfa/enroll/confirm");
    expect(confirm?.body).toEqual({ code: "419207" });
  });

  it("steps backwards from verify to the setup key", async () => {
    enrollRoutes();
    const user = await walkToEnroll();

    await user.click(await screen.findByTestId("mfa-enroll-continue"));
    expect(screen.getByTestId("mfa-verify-submit")).toBeInTheDocument();

    await user.click(screen.getByText("mfa.verify.back"));

    // The secret is still there: going back must not require re-enrolling, which
    // would rotate it and break the app the user just added.
    expect(await screen.findByTestId("mfa-secret")).toBeInTheDocument();
    expect(screen.queryByTestId("mfa-verify-submit")).toBeNull();
  });

  it("marks the rail step as current for assistive tech", async () => {
    enrollRoutes();
    const { container } = renderWithProviders(<MfaSetupPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("mfa-intro-start"));
    await screen.findByTestId("mfa-reauth-form");

    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("mfa.step.reauth");
    // Exactly one current step, so a screen reader announces one position.
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
});