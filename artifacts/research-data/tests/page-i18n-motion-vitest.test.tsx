import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";

import { en } from "../src/i18n/en";
import { ar } from "../src/i18n/ar";
import {
  MAX_STAGGERED_CHILDREN,
  STAGGER_BUDGET_S,
  cappedStagger,
  staggerStartDelay,
} from "../src/lib/motion";
import { CrossFade, useChartAnimation } from "@/lib/page-motion";

const SRC = join(process.cwd(), "src");

/* ========================================================================== *
 * 1. i18n bundle parity — the invariant the whole app leans on.
 * ========================================================================== */

function leaves(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("i18n bundle parity (en <-> ar)", () => {
  const enKeys = new Set(leaves((en as { translation: unknown }).translation));
  const arKeys = new Set(leaves((ar as { translation: unknown }).translation));

  it("defines an identical key set in both locales", () => {
    const onlyEn = [...enKeys].filter((k) => !arKeys.has(k)).sort();
    const onlyAr = [...arKeys].filter((k) => !enKeys.has(k)).sort();
    expect({ onlyEn, onlyAr }).toEqual({ onlyEn: [], onlyAr: [] });
  });

  it("keeps every leaf key non-empty in both locales", () => {
    const get = (bundle: unknown, key: string) =>
      key.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], bundle);
    const empty = [...enKeys].filter((k) => {
      const a = get((ar as { translation: unknown }).translation, k);
      const e = get((en as { translation: unknown }).translation, k);
      return (
        typeof a !== "string" ||
        a.trim() === "" ||
        typeof e !== "string" ||
        e.trim() === ""
      );
    });
    expect(empty).toEqual([]);
  });
});

/* ========================================================================== *
 * 2. The stagger cap. This is the property that keeps a 2,000-row patient
 *    list from spending ten seconds settling.
 * ========================================================================== */

describe("stagger cap", () => {
  it("saturates the per-child gap at the cap, whatever the list length", () => {
    // Short list: the gap is the budget divided by the item count.
    expect(cappedStagger(3)).toBeCloseTo(STAGGER_BUDGET_S / 3, 5);
    // Long list: the gap shrinks so the whole cascade still fits the budget.
    const gap = cappedStagger(2000);
    expect(gap).toBeLessThan(0.07);
    expect(MAX_STAGGERED_CHILDREN * gap).toBeLessThanOrEqual(STAGGER_BUDGET_S + 1e-9);
  });

  it("keeps the last animated item's start delay inside the budget for a long list", () => {
    // This is the case my pages hit: an unknown-length list, reported as many.
    for (const count of [8, 50, 500, 2000, 100000]) {
      expect(staggerStartDelay(MAX_STAGGERED_CHILDREN - 1, count)).toBeLessThanOrEqual(
        STAGGER_BUDGET_S + 1e-9,
      );
    }
  });

  /**
   * REGRESSION GUARD — this assertion was `it.fails` while the defect was live.
   *
   * The bug: `staggerStartDelay` clamped `slot` to `MAX - 1` (correct, because
   * `React.Children.count` under-reports — a fragment or a `.map()` counts as
   * one child) but took the *gap* from the reported count. The two disagreed, and
   * the smaller the reported count the worse the overrun:
   *
   *     count 3 -> gap min(0.07, 0.2/3) = 0.0667, slot 7 -> 0.487s  (2.4x)
   *
   * Fixed by deriving the gap from the same cap the slot is clamped to, so the
   * product is bounded for any input. The low counts are kept in the list
   * because they are exactly the inputs that used to fail.
   */
  it("keeps the start delay inside the budget for every reported child count", () => {
    for (const count of [1, 2, 3, 5, 8, 9, 40, 2000]) {
      expect(staggerStartDelay(MAX_STAGGERED_CHILDREN - 1, count)).toBeLessThanOrEqual(
        STAGGER_BUDGET_S + 1e-9,
      );
    }
    // The reported count must not change the answer at all — that coupling was
    // the defect, so assert the invariance rather than just the bound.
    const atCap = staggerStartDelay(MAX_STAGGERED_CHILDREN - 1, 2000);
    expect(staggerStartDelay(MAX_STAGGERED_CHILDREN - 1, 1)).toBe(atCap);
  });

  it("never keeps growing the delay past the cap, however deep the index", () => {
    const atCap = staggerStartDelay(MAX_STAGGERED_CHILDREN - 1, 2000);
    expect(staggerStartDelay(500, 2000)).toBe(atCap);
    expect(staggerStartDelay(1999, 2000)).toBe(atCap);
  });

  it("treats a non-finite count as a single child rather than producing NaN", () => {
    expect(Number.isFinite(cappedStagger(Number.NaN))).toBe(true);
    expect(Number.isFinite(staggerStartDelay(Number.NaN, 10))).toBe(true);
  });
});

/* ========================================================================== *
 * 3. CrossFade — content must be present on the first paint whether or not
 *    the skeleton is showing, so a cross-fade can never delay data.
 * ========================================================================== */

describe("CrossFade", () => {
  it("renders the real content even while the skeleton is visible", () => {
    render(
      <CrossFade loading skeleton={<div>s loading</div>}>
        <div>real result</div>
      </CrossFade>,
    );
    // The point of the assertion: the data is in the DOM from the start, not
    // mounted after a delay.
    expect(screen.getByText("real result")).toBeTruthy();
  });

  it("hides the skeleton from assistive tech once loading finishes", () => {
    const { container } = render(
      <CrossFade loading={false} skeleton={<div>skeleton</div>}>
        <div>content</div>
      </CrossFade>,
    );
    const skeletonLayer = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(skeletonLayer.getAttribute("aria-hidden")).toBe("true");
    expect(skeletonLayer.className).toContain("absolute");
  });
});

/* ========================================================================== *
 * 4. Chart animation is off under reduced motion.
 *
 *    `tests/vitest.setup.tsx` makes `useReducedMotion()` default to true, so
 *    the default render here IS the reduced-motion path — which is exactly the
 *    one worth asserting, because recharts would otherwise animate regardless.
 * ========================================================================== */

describe("useChartAnimation", () => {
  it("disables recharts animation when motion is reduced", () => {
    function Probe() {
      const chart = useChartAnimation();
      return <span data-testid="v">{String(chart.isAnimationActive)}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId("v").textContent).toBe("false");
  });
});

/* ========================================================================== *
 * 5. Every user-facing `<Label>` in the pages we own is programmatically
 *    associated with a control. A `<Label>` with no `htmlFor` and no `id`
 *    target announces as an orphaned label and leaves its control unnamed.
 * ========================================================================== */

const OWNED_LABEL_FILES = [
  "pages/ml.tsx",
  "pages/validation.tsx",
  "pages/record-definition-edit.tsx",
  "pages/data-analysis/AnalysisBuilder.tsx",
  "pages/data-analysis/VariableSelect.tsx",
  "pages/data-analysis/LandingView.tsx",
];

describe("form labels are associated with their controls", () => {
  for (const rel of OWNED_LABEL_FILES) {
    it(`${rel} has no orphaned <Label>`, () => {
      const src = readFileSync(join(SRC, rel), "utf8");
      // Comments are stripped first: several of these files *document* the
      // `<Label>`-without-`htmlFor` bug they fixed, and matching inside a
      // comment would report a defect that is not in the rendered output.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const orphans = [...code.matchAll(/<Label(?![^>]*\bhtmlFor=)[^>]*>/g)];
      expect(
        orphans.map((m) => m[0]),
        `orphaned <Label> in ${rel}`,
      ).toEqual([]);
    });
  }
});
