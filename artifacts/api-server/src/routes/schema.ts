import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { writeAudit, clientIp } from "../lib/audit";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/db/tables", requireAdmin, async (_req: Request, res: Response) => {
  const result = await pool.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const tables: Record<string, { columns: any[] }> = {};
  for (const row of result.rows) {
    if (!tables[row.table_name]) {
      tables[row.table_name] = { columns: [] };
    }
    tables[row.table_name].columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      default: row.column_default,
    });
  }

  res.json({ tables });
});

// Tables an admin may read through the DB viewer. Sensitive/auth tables
// (users, api_tokens, session, signup_requests) are excluded to avoid
// exposing credentials, tokens, and PII en masse.
const SAFE_TABLES = new Set([
  "patients",
  "records",
  "record_definitions",
  "record_images",
  "feedback",
  "audit_log",
  "notifications",
  "saved_views",
  "record_definitions",
]);

// Only allow reading tables that actually exist in the public schema.
// The table name is validated against the live catalog and never interpolated
// unsafely — limit/offset are passed as bound parameters.
router.get("/db/:table", requireAdmin, async (req: Request, res: Response) => {
  const table = String(req.params.table);
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    if (!SAFE_TABLES.has(table)) {
      res.status(403).json({ error: `Table "${table}" is not readable through this endpoint` });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM "${table}" LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    await writeAudit({
      userId: req.session?.userId ?? null,
      action: "database.read",
      entity: "table",
      detail: { table, limit, offset },
      ip: clientIp(req),
    });

    res.json({
      table,
      count: result.rowCount,
      rows: result.rows,
    });
  } catch (error) {
    res.status(400).json({ error: `Table "${table}" not found or inaccessible` });
  }
});

export default router;
