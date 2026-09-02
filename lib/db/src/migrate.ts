import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index";

/**
 * Apply Drizzle migrations to the configured database.
 *
 * The migrations folder is resolved relative to this file's location. When
 * @workspace/db is consumed as a pnpm workspace dep, the package may be
 * symlinked into the consumer's node_modules. `fileURLToPath` returns the
 * symlink path, so we use `fs.realpathSync` to find the real on-disk
 * package root, then look for `drizzle/` there.
 */
function resolveMigrationsFolder(): string {
  const here = fileURLToPath(import.meta.url);
  const real = fs.realpathSync(here);
  // Walk up from src/migrate.ts to the package root.
  let dir = path.dirname(real);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "drizzle", "meta", "_journal.json"))) {
      return path.join(dir, "drizzle");
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    "Could not locate @workspace/db/drizzle folder. " +
      "Did you forget to run `pnpm -F @workspace/db generate`?",
  );
}

const migrationsFolder = resolveMigrationsFolder();

export async function runMigrations(): Promise<void> {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
}

export { migrationsFolder };