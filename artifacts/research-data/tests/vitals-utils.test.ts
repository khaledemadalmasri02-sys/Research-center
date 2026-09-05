// P2.1 — tests for lib/vitals-utils.ts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVitals,
  serializeVitals,
  VITAL_DEFS,
  type VitalFields,
} from "../src/lib/vitals-utils.ts";

test("parseVitals: null / undefined / empty input yields blank fields", () => {
  for (const empty of [null, undefined, ""]) {
    const out = parseVitals(empty as never);
    assert.deepEqual(out, { BP: "", RR: "", Temp: "", HR: "", O2: "" });
  }
});

test("parseVitals: single field", () => {
  const out = parseVitals("HR: 80");
  assert.equal(out.HR, "80");
  assert.equal(out.BP, "");
  assert.equal(out.RR, "");
  assert.equal(out.Temp, "");
  assert.equal(out.O2, "");
});

test("parseVitals: multiple fields, trimmed", () => {
  const out = parseVitals("  BP: 120/80  | HR : 72 | O2: 98%  ");
  assert.equal(out.BP, "120/80");
  assert.equal(out.HR, "72");
  assert.equal(out.O2, "98%");
});

test("parseVitals: ignores unknown keys", () => {
  // Glucose isn't a vital; it should be silently ignored.
  const out = parseVitals("BP: 120/80 | Gluc: 95 | HR: 80");
  assert.equal(out.BP, "120/80");
  assert.equal(out.HR, "80");
  // Gluc not in VitalFields, no leak.
  assert.equal(out.O2, "");
});

test("parseVitals: handles missing colon as no-op", () => {
  const out = parseVitals("BP 120/80");
  // No colon → no value extracted for BP. Other fields still empty.
  assert.equal(out.BP, "");
});

test("serializeVitals: round-trip identity", () => {
  const v: VitalFields = { BP: "120/80", RR: "18", Temp: "37.0", HR: "80", O2: "98" };
  const serialized = serializeVitals(v);
  const reparsed = parseVitals(serialized);
  assert.deepEqual(reparsed, v);
});

test("serializeVitals: skips blank fields", () => {
  const v: VitalFields = { BP: "120/80", RR: "", Temp: "", HR: "80", O2: "" };
  const s = serializeVitals(v);
  // Only BP and HR are non-empty, so output should be just those.
  assert.equal(s, "BP: 120/80 | HR: 80");
});

test("serializeVitals: empty -> empty string", () => {
  const v: VitalFields = { BP: "", RR: "", Temp: "", HR: "", O2: "" };
  assert.equal(serializeVitals(v), "");
});

test("VITAL_DEFS has all five fields, each with a non-empty unit", () => {
  assert.equal(VITAL_DEFS.length, 5);
  for (const def of VITAL_DEFS) {
    assert.ok(def.label.length > 0, `label missing for ${def.key}`);
    assert.ok(def.placeholder.length > 0, `placeholder missing for ${def.key}`);
    assert.ok(def.unit.length > 0, `unit missing for ${def.key}`);
  }
  // The five canonical vitals are present.
  const keys = VITAL_DEFS.map((d) => d.key).sort();
  assert.deepEqual(keys, ["BP", "HR", "O2", "RR", "Temp"]);
});
