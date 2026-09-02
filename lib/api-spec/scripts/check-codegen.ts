// P1.16 — codegen drift check.
//
// Runs orval in dry-run mode (writes to a temp dir, never the
// committed `generated/`), then diffs the result against the
// committed `lib/api-client-react/src/generated/`. Exits non-zero
// if the two differ.
//
// This is run by CI on every push. If you intentionally change the
// OpenAPI spec, run `pnpm -F @workspace/api-spec codegen` locally
// to regenerate the clients and commit them alongside the spec
// change.
//
// The reason we run orval into a sandbox instead of comparing two
// back-to-back runs of `pnpm run codegen` is that orval's
// `clean: true` would wipe the committed `generated/` on the first
// run, so any drift comparison would have to be against an empty
// dir. Sandboxing keeps the committed files untouched.
//
// Known orval quirk: the mutator (custom-fetch.ts) is inlined into
// the generated `api.ts`. The exact contents depend on orval's
// internal path resolution at codegen time. The check tolerates
// reordering of trivial blocks (lines that differ only by
// whitespace or by 1-2 blank lines around the inlined `Awaited`
// helper) by ignoring those for the purposes of the diff. A real
// schema or route change still produces hundreds of diff lines and
// fails the check.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const API_SPEC_PKG = join(REPO_ROOT, "lib", "api-spec");
const ORVAL_CONFIG = join(API_SPEC_PKG, "orval.config.ts");
const COMMITTED_GENERATED = join(
  REPO_ROOT,
  "lib",
  "api-client-react",
  "src",
  "generated",
);
const COMMITTED_FETCH = join(
  REPO_ROOT,
  "lib",
  "api-client-react",
  "src",
  "custom-fetch.ts",
);
const SPEC_FILE = join(API_SPEC_PKG, "openapi.yaml");
const SANDBOX = join(REPO_ROOT, ".codegen-check");
const KEEP_SANDBOX = process.argv.includes("--keep-sandbox");

// orval's `workspace` is the *parent* of the `target: "generated"`
// subdir. So the committed dir is `<repo>/lib/api-client-react/src` and
// orval writes to `<repo>/lib/api-client-react/src/generated/`. We
// mirror that here: TEMP_WORKSPACE = <sandbox>/src; orval writes to
// <sandbox>/src/generated/; the diff compares against <sandbox>/src/generated/.
const TEMP_WORKSPACE = join(SANDBOX, "src");
const TEMP_GENERATED = join(TEMP_WORKSPACE, "generated");
mkdirSync(TEMP_WORKSPACE, { recursive: true });

// 1. Build a sandboxed orval config that hardcodes the output path
//    to the sandbox subdir. The original config uses path.resolve
//    with __dirname-relative paths, which would write into the repo
//    even from a sandbox. We override the two output paths with
//    absolute sandbox paths and use absolute paths for the input +
//    mutator so orval can find them no matter where the config
//    file lives.
const original = readFileSync(ORVAL_CONFIG, "utf8");
const sandboxed = original
  .replace(
    /const root = .*;/,
    `const root = ${JSON.stringify(REPO_ROOT)};`,
  )
  .replace(
    /const apiClientReactSrc = .*;/,
    `const apiClientReactSrc = ${JSON.stringify(TEMP_WORKSPACE)};`,
  )
  .replace(
    /const apiZodSrc = .*;/,
    `const apiZodSrc = ${JSON.stringify(join(SANDBOX, "generated-zod"))};`,
  )
  // Both configs read `target: "./openapi.yaml"`; absolute it.
  .replace(
    /target: "\.\/openapi\.yaml"/g,
    `target: ${JSON.stringify(SPEC_FILE)}`,
  )
  // The mutator path also uses path.resolve against apiClientReactSrc,
  // which now points at the sandbox. We keep the mutator file inside
  // the sandbox dir.
  .replace(
    /path: path\.resolve\(apiClientReactSrc, "custom-fetch\.ts"\),/,
    `path: ${JSON.stringify(join(TEMP_WORKSPACE, "custom-fetch.ts"))},`,
  );

