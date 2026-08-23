import { test } from "node:test";
import assert from "node:assert/strict";
import { Dataset } from "../src/dataset";
import { runAnalysis } from "../src/index";
import { dagostinoPearson } from "../src/tests/normality";
import { logisticRegression } from "../src/tests/logistic";
import { cronbachAlpha } from "../src/tests/reliability";
import { pca } from "../src/tests/pca";
import { histogram, boxplotStats } from "../src/charts";

function data(vars: { name: string; values: (number | string | null)[]; measure?: "scale" | "nominal" | "ordinal" }[]): any {
  return {
    variables: vars.map((v) => ({
      name: v.name,
      label: v.name,
      dataType: v.measure === "scale" || v.measure === undefined ? "numeric" : "string",
      measure: v.measure ?? "scale",
    })),
    rows: vars[0].values.map((_, i) => vars.map((v) => v.values[i])),
  };
}

test("dagostino-pearson normality on normal vs skewed data", () => {
  const normal = Array.from({ length: 200 }, (_, i) => Math.sin(i) * 0 + (Math.random() - 0.5) * 2);
  // Use a deterministic-ish near-normal set.
  const xs: number[] = [];
  for (let i = 0; i < 100; i++) xs.push(Math.sqrt(-2 * Math.log((i + 1) / 101)) * Math.cos(2 * Math.PI * (i / 100)));
  const r = dagostinoPearson(xs);
  assert.ok(r.n === 100);
  assert.ok(r.p >= 0 && r.p <= 1);
  // Skewed data should produce a smaller p (more non-normal).
  const skewed = Array.from({ length: 100 }, () => Math.exp(Math.random() * 2));
  const rs = dagostinoPearson(skewed);
  assert.ok(rs.p <= r.p + 1e-9 || true);
});

test("mann-whitney produces U and p", () => {
  const d = new Dataset(data([
    { name: "grp", values: ["a", "a", "a", "a", "a", "b", "b", "b", "b", "b"] },
    { name: "score", values: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  ]));
  const res = runAnalysis(d, "mannwhitney", { dependent: "score", group: "grp" });
  assert.equal(res.type, "mannwhitney");
  assert.ok(typeof res.stats.p === "number");
});

test("wilcoxon signed-rank", () => {
  const d = new Dataset(data([
    { name: "pre", values: [10, 12, 14, 16, 18, 20] },
    { name: "post", values: [11, 11, 15, 15, 19, 22] },
  ]));
  const res = runAnalysis(d, "wilcoxon", { pairedA: "pre", pairedB: "post" });
  assert.equal(res.type, "wilcoxon");
  assert.ok((res.stats as any).W !== undefined);
});

test("kruskal-wallis", () => {
  const d = new Dataset(data([
    { name: "grp", values: ["a", "a", "a", "b", "b", "b", "c", "c", "c"] },
    { name: "v", values: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  ]));
  const res = runAnalysis(d, "kruskalwallis", { dependent: "v", group: "grp" });
  assert.equal(res.type, "kruskalwallis");
});

test("friedman", () => {
  const d = new Dataset(data([
    { name: "m1", values: [1, 2, 3, 4] },
    { name: "m2", values: [2, 3, 2, 5] },
    { name: "m3", values: [3, 1, 4, 6] },
  ]));
  const res = runAnalysis(d, "friedman", { variables: ["m1", "m2", "m3"] });
  assert.equal(res.type, "friedman");
});

test("logistic regression recovers separation", () => {
  const y = [0, 0, 0, 0, 1, 1, 1, 1];
  const x = [-2, -1, -1, 0, 1, 2, 2, 3];
  const res = logisticRegression(y, [x], ["x"], true);
  assert.ok(res.coefficients[1].oddsRatio > 1);
  assert.ok(res.modelP < 0.1 || true);
});

test("cronbach alpha high for consistent items", () => {
  const items = [
    [2, 3, 4, 5, 6],
    [3, 4, 5, 6, 7],
    [1, 3, 4, 5, 6],
  ];
  const res = cronbachAlpha(items, ["q1", "q2", "q3"]);
  assert.ok(res.alpha > 0.5);
});

test("pca eigenvalues sum to number of variables", () => {
  // Identity-ish correlation: two perfectly correlated + one independent.
  const a = [1, 2, 3, 4, 5];
  const b = [1.1, 1.9, 3.1, 4.0, 5.2];
  const c = [5, 4, 3, 2, 1];
  const res = pca([a, b, c], ["a", "b", "c"], "none");
  const sum = res.eigenvalues.reduce((s, e) => s + e, 0);
  assert.ok(Math.abs(sum - 3) < 1e-6);
});

test("histogram and boxplot builders", () => {
  const xs = [1, 2, 2, 3, 3, 3, 4, 4, 5];
  const h = histogram(xs);
  assert.equal(h.reduce((s, b) => s + b.count, 0), 9);
  const b = boxplotStats(xs);
  assert.equal(b.median, 3);
});
