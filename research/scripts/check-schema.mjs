// Schema consistency check (test3.md cross-cutting note).
// The D1 worker has two sources of table definitions:
//   1. research/schema.sql            (D1 migrations / local init)
//   2. research/src/lib/db-bootstrap.ts (runtime CREATE TABLE IF NOT EXISTS)
// This script asserts both define the same set of tables so they cannot drift.
//
// Run: node scripts/check-schema.mjs   (or `npm run check:schema`)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const researchDir = join(here, "..");

const schemaSqlPath = join(researchDir, "schema.sql");
const bootstrapPath = join(researchDir, "src", "lib", "db-bootstrap.ts");

function fail(msg) {
  console.error("❌ " + msg);
  process.exit(1);
}

if (!existsSync(schemaSqlPath)) fail(`Missing ${schemaSqlPath}`);
if (!existsSync(bootstrapPath)) fail(`Missing ${bootstrapPath}`);

const schemaSql = readFileSync(schemaSqlPath, "utf8");
const bootstrap = readFileSync(bootstrapPath, "utf8");

function tableNames(sql) {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z0-9_]+)(?=\s*\()/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(sql))) out.add(m[1].toLowerCase());
  return out;
}

const fromSql = tableNames(schemaSql);
const fromBootstrap = tableNames(bootstrap);

const missingInSql = [...fromBootstrap].filter((t) => !fromSql.has(t));
const missingInBootstrap = [...fromSql].filter((t) => !fromBootstrap.has(t));

console.log(`schema.sql tables:        ${[...fromSql].sort().join(", ")}`);
console.log(`db-bootstrap tables:      ${[...fromBootstrap].sort().join(", ")}`);

let ok = true;
if (missingInSql.length) {
  ok = false;
  console.error(`❌ Tables in db-bootstrap missing from schema.sql: ${missingInSql.join(", ")}`);
}
if (missingInBootstrap.length) {
  ok = false;
  console.error(`❌ Tables in schema.sql missing from db-bootstrap: ${missingInBootstrap.join(", ")}`);
}

if (ok) {
  console.log(`✅ Schema consistent: ${fromSql.size} tables in both sources.`);
  process.exit(0);
} else {
  process.exit(1);
}
