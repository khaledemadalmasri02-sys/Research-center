/**
 * `RecoveryCodeEntry` — Task 2, the "use a recovery code instead" affordance.
 *
 * The component is prop-driven (`onRedeem`), so these tests exercise it exactly
 * as `auth.tsx` will mount it: no network, no router, no QueryClient. The
 * single-use rule is asserted here because the login page cannot enforce it —
 * the component has to, or a refused code can be replayed for ever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";

import { RecoveryCodeEntry, formatRecoveryCode, normaliseRecoveryCode } from "@/components/auth/mfa";
import { AuthApiError } from "@/components/auth/mfa/errors";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const refused = () =>
  Promise.reject(new AuthApiError({ code: "AUTH_RECOVERY_INVALID", message: "Bad code", status: 400 }));

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("mfa-recovery-trigger"));
  return screen.findByTestId("mfa-recovery-code");
}

describe("recovery code normalisation", () => {
  it("ignores spacing and case, so formatting cannot cause a failure", () => {
    expect(normaliseRecoveryCode("k7m2p-9qrtx")).toBe("K7M2P9QRTX");
    expect(normaliseRecoveryCode("  k7 m2p_9qrtx  ")).toBe("K7M2P9QRTX");
    expect(formatRecoveryCode("k7m2p9qrtx")).toBe("K7M2P-9QRTX");
    expect(formatRecoveryCode("K7M2")).toBe("K7M2");
  });
});

describe("RecoveryCodeEntry", () => {
  it("starts collapsed behind a labelled affordance", () => {
    render(<RecoveryCodeEntry onRedeem={vi.fn()} />);
    const trigger = screen.getByTestId("mfa-recovery-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("mfa-recovery-code")).toBeNull();
  });

  it("expands into a labelled, described field", async () => {
    const user = userEvent.setup();
    render(<RecoveryCodeEntry onRedeem={vi.fn()} />);
    const field = await openPanel(user);

    expect(field).toHaveAccessibleName("mfa.recoveryEntry.fieldLabel");
    expect(field).toHaveAttribute("aria-describedby", "mfa-recovery-code-hint");
    expect(screen.getByText("mfa.recoveryEntry.hint")).toBeInTheDocument();
    // No SMS autofill: a recovery code is not an SMS.
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it("submits the normalised code", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn(async () => {});
    render(<RecoveryCodeEntry onRedeem={onRedeem} collapsedByDefault={false} />);

    await user.type(screen.getByTestId("mfa-recovery-code"), "k7m2p9qrtx");
    await user.click(screen.getByTestId("mfa-recovery-submit"));

    await waitFor(() => expect(onRedeem).toHaveBeenCalledWith("K7M2P9QRTX"));
  });

  it("locks after acceptance and offers no way to submit again", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn(async () => {});
    render(<RecoveryCodeEntry onRedeem={onRedeem} collapsedByDefault={false} />);

    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));

    await screen.findByTestId("mfa-recovery-accepted");
    // The form is gone: no input, no submit, no trigger.
    expect(screen.queryByTestId("mfa-recovery-code")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-submit")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-trigger")).toBeNull();
    // And the only message says a code cannot be reused.
    expect(screen.getByText("mfa.recoveryEntry.acceptedBody")).toBeInTheDocument();
  });

  it("BURNED: the same code can never be submitted twice, even after a refusal", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn(refused);
    render(<RecoveryCodeEntry onRedeem={onRedeem} collapsedByDefault={false} />);

    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));
    await screen.findByTestId("mfa-error");
    expect(onRedeem).toHaveBeenCalledTimes(1);

    // Same code again: refused locally, never sent. A recovery code is valid
    // once; re-sending a burned one is indistinguishable from a guess.
    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    expect(screen.getByText("mfa.recoveryEntry.alreadyTried")).toBeInTheDocument();
    expect(screen.getByTestId("mfa-recovery-submit")).toBeDisabled();
    expect(onRedeem).toHaveBeenCalledTimes(1);
  });

  it("accepts a different code after one was refused (typo recovery)", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn(refused);
    render(<RecoveryCodeEntry onRedeem={onRedeem} collapsedByDefault={false} />);

    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));
    await screen.findByTestId("mfa-error");

    await user.type(screen.getByTestId("mfa-recovery-code"), "B4ZWD6HNVJ");
    await user.click(screen.getByTestId("mfa-recovery-submit"));

    await waitFor(() => expect(onRedeem).toHaveBeenCalledTimes(2));
    expect(onRedeem).toHaveBeenLastCalledWith("B4ZWD6HNVJ");
  });

  it("fails loudly on a refused code — danger, assertive, no success", async () => {
    const user = userEvent.setup();
    render(<RecoveryCodeEntry onRedeem={vi.fn(refused)} collapsedByDefault={false} />);

    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));

    const banner = await screen.findByTestId("mfa-error");
    expect(banner).toHaveAttribute("data-error-code", "AUTH_RECOVERY_INVALID");
    expect(banner).toHaveAttribute("data-error-severity", "danger");
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("mfa-recovery-accepted")).toBeNull();
  });

  it("locks the form for the server's rate-limit window", async () => {
    const user = userEvent.setup();
    render(
      <RecoveryCodeEntry
        collapsedByDefault={false}
        onRedeem={vi.fn(() =>
          Promise.reject(
            new AuthApiError({
              code: "AUTH_RATE_LIMITED",
              message: "slow down",
              status: 429,
              retryAfterSec: 45,
            }),
          ),
        )}
      />,
    );

    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));

    const notice = await screen.findByTestId("mfa-rate-limit");
    expect(Number(notice.getAttribute("data-remaining-seconds"))).toBeGreaterThan(40);
    expect(screen.getByTestId("mfa-recovery-code")).toBeDisabled();
    expect(screen.getByTestId("mfa-recovery-submit")).toBeDisabled();
  }, 20000);

  it("calls onCancel and can be closed by the host", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RecoveryCodeEntry onRedeem={vi.fn()} onCancel={onCancel} collapsedByDefault={false} />);

    await user.click(screen.getByTestId("mfa-recovery-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders an inline form inside a panel host", async () => {
    const user = userEvent.setup();
    render(
      <RecoveryCodeEntry
        onRedeem={vi.fn(async () => {})}
        variant="panel"
        collapsedByDefault={false}
      />,
    );
    expect(screen.getByText("mfa.recoveryEntry.title")).toBeInTheDocument();
    expect(screen.getByText("mfa.recoveryEntry.description")).toBeInTheDocument();
    // A panel is a full card with its own heading; an inline host has neither.
    const heading = screen.getByText("mfa.recoveryEntry.title");
    expect(heading.tagName).toBe("H2");
    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
  });

  it("has no axe violations (collapsed, expanded, refused and accepted)", async () => {
    const { container, unmount } = render(<RecoveryCodeEntry onRedeem={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    const expanded = render(<RecoveryCodeEntry onRedeem={vi.fn()} collapsedByDefault={false} />);
    expect(await axe(expanded.container)).toHaveNoViolations();
    expanded.unmount();

    const user = userEvent.setup();
    const refusedState = render(
      <RecoveryCodeEntry onRedeem={vi.fn(refused)} collapsedByDefault={false} />,
    );
    await user.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user.click(screen.getByTestId("mfa-recovery-submit"));
    await screen.findByTestId("mfa-error");
    expect(await axe(refusedState.container)).toHaveNoViolations();
    refusedState.unmount();

    const user2 = userEvent.setup();
    const acceptedState = render(
      <RecoveryCodeEntry onRedeem={vi.fn(async () => {})} collapsedByDefault={false} />,
    );
    await user2.type(screen.getByTestId("mfa-recovery-code"), "K7M2P9QRTX");
    await user2.click(screen.getByTestId("mfa-recovery-submit"));
    await screen.findByTestId("mfa-recovery-accepted");
    expect(await axe(acceptedState.container)).toHaveNoViolations();
  });
});