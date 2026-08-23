import test from "node:test";
import assert from "node:assert/strict";
import { Dataset, tabularFromArrays } from "../src/index.ts";
import { runAnalysis } from "../src/index.ts";
import type { TabularData } from "../src/index.ts";

function dsFromNumbers(headers: string[], rows: number[][]): Dataset {
  const data: TabularData = {
    variables: headers.map((h) => ({ name: h, dataType: "numeric", measure: "scale" })),
    rows: rows.map((r) => [...r]),
  };
  return new Dataset(data);
}

test("descriptive statistics", () => {
  const ds = dsFromNumbers(["x"], [[1], [2], [3], [4], [5]]);
  const res = runAnalysis(ds, "descriptive", { variable: "x" });
  assert.equal(res.stats.mean, 3);
  assert.equal(res.stats.median, 3);
  assert.equal(res.stats.validN, 5);
  assert.ok(Math.abs((res.stats.stdDev as number) - Math.sqrt(2.5)) < 1e-9);
});

test("independent Welch t-test (symmetric groups)", () => {
  const a = [1, 2, 3, 4, 5];
  const b = [2, 3, 4, 5, 6];
  const ds = dsFromNumbers(["g1", "g2"], a.map((v, i) => [v, b[i]]));
  const res = runAnalysis(ds, "ttest", {
    mode: "independent",
    variableA: "g1",
    variableB: "g2",
  });
  assert.ok(Math.abs((res.stats.t as number) - -1) < 1e-9);
  assert.ok(Math.abs((res.stats.df as number) - 8) < 1e-9);
  const p = res.stats.p as number;
  assert.ok(p > 0.33 && p < 0.35, `p=${p}`);
});

test("paired t-test", () => {
  const before = [10, 12, 14, 11, 13];
  const after = [14, 15, 18, 15, 16];
  const ds = dsFromNumbers(["before", "after"], before.map((v, i) => [v, after[i]]));
  const res = runAnalysis(ds, "ttest", {
    mode: "paired",
    pairedA: "before",
    pairedB: "after",
  });
  assert.equal(res.stats.method, "Paired");
  assert.ok((res.stats.p as number) < 0.05);
});

test("ANOVA with identical group means -> F ~ 0", async () => {
  const groups = new Map([
    ["A", [1, 2, 3]],
    ["B", [1, 2, 3]],
    ["C", [1, 2, 3]],
  ]);
  const { oneWayAnova } = await import("../src/tests/anova.ts");
  const res = oneWayAnova(groups);
  assert.ok((res.stats.F as number) < 1e-9);
  assert.ok(Math.abs((res.stats.p as number) - 1) < 1e-6);
});

test("ANOVA detects group differences", () => {
  const data: TabularData = {
    variables: [
      { name: "score", dataType: "numeric", measure: "scale" },
      { name: "grp", dataType: "string", measure: "nominal" },
    ],
    rows: [
      [2, "A"], [3, "A"], [4, "A"],
      [10, "B"], [11, "B"], [12, "B"],
    ],
  };
  const res = runAnalysis(new Dataset(data), "anova", { dependent: "score", group: "grp" });
  assert.ok((res.stats.F as number) > 50);
  assert.ok((res.stats.p as number) < 0.001);
});

test("chi-square 2x2 hand-computed", async () => {
  const obs = [
    [10, 20],
    [20, 10],
  ];
  const { chiSquareTest } = await import("../src/tests/chisquare.ts");
  const res = chiSquareTest(obs);
  assert.ok(Math.abs((res.stats.chiSquare as number) - 100 / 15) < 1e-3);
  const p = res.stats.p as number;
  assert.ok(p > 0.005 && p < 0.02, `p=${p}`);
});

test("correlation perfect linear", () => {
  const data: TabularData = {
    variables: [
      { name: "x", dataType: "numeric", measure: "scale" },
      { name: "y", dataType: "numeric", measure: "scale" },
    ],
    rows: [[1, 2], [2, 4], [3, 6], [4, 8]],
  };
  const res = runAnalysis(new Dataset(data), "correlation", {
    method: "pearson",
    variables: ["x", "y"],
  });
  assert.ok(Math.abs((res.stats.n as number) - 4) === 0 || res.tables.length > 0);
  const r = res.tables[0].rows[1][2] as string;
  assert.ok(r.startsWith("1"), `r=${r}`);
});

test("regression y = 2x + 1", () => {
  const data: TabularData = {
    variables: [
      { name: "x", dataType: "numeric", measure: "scale" },
      { name: "y", dataType: "numeric", measure: "scale" },
    ],
    rows: [[1, 3], [2, 5], [3, 7]],
  };
  const res = runAnalysis(new Dataset(data), "regression", {
    dependent: "y",
    independent: ["x"],
  });
  const intercept = res.stats; // coefficients in table
  const coefTable = res.tables[1];
  const interceptRow = coefTable.rows.find((r) => r[0] === "(Intercept)")!;
  const xRow = coefTable.rows.find((r) => r[0] === "x")!;
  assert.ok(Math.abs((interceptRow[1] as number) - 1) < 1e-9);
  assert.ok(Math.abs((xRow[1] as number) - 2) < 1e-9);
  assert.ok(Math.abs((res.stats.rSquared as number) - 1) < 1e-9);
});