const sandboxConfig = join(SANDBOX, "orval.sandbox.config.ts");
writeFileSync(sandboxConfig, sandboxed);

// 2. Copy the inputs the sandboxed config references.
cpSync(SPEC_FILE, join(SANDBOX, "openapi.yaml"));
cpSync(COMMITTED_FETCH, join(TEMP_WORKSPACE, "custom-fetch.ts"));

// 3. Run orval with the absolute sandbox config path. The cwd is the
//    api-spec package so the orval binary resolves from there.
const run = spawnSync("pnpm", ["exec", "orval", "--config", sandboxConfig], {
  cwd: API_SPEC_PKG,
  stdio: "inherit",
});
if (KEEP_SANDBOX) {
  console.log(`[codegen:check] (debug) sandbox at ${SANDBOX}`);
  console.log(`[codegen:check] (debug) orval exit=${run.status} signal=${run.signal}`);
}

if (run.status !== 0) {
  console.error("[codegen:check] orval failed");
  if (!KEEP_SANDBOX) cleanup();
  process.exit(1);
}console.log("[codegen:check] diffing generated dirs…");
const diffs = diffDirs(COMMITTED_GENERATED, TEMP_GENERATED);

if (diffs.length === 0) {
  console.log(
    "[codegen:check] OK — generated/ matches orval output (modulo known cosmetic differences stripped before hashing)",
  );
  if (!KEEP_SANDBOX) cleanup();
  process.exit(0);
}

console.error(
  "[codegen:check] FAILED — generated/ is out of sync with orval",
);
console.error(
  "[codegen:check] run `pnpm -F @workspace/api-spec codegen` and commit the result.",
);
console.error("");
console.error("Diffs:");
for (const d of diffs) console.error("  " + d);
if (!KEEP_SANDBOX) cleanup();
process.exit(1);

function diffDirs(a: string, b: string): string[] {
  const out: string[] = [];
  const aFiles = walk(a);
  const bFiles = walk(b);
  const aKeys = new Set(Object.keys(aFiles));
  const bKeys = new Set(Object.keys(bFiles));

  for (const k of aKeys) {
    if (!bKeys.has(k)) {
      // Ignore the mutator file: it's committed in the consumer
      // package, not in the orval output.
      if (k === "custom-fetch.ts") continue;
      out.push(`only in committed: ${k}`);
      continue;
    }
    if (aFiles[k] !== bFiles[k]) {
      out.push(`changed: ${k}`);
    }
  }
  for (const k of bKeys) {
    if (!aKeys.has(k)) out.push(`only in orval: ${k}`);
  }
  return out;
}

function walk(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function rec(cur: string) {
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      if (statSync(full).isDirectory()) rec(full);
      else {
        const rel = relative(dir, full);
        out[rel] = sha256(stripOrvalQuirks(full, readFileSync(full)));
      }
    }
  }
  rec(dir);
  return out;
}

/**
 * Strip the parts of the generated `api.ts` that orval inlines
 * non-deterministically across runs (depending on its path
 * resolution). The `AwaitedInput` and `Awaited` type aliases are
 * inlined from the custom-fetch mutator, but orval sometimes
 * skips them when the mutator path is absolute.
 */
function stripOrvalQuirks(path: string, buf: Buffer): Buffer {
  if (!path.endsWith("api.ts")) return buf;
  const text = buf.toString("utf8");
  // Strip the inlined `Awaited` declarations (orval sometimes
  // includes them, sometimes not, depending on path resolution),
  // and collapse runs of 3+ blank lines to 1 (orval also varies
  // blank-line counts around the inlined block).
  //
  // The inlined block is at most 4 lines (e.g.):
  //   type AwaitedInput<T> = PromiseLike<T> | T;
  //                  <- blank line sometimes
  //       type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
  //                  <- blank line sometimes
  //
  // We remove both type aliases line-by-line, then collapse blank
  // lines. The cross-line regex proved fiddly; per-line replacement
  // is simpler and matches both shapes.
  const stripped = text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*type\s+AwaitedInput<T>\s*=/.test(line) &&
        !/^\s*type\s+Awaited<O>\s*=/.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return Buffer.from(stripped, "utf8");
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function cleanup() {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
