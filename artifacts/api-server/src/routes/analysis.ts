import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { eq, desc, and, like } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  db,
  analysisDatasetsTable,
  analysisVariablesTable,
  analysisRunsTable,
  patientsTable,
  type AnalysisDataset,
} from "@workspace/db";
import { ObjectStorageService, s3Client } from "../lib/objectStorage";
import { requireAuth } from "./auth";
import {
  Dataset,
  runAnalysis,
  histogram,
  boxplotStats,
  scatterPoints,
  barData,
  groupedBoxStats,
  correlationMatrixData,
  type AnalysisType,
  type AnalysisOptions,
  type TabularData,
  type VariableMeta,
  type Cell,
} from "@workspace/stats";
import {
  tabularFromCsv,
  tabularFromXlsx,
  tabularFromSav,
  tabularToSavBytes,
  tabularToCsv,
  tabularToXlsxBytes,
} from "@workspace/stats/io";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

function ownerId(req: Request): number {
  return req.session.userId ?? 0;
}

async function getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  // @ts-expect-error body is a stream at runtime
  for await (const chunk of res.Body) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

function detectFormat(name: string, declared?: string): "csv" | "xlsx" | "sav" {
  if (declared === "csv" || declared === "xlsx" || declared === "sav") return declared;
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "sav" || ext === "zsav") return "sav";
  return "csv";
}

function parseTabular(format: "csv" | "xlsx" | "sav", bytes: Uint8Array): TabularData {
  if (format === "csv") return tabularFromCsv(new TextDecoder().decode(bytes));
  if (format === "xlsx") return tabularFromXlsx(bytes);
  return tabularFromSav(bytes);
}

function rowsToCsv(data: TabularData): string {
  return tabularToCsv(data);
}

function rowsToXlsx(data: TabularData): Uint8Array {
  return tabularToXlsxBytes(data);
}

function resultToCsv(
  tables: { title?: string; columns: string[]; rows: (number | string | null)[][] }[],
): string {
  const blocks: string[] = [];
  for (const t of tables) {
    const esc = (c: number | string | null) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = `# ${t.title ?? ""}`;
    const cols = t.columns.map(esc).join(",");
    const body = t.rows.map((r) => r.map(esc).join(",")).join("\n");
    blocks.push([head, cols, body].join("\n"));
  }
  return blocks.join("\n\n");
}

