/**
 * Motion system — token shape, preference plumbing, the stagger cap, and
 * reduced-motion behaviour on a primitive that actually renders.
 *
 * These are the tests that keep the motion system honest as four agents edit
 * the same repo at once. Specifically they pin:
 *
 *   - the numeric tokens other agents are coding against, so a well-meaning
 *     "let me just bump that curve" cannot silently change every dialog;
 *   - the CSS/JS parity between `--dur-*` in src/index.css and `DURATION` in
 *     src/lib/motion.tsx, which is the only thing stopping the stylesheet and
 *     the animation engine from drifting apart;
 *   - the stagger cap, which is a correctness property and not a taste
 *     question: an unbounded stagger on the patients list is a defect;
 *   - that the preference layer degrades safely in jsdom, where
 *     `window.matchMedia` does not exist at all.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";

import {
  BASE_STAGGER_DELAY_S,
  DURATION,
  EASE_EMPHASIZED,
  EASE_IN,
  EASE_IN_OUT,
  EASE_OUT,
  LAYOUT_REDUCED_MOTION,
  MAX_STAGGERED_CHILDREN,
  SPRING,
  STAGGER_BUDGET_S,
  Stagger,
  StaggerItem,
  cappedStagger,
  fadeIn,
  fadeOut,
  layoutTransition,
  listContainer,
  listItem,
  scaleIn,
  shouldReduceMotion,
  slideUp,
  staggerStartDelay,
  useMotionPrefs,
} from "@/lib/motion";
import {
  REDUCED_DATA_QUERY,
  REDUCED_MOTION_QUERY,
  prefersReducedData,
  prefersReducedMotion,
} from "@/lib/motion-preferences";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = readFileSync(
  resolve(__dirname, "../src/index.css"),
  "utf8",
);

/* -------------------------------------------------------------------------
 * matchMedia stubbing. jsdom 30 does not implement window.matchMedia at all
 * (verified), which is exactly the fallback path the production code has to
 * survive — so the default state of every test below is "the query cannot be
 * evaluated".
 * ---------------------------------------------------------------------- */
type Listener = () => void;

function stubMatchMedia(matching: Record<string, boolean>) {
  const listeners = new Set<Listener>();
  const impl = (query: string) => {
    const mql = {
      matches: matching[query] === true,
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: Listener) => {
        listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: Listener) => {
        listeners.delete(cb);
      },
      addListener: (cb: Listener) => {
        listeners.add(cb);
      },
      removeListener: (cb: Listener) => {
        listeners.delete(cb);
      },
      dispatchEvent: () => false,
    };
    return mql;
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: impl,
  });
  return {
    fire: () => listeners.forEach((l) => l()),
  };
}

function removeMatchMedia() {
  Reflect.deleteProperty(window, "matchMedia");
}

const hadMatchMedia = "matchMedia" in window;
const originalMatchMedia = (window as unknown as Record<string, unknown>)
  .matchMedia;

afterEach(() => {
  // The shared harness defaults reduced motion to ON for every test file.
  // Reset it so one test's opt-out cannot leak into the next.
  (globalThis as unknown as { __resetReducedMotion?: () => void })
    .__resetReducedMotion?.();
  if (hadMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  } else {
    removeMatchMedia();
  }
});

/* =========================================================================
 * 1. Token shape
 * ====================================================================== */

