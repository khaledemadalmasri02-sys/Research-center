import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, savedViewsTable } from "@workspace/db";
import { requireAuth } from "./auth";

const router: IRouter = Router();

router.post("/saved-views", requireAuth, async (req: Request, res: Response) => {
  const { definitionId, name, filters, sort } = req.body as {
    definitionId?: number;
    name?: string;
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
  };
  if (!definitionId || !Number.isInteger(definitionId)) {
    res.status(400).json({ error: "definitionId is required" });
    return;
  }
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "View name is required" });
    return;
  }

  const [view] = await db
    .insert(savedViewsTable)
    .values({
      userId: req.session.userId ?? 0,
      definitionId,
      name,
      filters: (filters ?? {}) as any,
      sort: (sort ?? {}) as any,
    })
    .returning();

  res.status(201).json({ view });
});

router.get("/saved-views", requireAuth, async (req: Request, res: Response) => {
  const definitionId = req.query.definitionId ? Number(req.query.definitionId) : undefined;
  const where = definitionId
    ? and(eq(savedViewsTable.userId, req.session.userId ?? 0), eq(savedViewsTable.definitionId, definitionId))
    : eq(savedViewsTable.userId, req.session.userId ?? 0);

  const views = await db
    .select()
    .from(savedViewsTable)
    .where(where)
    .orderBy(desc(savedViewsTable.createdAt));

  res.json({ views });
});

router.get("/saved-views/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [view] = await db
    .select()
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, req.session.userId ?? 0)))
    .limit(1);
  if (!view) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.json({ view });
});

router.patch("/saved-views/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { name, filters, sort } = req.body as {
    name?: string;
    filters?: Record<string, unknown>;
    sort?: Record<string, unknown>;
  };
  const [existing] = await db
    .select()
    .from(savedViewsTable)
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, req.session.userId ?? 0)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "View not found" });
    return;
  }

  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (filters !== undefined) update.filters = filters as any;
  if (sort !== undefined) update.sort = sort as any;

  const [view] = await db
    .update(savedViewsTable)
    .set(update)
    .where(eq(savedViewsTable.id, id))
    .returning();

  res.json({ view });
});

router.delete("/saved-views/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await db
    .delete(savedViewsTable)
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, req.session.userId ?? 0)));
  res.json({ ok: true });
});

export default router;
