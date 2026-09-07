import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OtpVerification } from "@/components/auth/OtpVerification";

/**
 * Smoke tests for the OtpVerification component. The component uses
 * framer-motion (mocked in vitest.setup.ts to render children as-is)
 * and falls back to a no-op sound when there's no SoundProvider in the
 * tree, so we can mount it directly.
 */
describe("OtpVerification", () => {
  it("renders the default 6 digit boxes and the title", () => {
    render(<OtpVerification onVerify={() => true} onResend={() => {}} />);
    expect(screen.getByText("Enter verification code")).toBeInTheDocument();
    const boxes = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ });
    expect(boxes).toHaveLength(6);
  });

  it("respects a custom length prop", () => {
    render(
      <OtpVerification length={4} onVerify={() => true} onResend={() => {}} />,
    );
    const boxes = screen.getAllByRole("textbox", { name: /Digit \d+ of 4/ });
    expect(boxes).toHaveLength(4);
  });

  it("shows the masked destination when toLabel is provided", () => {
    render(
      <OtpVerification
        toLabel="a***@e***"
        onVerify={() => true}
        onResend={() => {}}
      />,
    );
    expect(screen.getByText(/a\*\*\*@e\*\*\*/)).toBeInTheDocument();
  });

  it("calls onVerify with the joined code once all 6 boxes are filled", async () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<OtpVerification onVerify={onVerify} onResend={() => {}} />);
    const boxes = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ });
    await userEvent.type(boxes[0], "1");
    await userEvent.type(boxes[1], "2");
    await userEvent.type(boxes[2], "3");
    await userEvent.type(boxes[3], "4");
    await userEvent.type(boxes[4], "5");
    await userEvent.type(boxes[5], "6");
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith("123456"));
  });

  it("shows the 'Verified!' heading on a successful verify", async () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<OtpVerification onVerify={onVerify} onResend={() => {}} />);
    const boxes = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ });
    for (const [i, ch] of [..."987654"].entries()) {
      await userEvent.type(boxes[i], ch);
    }
    await waitFor(() =>
      expect(screen.getByText("Verified!")).toBeInTheDocument(),
    );
  });

  it("shows the error message and resets boxes on a failed verify", async () => {
    const onVerify = vi.fn().mockResolvedValue(false);
    render(<OtpVerification onVerify={onVerify} onResend={() => {}} />);
    const boxes = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ });
    for (const [i, ch] of [..."000000"].entries()) {
      await userEvent.type(boxes[i], ch);
    }
    await waitFor(() =>
      expect(
        screen.getByRole("alert").textContent,
      ).toMatch(/Incorrect code/),
    );
    // After a failure, the component clears the boxes.
    const after = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ });
    for (const b of after) {
      expect((b as HTMLInputElement).value).toBe("");
    }
  });

  it("triggers onResend when the resend button is clicked and starts the cooldown", async () => {
    const onResend = vi.fn().mockResolvedValue(undefined);
    render(<OtpVerification onResend={onResend} onVerify={() => true} />);
    const btn = screen.getByRole("button", { name: "Resend" });
    await userEvent.click(btn);
    expect(onResend).toHaveBeenCalledTimes(1);
    // The button label switches to a countdown; we don't assert the
    // exact text because the cooldown ticks via setTimeout.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Resend in/ }).textContent ?? ""),
      ).toMatch(/Resend in 0:/),
    );
  });

  it("strips non-digit characters from typed input", () => {
    const onVerify = vi.fn().mockResolvedValue(true);
    render(<OtpVerification onVerify={onVerify} onResend={() => {}} />);
    const box0 = screen.getAllByRole("textbox", { name: /Digit \d+ of 6/ })[0];
    // Fire a single change event with mixed input. The component's
    // handleChange keeps only the last digit.
    act(() => {
      const native = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      );
      native?.set?.call(box0, "a7");
      box0.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((box0 as HTMLInputElement).value).toBe("7");
  });
});