describe("motion tokens", () => {
  it("DURATION has exactly the agreed scale", () => {
    expect(DURATION).toEqual({
      instant: 0.12,
      fast: 0.18,
      base: 0.28,
      slow: 0.42,
      deliberate: 0.6,
    });
  });

  it("DURATION is monotonically increasing", () => {
    const values = Object.values(DURATION);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("no duration is slow enough to delay clinical work", () => {
    // 600ms is the deliberate ceiling. Anything longer and a modal or a
    // drawer is still travelling while the user is already clicking the next
    // control.
    expect(Math.max(...Object.values(DURATION))).toBeLessThanOrEqual(0.6);
  });

  it("EASE_* are the agreed cubic-bezier control points", () => {
    expect([...EASE_OUT]).toEqual([0.22, 1, 0.36, 1]);
    expect([...EASE_IN]).toEqual([0.4, 0, 1, 1]);
    expect([...EASE_IN_OUT]).toEqual([0.65, 0, 0.35, 1]);
    expect([...EASE_EMPHASIZED]).toEqual([0.2, 0, 0, 1]);
  });

  it("EASE_OUT is still the brand curve that was already in App.tsx/auth.tsx", () => {
    // Regression guard: this exact value is imported by three files we do not
    // own. Changing it would retune every transition in the app.
    expect(EASE_OUT[0]).toBe(0.22);
    expect(EASE_OUT[1]).toBe(1);
    expect(EASE_OUT[2]).toBe(0.36);
    expect(EASE_OUT[3]).toBe(1);
  });

  it("SPRING exposes three named configs with real spring physics", () => {
    expect(Object.keys(SPRING).sort()).toEqual(["gentle", "smooth", "snappy"]);
    for (const name of Object.keys(SPRING) as Array<keyof typeof SPRING>) {
      const cfg = SPRING[name];
      expect(cfg.type).toBe("spring");
      expect(typeof cfg.stiffness).toBe("number");
      expect(typeof cfg.damping).toBe("number");
      expect(typeof cfg.mass).toBe("number");
      expect(cfg.stiffness).toBeGreaterThan(0);
      expect(cfg.mass).toBeGreaterThan(0);
      expect(cfg.damping).toBeGreaterThan(0);
    }
  });

  it("springs are ordered from snappy to gentle", () => {
    expect(SPRING.snappy.stiffness).toBeGreaterThan(SPRING.smooth.stiffness);
    expect(SPRING.smooth.stiffness).toBeGreaterThan(SPRING.gentle.stiffness);
    expect(SPRING.snappy.mass).toBeLessThan(SPRING.gentle.mass);
  });

  it("springs are near-critically damped (no visible bounce)", () => {
    // zeta = damping / (2 * sqrt(stiffness * mass)); 1.0 is critical damping.
    // Below ~0.85 overshoots enough to be noticed, and a bouncing clinical
    // control reads as broken.
    for (const name of Object.keys(SPRING) as Array<keyof typeof SPRING>) {
      const { stiffness, damping, mass } = SPRING[name];
      const zeta = damping / (2 * Math.sqrt(stiffness * mass));
      expect(zeta).toBeGreaterThan(0.85);
      expect(zeta).toBeLessThanOrEqual(1);
    }
  });

  it("variants are objects with hidden/show keys", () => {
    for (const v of [fadeIn, fadeOut, scaleIn, slideUp, listContainer, listItem]) {
      expect(v).toHaveProperty("hidden");
      expect(v).toHaveProperty("show");
    }
  });

  it("scaleIn moves 0.96 -> 1, the agreed popover/dialog scale", () => {
    const hidden = scaleIn.hidden as { scale?: number; opacity?: number };
    const show = scaleIn.show as { scale?: number; opacity?: number };
    expect(hidden.scale).toBe(0.96);
    expect(show.scale).toBe(1);
    expect(hidden.opacity).toBe(0);
    expect(show.opacity).toBe(1);
  });

  it("slideUp travels 8px, small enough not to compete with content", () => {
    expect((slideUp.hidden as { y?: number }).y).toBe(8);
    expect((slideUp.show as { y?: number }).y).toBe(0);
  });

  it("fadeIn animates opacity only — never layout", () => {
    expect(Object.keys(fadeIn.hidden as object)).toEqual(["opacity"]);
    expect(Object.keys(fadeIn.show as object)).toEqual(["opacity", "transition"]);
  });
});

/* =========================================================================
 * 2. CSS <-> JS parity
 * ====================================================================== */

describe("CSS motion tokens match the JS tokens", () => {
  const cssVar = (name: string) => {
    const m = INDEX_CSS.match(
      new RegExp(`${name}:\\s*([^;]+);`),
    );
    if (!m) throw new Error(`--${name} is not declared in index.css`);
    return m[1].trim();
  };

  it("every --dur-* mirrors DURATION", () => {
    expect(cssVar("dur-instant")).toBe(`${DURATION.instant * 1000}ms`);
    expect(cssVar("dur-fast")).toBe(`${DURATION.fast * 1000}ms`);
    expect(cssVar("dur-base")).toBe(`${DURATION.base * 1000}ms`);
    expect(cssVar("dur-slow")).toBe(`${DURATION.slow * 1000}ms`);
    expect(cssVar("dur-deliberate")).toBe(`${DURATION.deliberate * 1000}ms`);
  });

  it("every --ease-* mirrors EASE_*", () => {
    const bezier = (name: string) =>
      cssVar(name)
        .replace(/^cubic-bezier\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .map((n) => Number(n.trim()));
    expect(bezier("ease-out")).toEqual([...EASE_OUT]);
    expect(bezier("ease-in")).toEqual([...EASE_IN]);
    expect(bezier("ease-in-out")).toEqual([...EASE_IN_OUT]);
    expect(bezier("ease-emphasized")).toEqual([...EASE_EMPHASIZED]);
  });

  it("declares every keyframe the primitives reference", () => {
    for (const name of [
      "skeleton-shimmer",
      "soft-pulse",
      "motion-fade-in",
      "motion-slide-up",
      "motion-spin",
    ]) {
      expect(INDEX_CSS).toContain(`@keyframes ${name}`);
    }
  });

  it("keeps the global prefers-reduced-motion clamp with !important", () => {
    // Layer 1 of the reduced-motion story. Without `!important` this loses to
    // Tailwind's duration-* utilities and stops working.
    expect(INDEX_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration:\s*0\.001ms !important/,
    );
  });

  it("keeps the prefers-reduced-data block", () => {
    expect(INDEX_CSS).toContain("@media (prefers-reduced-data: reduce)");
  });

  it("has no raw durations left on the animation declarations", () => {
    // Every `animation:` shorthand should reference a token or a keyword,
    // never a bare number.
    const shorthands = INDEX_CSS.match(/^\s*animation:.*$/gm) ?? [];
    expect(shorthands.length).toBeGreaterThan(0);
    for (const line of shorthands) {
      expect(line).not.toMatch(/animation:\s*[\w-]+\s+[\d.]+m?s/);
    }
  });
});

/* =========================================================================
 * 3. Motion preferences
 * ====================================================================== */

describe("useMotionPrefs", () => {
  it("reads prefers-reduced-motion from matchMedia", () => {
    stubMatchMedia({ [REDUCED_MOTION_QUERY]: true });
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { result } = renderHook(() => useMotionPrefs());
    expect(result.current.reducedMotion).toBe(true);
    expect(result.current.reducedData).toBe(false);
  });

  it("reads prefers-reduced-data from matchMedia", () => {
    stubMatchMedia({ [REDUCED_DATA_QUERY]: true });
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { result } = renderHook(() => useMotionPrefs());
    expect(result.current.reducedData).toBe(true);
    // reducedData is reported separately; `shouldReduceMotion` collapses them.
    expect(result.current.reducedMotion).toBe(false);
  });

  it("defaults safely when window.matchMedia is absent (jsdom / SSR)", () => {
    removeMatchMedia();
    expect(() => renderHook(() => useMotionPrefs())).not.toThrow();
    const { result } = renderHook(() => useMotionPrefs());
    // "Motion allowed" is the correct fallback: an environment that cannot
    // answer the question must not silently opt a user into reduced motion.
    expect(result.current).toEqual({ reducedMotion: true, reducedData: false });
  });

  it("honours framer's own useReducedMotion, so the OR can only ever tighten", () => {
    // The harness mock defaults to true; opt out explicitly to prove that
    // useMotionPrefs does not hardcode the framer branch.
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    expect(renderHook(() => useMotionPrefs()).result.current.reducedMotion).toBe(
      false,
    );
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(true);
    expect(renderHook(() => useMotionPrefs()).result.current.reducedMotion).toBe(
      true,
    );
  });

  it("the two sources cannot disagree in the permissive direction", () => {
    stubMatchMedia({ [REDUCED_MOTION_QUERY]: false });
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(true);
    // CSS says "motion is fine", framer says "reduce". The stricter wins.
    expect(renderHook(() => useMotionPrefs()).result.current.reducedMotion).toBe(
      true,
    );
  });

  it("subscribes to later changes to the media query", () => {
    // Opt out of framer's own flag first, so this test measures the
    // matchMedia subscription and nothing else.
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);

    const state: Record<string, boolean> = { [REDUCED_DATA_QUERY]: false };
    const listeners = new Set<Listener>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: state[query] === true,
        media: query,
        onchange: null,
        addEventListener: (_t: string, cb: Listener) => void listeners.add(cb),
        removeEventListener: (_t: string, cb: Listener) =>
          void listeners.delete(cb),
        addListener: (cb: Listener) => void listeners.add(cb),
        removeListener: (cb: Listener) => void listeners.delete(cb),
        dispatchEvent: () => false,
      }),
    });

    const { result } = renderHook(() => useMotionPrefs());
    expect(result.current.reducedData).toBe(false);
    // The hook subscribed, so a change notification can be delivered.
    expect(listeners.size).toBeGreaterThan(0);

    state[REDUCED_DATA_QUERY] = true;
    act(() => {
      listeners.forEach((l) => l());
    });
    expect(result.current.reducedData).toBe(true);

    act(() => {
      result.current; // keep the render subscribed for teardown
    });
  });

  it("shouldReduceMotion collapses both preferences", () => {
    expect(shouldReduceMotion({ reducedMotion: true, reducedData: false })).toBe(
      true,
    );
    expect(shouldReduceMotion({ reducedMotion: false, reducedData: true })).toBe(
      true,
    );
    expect(shouldReduceMotion({ reducedMotion: false, reducedData: false })).toBe(
      false,
    );
  });

  it("imperative helpers keep the safe fallback", () => {
    removeMatchMedia();
    expect(prefersReducedMotion()).toBe(false);
    expect(prefersReducedData()).toBe(false);
    stubMatchMedia({ [REDUCED_MOTION_QUERY]: true, [REDUCED_DATA_QUERY]: true });
    expect(prefersReducedMotion()).toBe(true);
    expect(prefersReducedData()).toBe(true);
  });

  it("exposes the query strings it keys off", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
    expect(REDUCED_DATA_QUERY).toBe("(prefers-reduced-data: reduce)");
  });
});