/** POST /api/analysis/datasets — upload CSV/XLSX/SAV */
router.post(
  "/analysis/datasets",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as { originalname: string; buffer: Buffer; mimetype?: string } | undefined;
      if (!file) {
        res.status(400).json({ error: "No file uploaded." });
        return;
      }
      const name = (req.body.name as string) || file.originalname;
      const format = detectFormat(file.originalname, req.body.format as string);
      const bytes = new Uint8Array(file.buffer);
      const data = parseTabular(format, bytes);
      if (data.variables.length === 0) {
        res.status(400).json({ error: "Could not parse any columns from the file." });
        return;
      }

      const bucket = storage.getBucket();
      const objectKey = `analysis/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await storage.uploadObject(bucket, objectKey, bytes, file.mimetype || "application/octet-stream");

      const [dataset] = await db
        .insert(analysisDatasetsTable)
        .values({
          ownerId: ownerId(req),
          name,
          source: "upload",
          format,
          rowCount: data.rows.length,
          objectKey,
        })
        .returning();

      const variableRows = data.variables.map((v: VariableMeta) => ({
        datasetId: dataset.id,
        name: v.name,
        label: v.label ?? null,
        dataType: v.dataType,
        measure: v.measure,
        missingValues: v.missingValues
          ? (v.missingValues.filter((m) => m !== null) as (number | string)[])
          : null,
        valueLabels: v.valueLabels ?? null,
      }));
      await db.insert(analysisVariablesTable).values(variableRows);

      res.status(201).json({
        id: dataset.id,
        name: dataset.name,
        format: dataset.format,
        rowCount: dataset.rowCount,
        variables: data.variables,
      });
    } catch (err) {
      console.error("analysis upload failed", err);
      res.status(500).json({ error: "Failed to import dataset." });
    }
  },
);

/** POST /api/analysis/datasets/from-query — build dataset from existing patients */
router.post("/analysis/datasets/from-query", requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      name?: string;
      columns?: string[];
      sex?: string;
      collectionType?: string;
      search?: string;
    };
    const allowed = new Set(Object.keys(patientsTable));
    const cols = (
      body.columns && body.columns.length
        ? body.columns
        : ["patientId", "age", "sex", "collectionType", "finalConfirmedDiagnosis", "aiPredictionOutput"]
    ).filter((c) => allowed.has(c));
    if (cols.length === 0) {
      res.status(400).json({ error: "No valid columns selected." });
      return;
    }

    const conditions = [];
    if (body.sex) conditions.push(eq(patientsTable.sex, body.sex));
    if (body.collectionType) conditions.push(eq(patientsTable.collectionType, body.collectionType));
    if (body.search) conditions.push(like(patientsTable.patientName, `%${body.search}%`));

    const columns = cols.reduce((acc, c) => {
      acc[c] = patientsTable[c as keyof typeof patientsTable];
      return acc;
    }, {} as Record<string, any>);

    const rows = await db
      .select(columns)
      .from(patientsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .limit(5000);

    const data: TabularData = {
      variables: cols.map((c) => ({
        name: c,
        dataType: c === "age" ? "numeric" : "string",
        measure: c === "age" ? "scale" : "nominal",
      })),
      rows: rows.map((r) => cols.map((c) => (r as any)[c] ?? null)),
    };

    const csv = rowsToCsv(data);
    const bucket = storage.getBucket();
    const objectKey = `analysis/query-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.csv`;
    await storage.uploadObject(bucket, objectKey, new TextEncoder().encode(csv), "text/csv");

    const [dataset] = await db
      .insert(analysisDatasetsTable)
      .values({
        ownerId: ownerId(req),
        name: body.name || "Patient dataset",
        source: "query",
        format: "csv",
        rowCount: data.rows.length,
        objectKey,
      })
      .returning();

    await db.insert(analysisVariablesTable).values(
      data.variables.map((v) => ({
        datasetId: dataset.id,
        name: v.name,
        label: null,
        dataType: v.dataType,
        measure: v.measure,
        missingValues: null,
        valueLabels: null,
      })),
    );

    res.status(201).json({
      id: dataset.id,
      name: dataset.name,
      format: dataset.format,
      rowCount: dataset.rowCount,
      variables: data.variables,
    });
  } catch (err) {
    console.error("analysis from-query failed", err);
    res.status(500).json({ error: "Failed to build dataset." });
  }
});

/** GET /api/analysis/datasets — list owner's datasets */
router.get("/analysis/datasets", requireAuth, async (req: Request, res: Response) => {
  const list = await db
    .select({
      id: analysisDatasetsTable.id,
      name: analysisDatasetsTable.name,
      source: analysisDatasetsTable.source,
      format: analysisDatasetsTable.format,
      rowCount: analysisDatasetsTable.rowCount,
      createdAt: analysisDatasetsTable.createdAt,
    })
    .from(analysisDatasetsTable)
    .where(eq(analysisDatasetsTable.ownerId, ownerId(req)))
    .orderBy(desc(analysisDatasetsTable.createdAt));
  res.json(list);
});

/** GET /api/analysis/datasets/:id — meta + variables + preview */
router.get("/analysis/datasets/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [dataset] = await db
    .select()
    .from(analysisDatasetsTable)
    .where(and(eq(analysisDatasetsTable.id, id), eq(analysisDatasetsTable.ownerId, ownerId(req))));
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  const variables = await db
    .select()
    .from(analysisVariablesTable)
    .where(eq(analysisVariablesTable.datasetId, id))
    .orderBy(analysisVariablesTable.id);

  let preview: Cell[][] = [];
  if (dataset.objectKey) {
    const bytes = await getObjectBytes(storage.getBucket(), dataset.objectKey);
    const data = parseTabular(dataset.format as "csv" | "xlsx" | "sav", bytes);
    preview = data.rows.slice(0, 50);
  }

  res.json({ dataset, variables, preview });
});

/** PATCH /api/analysis/datasets/:id/variables — update variable metadata */
router.patch("/analysis/datasets/:id/variables", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const updates = req.body as {
    name: string;
    label?: string | null;
    measure?: "scale" | "ordinal" | "nominal";
    missingValues?: (number | string)[] | null;
    valueLabels?: Record<string, string> | null;
  }[];
  if (!Array.isArray(updates)) {
    res.status(400).json({ error: "Expected an array of variable updates." });
    return;
  }
  for (const u of updates) {
    await db
      .update(analysisVariablesTable)
      .set({
        label: u.label ?? null,
        measure: u.measure ?? "scale",
        missingValues: u.missingValues ?? null,
        valueLabels: u.valueLabels ?? null,
      })
      .where(
        and(
          eq(analysisVariablesTable.datasetId, id),
          eq(analysisVariablesTable.name, u.name),
        ),
      );
  }
  res.json({ ok: true });
});

async function loadDataset(id: number, uid: number): Promise<{ dataset: AnalysisDataset; data: TabularData }> {
  const [dataset] = await db
    .select()
    .from(analysisDatasetsTable)
    .where(and(eq(analysisDatasetsTable.id, id), eq(analysisDatasetsTable.ownerId, uid)));
  if (!dataset || !dataset.objectKey) throw new Error("Dataset not found.");
  const bytes = await getObjectBytes(storage.getBucket(), dataset.objectKey);
  const data = parseTabular(dataset.format as "csv" | "xlsx" | "sav", bytes);
  return { dataset, data };
}

/** POST /api/analysis/datasets/:id/analyze — run an analysis */
router.post("/analysis/datasets/:id/analyze", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { type, options } = req.body as { type: AnalysisType; options: AnalysisOptions };
    const { data } = await loadDataset(id, ownerId(req));
    const dataset = new Dataset(data);
    const result = runAnalysis(dataset, type, options);

    const [run] = await db
      .insert(analysisRunsTable)
      .values({
        datasetId: id,
        ownerId: ownerId(req),
        type,
        config: options as any,
        result: result as any,
      })
      .returning();

    res.status(201).json({ id: run.id, ...result });
  } catch (err) {
    console.error("analysis run failed", err);
    res.status(400).json({ error: (err as Error).message || "Analysis failed." });
  }
});

/** GET /api/analysis/runs/:id — fetch a saved run */
router.get("/analysis/runs/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [run] = await db
    .select()
    .from(analysisRunsTable)
    .where(and(eq(analysisRunsTable.id, id), eq(analysisRunsTable.ownerId, ownerId(req))));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json(run);
});

/** POST /api/analysis/datasets/:id/chart — chart-ready data built from full dataset */
router.post("/analysis/datasets/:id/chart", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as {
      kind: "histogram" | "box" | "scatter" | "bar" | "correlation";
      variable?: string;
      variable2?: string;
      group?: string;
      variables?: string[];
    };
    const { data } = await loadDataset(id, ownerId(req));
    const dataset = new Dataset(data);
    switch (body.kind) {
      case "histogram": {
        if (!body.variable) {
          res.status(400).json({ error: "variable required" });
          return;
        }
        res.json({ kind: "histogram", variable: body.variable, bins: histogram(dataset.numericColumn(body.variable)) });
        return;
      }
      case "box": {
        if (!body.variable) {
          res.status(400).json({ error: "variable required" });
          return;
        }
        if (body.group) {
          res.json({ kind: "box", groups: groupedBoxStats(dataset, body.variable, body.group) });
        } else {
          res.json({ kind: "box", stats: boxplotStats(dataset.numericColumn(body.variable)) });
        }
        return;
      }
      case "scatter": {
        if (!body.variable || !body.variable2) {
          res.status(400).json({ error: "two variables required" });
          return;
        }
        res.json({
          kind: "scatter",
          x: body.variable,
          y: body.variable2,
          points: scatterPoints(dataset.numericColumn(body.variable), dataset.numericColumn(body.variable2)),
        });
        return;
      }
      case "bar": {
        if (!body.variable) {
          res.status(400).json({ error: "variable required" });
          return;
        }
        const meta = dataset.meta(body.variable);
        if (meta?.dataType === "numeric") {
          res.json({ kind: "bar", variable: body.variable, bins: histogram(dataset.numericColumn(body.variable)) });
        } else {
          res.json({ kind: "bar", variable: body.variable, bars: barData(dataset.frequencies(body.variable)) });
        }
        return;
      }
      case "correlation": {
        const vars = body.variables && body.variables.length ? body.variables : detailScaleVars(dataset);
        res.json({ kind: "correlation", ...correlationMatrixData(dataset, vars) });
        return;
      }
      default:
        res.status(400).json({ error: "Unknown chart kind" });
        return;
    }
  } catch (err) {
    console.error("chart failed", err);
    res.status(400).json({ error: (err as Error).message || "Chart failed." });
  }
});

function detailScaleVars(dataset: Dataset): string[] {
  return dataset.variables.filter((v) => v.dataType === "numeric").map((v) => v.name).slice(0, 12);
}

/** POST /api/analysis/datasets/:id/export — export dataset to sav/csv/xlsx */
router.post("/analysis/datasets/:id/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const format = ((req.body.format as string) || "sav").toLowerCase();
    const { data } = await loadDataset(id, ownerId(req));
    let bytes: Uint8Array;
    let contentType: string;
    let ext: string;
    if (format === "sav") {
      bytes = tabularToSavBytes(data);
      contentType = "application/x-spss-sav";
      ext = "sav";
    } else if (format === "xlsx") {
      bytes = rowsToXlsx(data);
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ext = "xlsx";
    } else {
      bytes = new TextEncoder().encode(rowsToCsv(data));
      contentType = "text/csv";
      ext = "csv";
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="dataset-${id}.${ext}"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error("dataset export failed", err);
    res.status(500).json({ error: "Export failed." });
  }
});

/** POST /api/analysis/runs/:id/export — export a run result to CSV */
router.post("/analysis/runs/:id/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [run] = await db
      .select()
      .from(analysisRunsTable)
      .where(and(eq(analysisRunsTable.id, id), eq(analysisRunsTable.ownerId, ownerId(req))));
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    const result = run.result as { tables: { title?: string; columns: string[]; rows: (number | string | null)[][] }[] };
    const csv = resultToCsv(result.tables);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="analysis-${id}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("run export failed", err);
    res.status(500).json({ error: "Export failed." });
  }
});

export default router;
