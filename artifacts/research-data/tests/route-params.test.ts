// Tests for src/lib/route-params.ts (pure logic, runs under `node --test`).

// Assertions stay on node:assert/strict so the expected values are
// unchanged; only the runner moved to vitest.
import { test } from "vitest";
import assert from "node:assert/strict";
import { routeSegments, extractIdFromRoute } from "../src/lib/route-params.ts";

test("routeSegments", () => {
  assert.deepEqual(routeSegments(undefined), []);
  assert.deepEqual(routeSegments(""), []);
  assert.deepEqual(routeSegments("/patients/133"), ["patients", "133"]);
  assert.deepEqual(routeSegments("/patients/133/edit"), ["patients", "133", "edit"]);
  assert.deepEqual(routeSegments("/records/5/133"), ["records", "5", "133"]);
  // leading/trailing/multiple slashes are collapsed, empty segments dropped
  assert.deepEqual(routeSegments("///patients/133/"), ["patients", "133"]);
});

test("extractIdFromRoute resolves a patient id from a view or edit route", () => {
  assert.equal(extractIdFromRoute(undefined), undefined);
  assert.equal(extractIdFromRoute("/patients/133"), "133");
  assert.equal(extractIdFromRoute("/patients/133/edit"), "133");
  // non-patient routes are ignored
  assert.equal(extractIdFromRoute("/records/5/133"), undefined);
  assert.equal(extractIdFromRoute("/patients/"), undefined);
});