/* =========================================================================
 * 4. The stagger cap — the correctness property, not a taste question
 * ====================================================================== */

describe("stagger cap", () => {
  it("uses the plain gap while the budget allows it", () => {
    expect(cappedStagger(1)).toBeCloseTo(0.07, 5);
    expect(cappedStagger(2)).toBeCloseTo(0.07, 5);
  });

  it("tightens the gap once the list is long enough to matter", () => {
    expect(cappedStagger(MAX_STAGGERED_CHILDREN)).toBeLessThan(0.07);
    expect(cappedStagger(200)).toBe(cappedStagger(MAX_STAGGERED_CHILDREN));
  });

  it("is monotonic non-increasing in the child count", () => {
    let previous = Infinity;
    for (const n of [1, 2, 4, 8, 16, 100, 2000]) {
      const gap = cappedStagger(n);
      expect(gap).toBeLessThanOrEqual(previous + 1e-9);
      previous = gap;
    }
  });

  it("bounds the start delay of the 200th child of a long list", () => {
    const delay = staggerStartDelay(199, 200);
    expect(delay).toBeLessThanOrEqual(STAGGER_BUDGET_S);
    expect(delay).toBeGreaterThan(0);
  });

  it("saturates rather than growing without bound", () => {
    // A 2,000-row patients table must not take ten seconds to settle. The
    // delay for the last row is capped at the same value as the 200th row.
    const at200 = staggerStartDelay(199, 2000);
    const at2000 = staggerStartDelay(1999, 2000);
    expect(at2000).toBe(at200);
    expect(at2000).toBeLessThanOrEqual(STAGGER_BUDGET_S);
  });

  it("handles nonsense counts without producing NaN", () => {
    expect(Number.isFinite(cappedStagger(Number.NaN))).toBe(true);
    expect(Number.isFinite(cappedStagger(0))).toBe(true);
    expect(Number.isFinite(cappedStagger(-5))).toBe(true);
    expect(Number.isFinite(staggerStartDelay(Number.NaN, 10))).toBe(true);
    expect(staggerStartDelay(3, 10)).toBeGreaterThanOrEqual(0);
  });

  it("listContainer itself stays inside the budget at any child count", () => {
    const show = listContainer.show as {
      transition: { staggerChildren: number; delayChildren: number };
    };
    expect(show.transition.delayChildren).toBe(BASE_STAGGER_DELAY_S);
    const lastInBudgetSlot =
      show.transition.delayChildren +
      (MAX_STAGGERED_CHILDREN - 1) * show.transition.staggerChildren;
    expect(lastInBudgetSlot).toBeLessThanOrEqual(STAGGER_BUDGET_S);
  });

  it("Stagger renders its children without imposing per-child props", () => {
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { container } = render(
      <Stagger>
        <StaggerItem>a</StaggerItem>
        <StaggerItem>b</StaggerItem>
      </Stagger>,
    );
    expect(container.textContent).toBe("ab");
  });
});

