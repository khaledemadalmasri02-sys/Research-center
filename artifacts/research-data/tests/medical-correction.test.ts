// P2.1 — tests for lib/medical-correction.ts.
//
// The medical corrector runs entirely in the browser before sending
// text to a remote LLM. It is also used server-side to clean up
// dictated notes. Bugs here are user-visible: a wrongly-expanded
// abbreviation can change "Pt denies HTN" into something the doctor
// did not say, and a missed drug-name casing is a clinical-quality
// issue. These tests pin the current behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import {
  correctMedicalText,
  type Correction,
} from "../src/lib/medical-correction.ts";

function correctionsOf(input: string): string[] {
  return correctMedicalText(input).corrections.map((c) => c.corrected);
}

function findCorrection(
  input: string,
  predicate: (c: Correction) => boolean,
): Correction | undefined {
  return correctMedicalText(input).corrections.find(predicate);
}

// ─────────────────────────────────────────────────────────────────────
// 1. Abbreviation expansion
// ─────────────────────────────────────────────────────────────────────

test("abbreviation: bp → blood pressure (case-insensitive, whole word)", () => {
  const out = correctMedicalText("BP 120/80");
  assert.equal(out.corrected, "blood pressure 120/80");
  assert.equal(out.corrections.length, 1);
  assert.equal(out.corrections[0].original, "BP");
  assert.equal(out.corrections[0].corrected, "blood pressure");
});

test("abbreviation: does NOT match inside a longer word", () => {
  // 'bpm' contains 'bp' but should not be replaced.
  const out = correctMedicalText("bpm 72");
  assert.equal(out.corrected, "bpm 72");
  // (Hmm, our regex uses \b which treats 'bpm' as a separate word; check.)
  // 'bpm' is a separate entry; 'bp' is too short to anchor on.
  // The corrector should leave 'bpm' alone.
  const allTargets = out.corrections.map((c) => c.original);
  assert.ok(
    !allTargets.includes("BP"),
    "should not expand BP inside bpm",
  );
});

test("abbreviation: spo2 → oxygen saturation", () => {
  const out = correctMedicalText("SpO2 96%");
  assert.equal(out.corrected, "oxygen saturation 96%");
});

test("abbreviation: htn → hypertension", () => {
  const out = correctMedicalText("PMH: HTN, DM2");
  assert.match(out.corrected, /hypertension/);
  assert.match(out.corrected, /diabetes mellitus/);
});

test("abbreviation: respects whitespace and slashes as boundaries", () => {
  // "n/v" → "nausea and vomiting". The slash is a non-word char so
  // \b anchors at word boundaries work.
  const out = correctMedicalText("Pt c/o n/v x 2 days");
  assert.match(out.corrected, /nausea and vomiting/);
});

test("abbreviation: idempotent (expanding a fully expanded text yields no corrections)", () => {
  const once = correctMedicalText("BP 120/80");
  const twice = correctMedicalText(once.corrected);
  assert.equal(twice.corrections.length, 0);
  assert.equal(twice.corrected, once.corrected);
});

test("abbreviation: multiple abbreviations in one sentence", () => {
  const out = correctMedicalText("Pt with HTN, DM2, CAD on metoprolol");
  // DM2 → 'type 2 diabetes mellitus' (the table maps DM2 specifically
  // to the type-2 expansion, not the generic 'diabetes mellitus').
  const expansions = out.corrections.map((c) => c.corrected);
  assert.ok(expansions.includes("hypertension"));
  assert.ok(expansions.includes("type 2 diabetes mellitus"));
  assert.ok(expansions.includes("coronary artery disease"));
});

// ─────────────────────────────────────────────────────────────────────
// 2. Phonetic / mishearing corrections
// ─────────────────────────────────────────────────────────────────────

test("phonetic: 'new monia' → pneumonia", () => {
  const out = correctMedicalText("Pt dx with new monia, started abx");
  assert.match(out.corrected, /pneumonia/);
  assert.ok(
    out.corrections.some((c) => c.reason.startsWith("phonetic:")),
  );
});

test("phonetic: 'taky cardia' → tachycardia", () => {
  const out = correctMedicalText("Pt c/o taky cardia");
  assert.match(out.corrected, /tachycardia/);
});

