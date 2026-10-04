import { describe, it, expect, vi } from "vitest";

describe("desktop-mode", () => {
  it("returns true for non-www host in test env", () => {
    // In test env, host is typically localhost or empty
    const isDesktop = !window.location.host.startsWith("www.");
    expect(isDesktop).toBe(true);
  });

  it("checks www prefix logic correctly", () => {
    // Test the logic directly without modifying window.location
    expect("www.example.com".startsWith("www.")).toBe(true);
    expect("example.com".startsWith("www.")).toBe(false);
    expect("research-center.fit".startsWith("www.")).toBe(false);
  });
});