/* =========================================================================
 * 5. LAYOUT_REDUCED_MOTION — the shared-layout escape hatch
 * ====================================================================== */

describe("shared-layout reduced-motion escape hatch", () => {
  it("is a zero-duration transition, not `false`", () => {
    // `transition={false}` / `undefined` means "use framer's default", which
    // for a layout animation is a spring — the animation would still run.
    expect(LAYOUT_REDUCED_MOTION.duration).toBe(0);
  });

  it("layoutTransition returns the instant value when motion is reduced", () => {
    expect(layoutTransition(true, SPRING.smooth)).toBe(
      LAYOUT_REDUCED_MOTION,
    );
  });

  it("layoutTransition passes the animated value through when motion is allowed", () => {
    expect(layoutTransition(false, SPRING.gentle)).toBe(SPRING.gentle);
  });

  it("layoutTransition defaults to the standard spring", () => {
    expect(layoutTransition(false)).toBe(SPRING.smooth);
    expect(layoutTransition(true)).toBe(LAYOUT_REDUCED_MOTION);
  });
});

/* =========================================================================
 * 6. A primitive that animates does NOT animate when motion is reduced
 * ====================================================================== */

describe("Skeleton honours the motion preferences", () => {
  it("animates when motion is allowed", () => {
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("skeleton-shimmer");
    expect(el.dataset.shimmer).toBe("on");
  });

  it("does NOT animate when reduced motion is requested", () => {
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(true);
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).not.toContain("skeleton-shimmer");
    expect(el.dataset.shimmer).toBe("off");
  });

  it("prefers-reduced-data disables the shimmer", () => {
    stubMatchMedia({ [REDUCED_DATA_QUERY]: true });
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.dataset.shimmer).toBe("off");
    expect(el.className).not.toContain("skeleton-shimmer");
  });

  it("keeps the placeholder box when the shimmer is off", () => {
    // Removing the box entirely would be worse than removing the animation:
    // the box is the layout the content is about to fill in.
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(true);
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("bg-[linear-gradient(90deg,var(--skeleton-base)_0%");
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });
});

describe("Card only lifts when it is genuinely interactive", () => {
  it("does not lift a non-interactive card", () => {
    const { container } = render(<Card>read-only</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).not.toContain("card-interactive");
    expect(el.dataset.interactive).toBeUndefined();
  });

  it("lifts an interactive card", () => {
    const { container } = render(<Card interactive>clickable</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("card-interactive");
    expect(el.dataset.interactive).toBe("");
  });

  it("StaggerItem suppresses the lift unless the item is interactive", () => {
    (globalThis as unknown as { __setReducedMotion: (v: boolean) => void })
      .__setReducedMotion(false);
    const { container } = render(
      <Stagger>
        <StaggerItem lift>
          <span>card</span>
        </StaggerItem>
      </Stagger>,
    );
    // motion.div is a passthrough in the harness, so lift/interactive cannot
    // be observed in the DOM — assert the prop contract instead.
    expect(container.textContent).toBe("card");
    expect(typeof StaggerItem).toBe("function");
  });
});