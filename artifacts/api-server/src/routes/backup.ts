import { Router, type IRouter, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs/promises";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../lib/objectStorage";
import { requireAdmin } from "../middlewares/requireAdmin";
import { writeAudit, clientIp } from "../lib/audit";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

// Dumps the database with pg_dump and uploads it to S3 under /backups/.
// Relies on S3 bucket versioning for retention.
router.post("/admin/backup", requireAdmin, async (req: Request, res: Response) => {
  const bucket = process.env.S3_BUCKET;
  const url = process.env.DATABASE_URL;
  if (!bucket || !url) {
    res.status(500).json({ error: "Backup is not configured (need S3_BUCKET and DATABASE_URL)." });
    return;
  }

  const file = join(tmpdir(), `backup-${Date.now()}.sql`);
  try {
    await execFileAsync("pg_dump", ["--no-owner", "--no-privileges", "--format=plain", url, "-f", file]);
    const body = await fs.readFile(file);
    const key = `backups/${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/sql" }));
    await fs.unlink(file).catch(() => {});

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
  }
});

export default router;
