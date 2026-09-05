// P2.1 — tests for lib/radiology-images.ts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRadiologyImages,
  resolveImageSrc,
} from "../src/lib/radiology-images.ts";

test("normalizeRadiologyImages: empty / null / undefined", () => {
  for (const empty of [null, undefined, ""]) {
    assert.deepEqual(normalizeRadiologyImages(empty), []);
  }
});

test("normalizeRadiologyImages: array of strings", () => {
  const out = normalizeRadiologyImages([
    "radiology/a.png",
    "radiology/b.png",
  ]);
  assert.deepEqual(out, ["radiology/a.png", "radiology/b.png"]);
});

test("normalizeRadiologyImages: array of objects with objectKey", () => {
  const out = normalizeRadiologyImages([
    { objectKey: "radiology/a.png" },
    { url: "radiology/b.png" },
    { src: "radiology/c.png" },
    { path: "radiology/d.png" },
  ]);
  assert.deepEqual(out, [
    "radiology/a.png",
    "radiology/b.png",
    "radiology/c.png",
    "radiology/d.png",
  ]);
});

test("normalizeRadiologyImages: object without any known key is skipped", () => {
  const out = normalizeRadiologyImages([
    { objectKey: "radiology/a.png" },
    { notAUrl: "ignored" },
    null,
  ]);
  assert.deepEqual(out, ["radiology/a.png"]);
});

test("normalizeRadiologyImages: empty string is skipped", () => {
  const out = normalizeRadiologyImages([
    "radiology/a.png",
    "",
    "radiology/b.png",
  ]);
  assert.deepEqual(out, ["radiology/a.png", "radiology/b.png"]);
});

test("normalizeRadiologyImages: string parses as JSON", () => {
  // '["a","b"]' is a valid JSON array.
  const out = normalizeRadiologyImages('["radiology/a","radiology/b"]');
  assert.deepEqual(out, ["radiology/a", "radiology/b"]);
});

test("normalizeRadiologyImages: non-JSON string is kept as-is", () => {
  const out = normalizeRadiologyImages("radiology/single.png");
  assert.deepEqual(out, ["radiology/single.png"]);
});

test("normalizeRadiologyImages: malformed JSON falls back to raw string", () => {
  // Looks like JSON (starts with [) but isn't valid. Should not
  // throw — it should be kept as the raw string.
  const out = normalizeRadiologyImages("[not valid json");
  assert.deepEqual(out, ["[not valid json"]);
});

test("resolveImageSrc: empty / null returns as-is", () => {
  assert.equal(resolveImageSrc(""), "");
});

test("resolveImageSrc: passes through http(s) URLs", () => {
  assert.equal(resolveImageSrc("http://x/a.png"), "http://x/a.png");
  assert.equal(resolveImageSrc("https://x/a.png"), "https://x/a.png");
});

test("resolveImageSrc: /objects/... → /api/storage/objects/...", () => {
  // /objects/... is the legacy public prefix.
  assert.equal(
    resolveImageSrc("/objects/radiology/abc.png"),
    "/api/storage/objects/radiology/abc.png",
  );
});

test("resolveImageSrc: /<key> (absolute path) passes through", () => {
  // Anything starting with / but not /objects/ is left alone.
  assert.equal(resolveImageSrc("/other/foo.png"), "/other/foo.png");
});

test("resolveImageSrc: relative key → /api/storage/objects/<key>", () => {
  assert.equal(
    resolveImageSrc("radiology/abc.png"),
    "/api/storage/objects/radiology/abc.png",
  );
});