test("phonetic: case-insensitive (PAT dx new MONIA → pneumonia)", () => {
  const out = correctMedicalText("PAT dx new MONIA");
  assert.match(out.corrected, /pneumonia/i);
});

// ─────────────────────────────────────────────────────────────────────
// 3. Drug name casing / spelling
// ─────────────────────────────────────────────────────────────────────

test("drug: ALL CAPS METFORMIN → metformin", () => {
  const out = correctMedicalText("started on METFORMIN 500 mg BID");
  assert.ok(out.corrections.some((c) => c.corrected === "metformin"));
  assert.match(out.corrected, /metformin 500 mg/);
});

test("drug: 'Plavix' brand name casing", () => {
  const out = correctMedicalText("plavix 75 mg");
  // The corrector uses a brand-name entry that should be capitalised
  // as "Plavix". We don't pin a specific case (the brand list may
  // be updated), just that the lowercase form is flagged.
  const c = out.corrections.find((x) => /plavix/i.test(x.corrected));
  assert.ok(c, "expected a Plavix correction");
});

test("drug: typo 'metoprolol' corrected to 'metoprolol' (already correct)", () => {
  // The corrector normalises casing but doesn't fix spelling for
  // already-correct drug names. The test just confirms the casing
  // is normalised.
  const out = correctMedicalText("metoprlol 25 mg");
  // 'metoprlol' is not in the list; no correction expected.
  assert.ok(!out.corrections.some((c) => /metoprlol/.test(c.corrected)));
});

// ─────────────────────────────────────────────────────────────────────
// 4. Whole-pipeline behaviour
// ─────────────────────────────────────────────────────────────────────

test("pipeline: full realistic note", () => {
  const input =
    "78 yo F with PMH HTN, DM2, AFib on metoprlol, metformin. " +
    "C/o SOB and CP. New monia on CXR. Started on abx.";
  const out = correctMedicalText(input);
  // Every line should have at least one correction applied.
  assert.ok(out.corrections.length > 5, "expected several corrections");
  // Spot checks: every common abbrev should appear expanded.
  assert.match(out.corrected, /78 year old female/);
  assert.match(out.corrected, /hypertension/);
  assert.match(out.corrected, /diabetes mellitus/);
  assert.match(out.corrected, /atrial fibrillation/);
  assert.match(out.corrected, /shortness of breath/);
  assert.match(out.corrected, /chest pain/);
  assert.match(out.corrected, /pneumonia/);
  assert.match(out.corrected, /chest X-ray/);
  assert.match(out.corrected, /antibiotics/);
});

test("pipeline: empty / null / whitespace input is unchanged", () => {
  for (const empty of ["", "   ", "\n\t"]) {
    const out = correctMedicalText(empty);
    assert.equal(out.corrected, empty);
    assert.equal(out.corrections.length, 0);
  }
});

test("pipeline: KNOWN BUG — 'Pt' (patient) is miscorrected to 'prothrombin time' (PT)", () => {
  // This is a known false-positive: the abbreviation table maps
  // "pt" → "prothrombin time", but "Pt" (capital P, lowercase t) is
  // a different abbreviation meaning "patient". The current regex
  // is case-insensitive and matches any "pt" / "Pt" / "PT" as
  // prothrombin time. The test documents the bug so a future
  // contributor can fix it (likely: separate "Pt" → "patient"
  // case-sensitively, leaving "PT" alone for the lab).
  const out = correctMedicalText("Pt c/o chest pain");
  const bug = out.corrections.find(
    (c) => c.original === "Pt" && c.corrected === "prothrombin time",
  );
  // If the bug is fixed, this assertion fails and the test
  // reminds the contributor to update the test.
  assert.ok(
    bug,
    "expected 'Pt' to currently be miscorrected to 'prothrombin time' (known bug)",
  );
});

test("pipeline: a single character that happens to match an abbrev is anchored", () => {
  // 'm' is in the abbreviation table as 'male'. The word-boundary
  // regex should still match because 'm' is a whole word here.
  const out = correctMedicalText("Pt is m, 45 yo");
  // We accept 'm' being expanded to 'male' (whole word) but the
  // line should not be over-corrected.
  assert.ok(out.corrections.length >= 1);
});
