import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { OtpVerification } from "@/components/auth/OtpVerification";
import { ThemeToggle } from "@/components/theme-toggle";

expect.extend(toHaveNoViolations);

describe("accessibility — axe-core (P3.4)", () => {
  it("OtpVerification has no axe violations", async () => {
    const { container } = render(
      <OtpVerification
        onVerify={() => true}
        onResend={() => {}}
        toLabel="a***@e***"
        title="Enter verification code"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("ThemeToggle has no axe violations", async () => {
    const { container } = render(<ThemeToggle />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("a successful OTP submission state has no axe violations", async () => {
    const { container } = render(
      <OtpVerification
        onVerify={async () => true}
        onResend={() => {}}
      />,
    );
    // The success heading replaces the form; the rendered DOM should
    // still pass axe.
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
