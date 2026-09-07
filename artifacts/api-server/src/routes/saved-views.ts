import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, savedViewsTable } from "@workspace/db";
import { requireAuth } from "./auth";
import { validate, z } from "../lib/validate";

const router: IRouter = Router();

const ViewIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

const CreateViewBody = z.object({
  definitionId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  filters: z.record(z.string(), z.unknown()).optional(),
  sort: z.record(z.string(), z.unknown()).optional(),
});

const UpdateViewBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    sort: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.filters !== undefined || v.sort !== undefined,
    { message: "At least one of name, filters, sort must be provided" },
  );

const ListViewsQuery = z.object({
  definitionId: z.coerce.number().int().positive().optional(),
});

router.post(
  "/saved-views",
  requireAuth,
  validate({ body: CreateViewBody }),
  async (req: Request, res: Response) => {
    const { definitionId, name, filters, sort } = req.validated!.body as z.infer<typeof CreateViewBody>;
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
  },
);

router.get(
  "/saved-views",
  requireAuth,
  validate({ query: ListViewsQuery }),
  async (req: Request, res: Response) => {
    const { definitionId } = req.validated!.query as z.infer<typeof ListViewsQuery>;
    const where = definitionId
      ? and(eq(savedViewsTable.userId, req.session.userId ?? 0), eq(savedViewsTable.definitionId, definitionId))
      : eq(savedViewsTable.userId, req.session.userId ?? 0);

    const views = await db
      .select()
      .from(savedViewsTable)
      .where(where)
      .orderBy(desc(savedViewsTable.createdAt));

    res.json({ views });
  },
);

router.get(
  "/saved-views/:id",
  requireAuth,
  validate({ params: ViewIdParams }),
  async (req: Request, res: Response) => {
    const { id } = req.validated!.params as z.infer<typeof ViewIdParams>;
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
  },
);

router.patch(
  "/saved-views/:id",
  requireAuth,
  validate({ params: ViewIdParams, body: UpdateViewBody }),
  async (req: Request, res: Response) => {
    const { id } = req.validated!.params as z.infer<typeof ViewIdParams>;
    const update = req.validated!.body as z.infer<typeof UpdateViewBody>;
    const [existing] = await db
      .select()
      .from(savedViewsTable)
      .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, req.session.userId ?? 0)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "View not found" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (update.name !== undefined) updateData.name = update.name;
    if (update.filters !== undefined) updateData.filters = update.filters as any;
    if (update.sort !== undefined) updateData.sort = update.sort as any;

    const [view] = await db
      .update(savedViewsTable)
      .set(updateData)
      .where(eq(savedViewsTable.id, id))
      .returning();

    res.json({ view });
  },
);

router.delete(
  "/saved-views/:id",
  requireAuth,
  validate({ params: ViewIdParams }),
  async (req: Request, res: Response) => {
    const { id } = req.validated!.params as z.infer<typeof ViewIdParams>;
    await db
      .delete(savedViewsTable)
      .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, req.session.userId ?? 0)));
    res.json({ ok: true });
  },
);

export default router;
