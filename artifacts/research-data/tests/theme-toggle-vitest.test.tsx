import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  it("renders a button with the translated title", () => {
    render(<ThemeToggle />);
    const btn = screen.getByTitle("theme.toggle");
    expect(btn.tagName).toBe("BUTTON");
  });

  it("flips the theme from light to dark on click", async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByTitle("theme.toggle"));
    expect((globalThis as any).__nextThemeState.theme).toBe("dark");
  });

  it("flips the theme from dark to light on click", async () => {
    (globalThis as any).__setNextTheme("dark");
    render(<ThemeToggle />);
    await userEvent.click(screen.getByTitle("theme.toggle"));
    expect((globalThis as any).__nextThemeState.theme).toBe("light");
  });

  it("renders both Sun and Moon icons", () => {
    const { container } = render(<ThemeToggle />);
    // lucide-react renders both icons; the visible one is controlled by
    // CSS classes, but both nodes exist in the DOM.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});
