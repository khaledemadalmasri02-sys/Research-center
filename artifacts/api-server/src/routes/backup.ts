import { Router, type IRouter, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs/promises";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../lib/objectStorage";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "./auth";
import { writeAudit, clientIp } from "../lib/audit";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

// SECURITY: the `backups/` prefix in the target bucket MUST be private. These
// objects are unencrypted, full `pg_dump` dumps of the PHI database, so:
//   - never place `backups/` inside PUBLIC_OBJECT_SEARCH_PATHS,
//   - keep bucket listing/ACLs restricted to the api-server role,
//   - enable server-side encryption + versioning on the bucket.
// Anything that can LIST or GET that prefix is a full PHI disclosure.
//
// Dumps the database with pg_dump and uploads it to S3 under /backups/.
// Relies on S3 bucket versioning for retention.
router.post("/admin/backup", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET;
  const url = process.env.DATABASE_URL;
  if (!bucket || !url) {
    res.status(500).json({ error: "Backup is not configured (need S3_BUCKET and DATABASE_URL)." });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(500).json({ error: "DATABASE_URL is not a valid connection URL." });
    return;
  }

  // A16: the connection string used to be passed as a positional argv value,
  // which put the DB password in /proc/<pid>/cmdline — readable by every
  // process on the host and by anything that can read the process table.
  // Credentials now go through the environment (PGPASSWORD), which is only
  // visible to this child and to root.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (parsed.password) {
    env.PGPASSWORD = decodeURIComponent(parsed.password);
    // Belt and braces: pg ignores .pgpass when PGPASSWORD is set, but make
    // sure a stale file cannot supply a different password.
    env.PGPASSFILE = "/dev/null";
  }

  const dbName = parsed.pathname.replace(/^\//, "") || undefined;
  const args = [
    "--no-owner",
    "--no-privileges",
    "--format=plain",
    "-h",
    parsed.hostname,
    "-p",
    parsed.port || "5432",
    "-U",
    decodeURIComponent(parsed.username || "postgres"),
    ...(dbName ? ["-d", dbName] : []),
    "-f",
    // filled in below, once the private temp dir exists
    "",
  ];

  // A16: `join(tmpdir(), "backup-<ts>.sql")` was predictable, world-readable
  // (/tmp defaults to 1777) and only unlinked on the SUCCESS path — a failed
  // dump left the plaintext SQL dump sitting in /tmp.
  let dir: string | null = null;
  try {
    dir = await fs.mkdtemp(join(tmpdir(), "mednexus-backup-"));
    await fs.chmod(dir, 0o700);
    const file = join(dir, "dump.sql");
    args[args.length - 1] = file;

    await execFileAsync("pg_dump", args, { env });

    const body = await fs.readFile(file);
    const key = `backups/${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/sql" }));

    await writeAudit({
      userId: req.session.userId ?? null,
      action: "backup.run",
      detail: { key },
      ip: clientIp(req),
    });

    res.json({ ok: true, key });
  } catch (err) {
    console.error("[backup] failed", err);
    res.status(500).json({ error: "Backup failed." });
  } finally {
    // Remove the plaintext dump on every path, success or failure.
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

export default router;