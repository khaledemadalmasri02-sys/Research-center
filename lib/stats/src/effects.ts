/**
 * Effect sizes and confidence intervals for the statistics engine.
 * These mirror the reporting conventions of SPSS / R (e.g. `effectsize`).
 */
import { normalInv } from "./mathx";
import { round } from "./describe";

export interface EffectCI {
  estimate: number;
  ciLow: number;
  ciHigh: number;
}

/** Cohen's d (pooled) with Hedges correction and an approximate CI. */
export function cohensD(
  a: number[],
  b: number[],
  alpha = 0.05,
  hedges = true,
): EffectCI {
  const na = a.length;
  const nb = b.length;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  if (sp === 0) return { estimate: 0, ciLow: 0, ciHigh: 0 };
  const d = (ma - mb) / sp;
  // Approximate CI (Hedges & Olkin).
  const se = Math.sqrt((na + nb) / (na * nb) + (d * d) / (2 * (na + nb)));
  const z = normalInv(1 - alpha / 2);
  let est = d;
  if (hedges) {
    const corr = 1 - 3 / (4 * (na + nb) - 9);
    est = d * corr;
  }
  return {
    estimate: round(est),
    ciLow: round(est - z * se * (hedges ? 1 : 1)),
    ciHigh: round(est + z * se * (hedges ? 1 : 1)),
  };
}

/** Eta-squared and omega-squared from an ANOVA. */
export function anovaEffect(
  ssBetween: number,
  ssWithin: number,
  ssTotal: number,
  k: number,
  n: number,
  dfWithin: number,
): { etaSquared: number; omegaSquared: number } {
  const etaSquared = ssTotal > 0 ? ssBetween / ssTotal : 0;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const omegaSquared =
    ssTotal + msWithin > 0
      ? (ssBetween - (k - 1) * msWithin) / (ssTotal + msWithin)
      : 0;
  return { etaSquared: round(etaSquared), omegaSquared: round(Math.max(omegaSquared, 0)) };
}

/** Phi coefficient for a 2x2 table (also returned as an absolute measure). */
export function phiCoefficient(table: number[][]): number {
  if (table.length < 2 || table[0].length < 2) return 0;
  const [a, b] = table[0];
  const [c, d] = table[1];
  const den = (a + b) * (c + d) * (a + c) * (b + d);
  if (den <= 0) return 0;
  return round((a * d - b * c) / Math.sqrt(den));
}

/** Cramér's V for an r x c contingency table. */
export function cramersV(table: number[][]): number {
  const r = table.length;
  const c = table[0]?.length ?? 0;
  let n = 0;
  let chi2 = 0;
  const colSum: number[] = new Array(c).fill(0);
  const rowSum: number[] = new Array(r).fill(0);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      n += table[i][j];
      rowSum[i] += table[i][j];
      colSum[j] += table[i][j];
    }
  if (n === 0) return 0;
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      const expected = (rowSum[i] * colSum[j]) / n;
      if (expected > 0) chi2 += (table[i][j] - expected) ** 2 / expected;
    }
  const minDim = Math.min(r, c) - 1;
  if (minDim <= 0) return 0;
  return round(Math.sqrt(chi2 / (n * minDim)));
}

/** Fisher-z confidence interval for a Pearson correlation. */
export function correlationCI(r: number, n: number, alpha = 0.05): EffectCI {
  if (n <= 3) return { estimate: round(r), ciLow: NaN, ciHigh: NaN };
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const se = 1 / Math.sqrt(n - 3);
  const zc = normalInv(1 - alpha / 2);
  const lo = z - zc * se;
  const hi = z + zc * se;
  const toR = (z: number) => (Math.exp(2 * z) - 1) / (Math.exp(2 * z) + 1);
  return { estimate: round(r), ciLow: round(toR(lo)), ciHigh: round(toR(hi)) };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function variance(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
}
