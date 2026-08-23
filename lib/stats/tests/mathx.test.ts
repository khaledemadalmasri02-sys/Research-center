import test from "node:test";
import assert from "node:assert/strict";
import { normalCdf, studentTCdf, studentTInv, fCdf, chiSquareCdf } from "../src/mathx.ts";

test("normalCdf symmetric and key values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalCdf(-1.959964) - 0.025) < 1e-4);
});

test("studentTInv inverts studentTCdf", () => {
  const t = studentTInv(0.975, 10);
  assert.ok(Math.abs(t - 2.228) < 1e-2);
  assert.ok(Math.abs(studentTCdf(t, 10) - 0.975) < 1e-6);
  assert.ok(Math.abs(studentTCdf(0, 5) - 0.5) < 1e-9);
});

test("chiSquareCdf matches erf for df=1", () => {
  // chi-square df=1 CDF(x) = erf(sqrt(x/2))
  const x = 3.841;
  const expected = Math.abs(chiSquareCdf(x, 1) - 0.95) < 1e-3;
  assert.ok(expected);
});

test("fCdf boundaries", () => {
  assert.equal(fCdf(0, 2, 12), 0);
  assert.ok(fCdf(100, 2, 12) > 0.99);
});
