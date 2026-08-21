import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { writeAudit, clientIp } from "../lib/audit";

const router: IRouter = Router();

router.get("/db/tables", async (_req: Request, res: Response) => {
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

// Only allow reading tables that actually exist in the public schema.
// The table name is validated against the live catalog and never interpolated
// unsafely — limit/offset are passed as bound parameters.
router.get("/db/:table", async (req: Request, res: Response) => {
  const table = String(req.params.table);
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const allowed = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = allowed.rows.map((r: { table_name: string }) => r.table_name);

    if (!names.includes(table)) {
      res.status(400).json({ error: `Table "${table}" not found or inaccessible` });
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
