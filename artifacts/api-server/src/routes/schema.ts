import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";

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
      nullable: row.is_nullable === 'YES',
      default: row.column_default,
    });
  }
  
  res.json({ tables });
});

router.get("/db/:table", async (req: Request, res: Response) => {
  const table = req.params.table;
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const result = await pool.query(
      `SELECT * FROM "${table}" LIMIT ${limit} OFFSET ${offset}`
    );
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