import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import Welcome from "@/pages/welcome";

function renderWelcome() {
  return render(<Welcome />);
}

afterEach(() => {
  (globalThis as unknown as { __resetReducedMotion?: () => void }).__resetReducedMotion?.();
});

/**
 * `Welcome` gates autoplay through `prefersReducedMotion()` in
 * `src/lib/motion-preferences.ts`, which reads `window.matchMedia` directly and
 * deliberately degrades to "motion allowed" when matchMedia is missing — which
 * is the case under jsdom. Stubbing the framer-motion `useReducedMotion` hook
 * would therefore have no effect on this component, so `matchMedia` is stubbed
 * instead. That also means every test in this file runs with autoplay ON unless
 * it opts out, which is asserted explicitly below rather than left implicit.
 */
function stubPrefersReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: original,
  });
}

describe("Welcome page", () => {
  it("renders the landing headline and sign-in call to action", () => {
    renderWelcome();
    expect(screen.getByText("landing.headline")).not.toBeNull();
    expect(screen.getAllByText("landing.signIn").length).toBeGreaterThan(0);
  });

  it("renders a link to sign up that points at /signup", () => {
    renderWelcome();
    const signUpLinks = screen.getAllByText("landing.signUp");
    expect(signUpLinks.length).toBeGreaterThanOrEqual(1);
    const anchor = signUpLinks[0].closest("a");
    expect(anchor?.getAttribute("href")).toBe("/signup");
  });

  it("renders feature cards and the four product tour videos", () => {
    renderWelcome();
    expect(screen.getByText("landing.featuresTitle")).not.toBeNull();
    expect(screen.getByText("tour.title")).not.toBeNull();
    const videos = document.querySelectorAll("video");
    // 1 hero video + 4 product guide tour videos
    expect(videos.length).toBe(5);
    const tour = Array.from(videos)
      .slice(1)
      .map((v) => v.getAttribute("src"));
    expect(tour).toEqual([
      "/tour/welcome.mp4",
      "/tour/patients.mp4",
      "/tour/dataAnalysis.mp4",
      "/tour/moreFeatures.mp4",
    ]);
  });

  /**
   * The landing page previously rendered five `<video autoPlay muted loop>`
   * elements that all began downloading and playing at once, with no `preload`,
   * no poster and no `<track kind="captions">` — a WCAG 1.2.2 failure plus a
   * heavy first paint on the public entry page.
   *
   * Current behaviour, asserted below rather than assumed:
   *  - every clip is `preload="none"` with a poster and a captions track;
   *  - only the HERO autoplays, and only when the visitor has not asked for
   *    reduced motion;
   *  - the four tour clips never autoplay at all — they are `controls`-driven.
   *
   * `useReducedMotion` is mocked in tests/vitest.setup.tsx and defaults to
   * true, so the reduced-motion branch needs no setup and the motion-allowed
   * branch opts in via `__setReducedMotion(false)`.
   */
  it("does not autoplay the hero when the visitor prefers reduced motion", () => {
    const restore = stubPrefersReducedMotion(true);
    try {
      renderWelcome();
      const hero = document.querySelector("video") as HTMLVideoElement;
      expect(hero.hasAttribute("autoplay")).toBe(false);
      expect(hero.hasAttribute("loop")).toBe(false);
    } finally {
      restore();
    }
  });

  it("autoplays and loops the hero when motion is allowed", () => {
    const restore = stubPrefersReducedMotion(false);
    try {
      renderWelcome();
      const hero = document.querySelector("video") as HTMLVideoElement;
      expect(hero.hasAttribute("autoplay")).toBe(true);
      expect(hero.hasAttribute("loop")).toBe(true);
      expect(hero.muted).toBe(true);
      expect(hero.playsInline).toBe(true);
      // Only the hero. The four tour clips must never autoplay, whatever the
      // motion preference -- five simultaneous streams is the bug being guarded.
      const tour = Array.from(document.querySelectorAll("video")).slice(1);
      expect(tour).toHaveLength(4);
      for (const v of tour) {
        expect(v.hasAttribute("autoplay")).toBe(false);
      }
    } finally {
      restore();
    }
  });

  it("gives every video a captions track, a poster and preload=none", () => {
    renderWelcome();
    const videos = Array.from(document.querySelectorAll("video"));
    expect(videos.length).toBe(5);
    for (const v of videos) {
      // WCAG 1.2.2 — captions for prerecorded video with audio.
      const track = v.querySelector("track");
      expect(track).not.toBeNull();
      expect(track?.getAttribute("kind")).toBe("captions");
      // Nothing should compete for bandwidth before the visitor asks for it.
      expect(v.getAttribute("preload")).toBe("none");
      expect(v.getAttribute("poster")).toBeTruthy();
    }
  });

  it("renders a looped muted hero video that autoplays only when motion is allowed", () => {
    const restore = stubPrefersReducedMotion(false);
    try {
      renderWelcome();
      const video = document.querySelector("video");
      expect(video).not.toBeNull();
      expect(video?.getAttribute("src")).toBe("/tour/welcome.mp4");
      expect(video?.hasAttribute("autoplay")).toBe(true);
      expect(video?.hasAttribute("loop")).toBe(true);
      expect(video?.muted).toBe(true);
    } finally {
      restore();
    }
  });

  it("renders the security section", () => {
    renderWelcome();
    expect(screen.getByText("landing.securityTitle")).not.toBeNull();
    expect(screen.getByText("landing.securityBody")).not.toBeNull();
  });
});
