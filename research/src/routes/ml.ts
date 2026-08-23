import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

export interface MetricRow {
  score: number; // predicted probability of the positive class
  label: 0 | 1; // true binary label
}

// Pure: compute classification metrics from scored rows. AUC uses the
// rank-based (Mann-Whitney) estimator over `score` vs binary `label`.
export function computeMetrics(rows: MetricRow[]): {
  accuracy: number;
  sensitivity: number;
  specificity: number;
  precision: number;
  f1: number;
  auc: number;
  sampleSize: number;
} {
  const n = rows.length;
  if (n === 0) {
    return { accuracy: 0, sensitivity: 0, specificity: 0, precision: 0, f1: 0, auc: 0, sampleSize: 0 };
  }
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of rows) {
    const pred = r.score >= 0.5 ? 1 : 0;
    if (r.label === 1 && pred === 1) tp++;
    else if (r.label === 0 && pred === 0) tn++;
    else if (r.label === 0 && pred === 1) fp++;
    else fn++;
  }
  const sensitivity = tp + fn === 0 ? 0 : tp / (tp + fn);
  const specificity = tn + fp === 0 ? 0 : tn / (tn + fp);
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const f1 = precision + sensitivity === 0 ? 0 : (2 * precision * sensitivity) / (precision + sensitivity);
  const accuracy = (tp + tn) / n;

  // AUC: rank positives among all scores.
  const ranked = [...rows].sort((a, b) => a.score - b.score);
  let rankSum = 0;
  ranked.forEach((r, i) => {
    if (r.label === 1) rankSum += i + 1;
  });
  const pos = rows.filter((r) => r.label === 1).length;
  const neg = n - pos;
  const auc = pos === 0 || neg === 0 ? 0 : (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);

  return { accuracy, sensitivity, specificity, precision, f1, auc, sampleSize: n };
}

export const mlApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/ml/models — register a model (editor+)
mlApp.post("/models", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const version = typeof body?.version === "string" ? body.version.trim() : "";
  if (!name || !version) return c.json({ error: "name and version are required." }, 400);
  const result = (await c.env.DB
    .prepare("INSERT INTO ml_models (name, version, artifact_object_key, metrics_json) VALUES (?, ?, ?, ?)")
    .bind(name, version, body?.artifactObjectKey ?? null, body?.metricsJson ? JSON.stringify(body.metricsJson) : null)
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "ml.model.create", entity: "ml_model", entityId: id });
  return c.json({ ok: true, id }, 201);
});

// GET /api/ml/models — list models (auth)
mlApp.get("/models", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const rows = await c.env.DB.prepare("SELECT * FROM ml_models ORDER BY created_at DESC").all<any>();
  return c.json({
    models: (rows.results || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      artifactObjectKey: m.artifact_object_key,
      metrics: safeJson(m.metrics_json),
      createdAt: m.created_at,
    })),
  });
});

// POST /api/ml/predictions — log a prediction (editor+)
mlApp.post("/predictions", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const modelId = parseInt(body?.modelId, 10);
  if (!Number.isInteger(modelId)) return c.json({ error: "modelId is required." }, 400);
  const result = (await c.env.DB
    .prepare("INSERT INTO ml_predictions (record_id, image_id, model_id, output_json, confidence) VALUES (?, ?, ?, ?, ?)")
    .bind(
      body?.recordId != null ? parseInt(body.recordId, 10) : null,
      body?.imageId != null ? parseInt(body.imageId, 10) : null,
      modelId,
      body?.outputJson ? JSON.stringify(body.outputJson) : null,
      body?.confidence != null ? Number(body.confidence) : null
    )
    .run()) as any;
  return c.json({ ok: true, id: result?.meta?.last_row_id }, 201);
});

// POST /api/ml/groundtruth — label a record (editor+)
mlApp.post("/groundtruth", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const recordId = parseInt(body?.recordId, 10);
  const label = typeof body?.label === "string" ? body.label : "";
  if (!Number.isInteger(recordId) || !label) return c.json({ error: "recordId and label are required." }, 400);
  const result = (await c.env.DB
    .prepare("INSERT INTO ml_groundtruth (record_id, label, reviewed_by) VALUES (?, ?, ?)")
    .bind(recordId, label, auth.user.id)
    .run()) as any;
  return c.json({ ok: true, id: result?.meta?.last_row_id }, 201);
});

// POST /api/ml/evaluate — compute metrics vs ground truth (editor+)
mlApp.post("/evaluate", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const modelId = parseInt(body?.modelId, 10);
  const positiveLabel = body?.positiveLabel ?? "positive";
  if (!Number.isInteger(modelId)) return c.json({ error: "modelId is required." }, 400);

  const preds = await c.env.DB.prepare("SELECT record_id, confidence FROM ml_predictions WHERE model_id = ?").bind(modelId).all<any>();
  const gtRows = await c.env.DB.prepare("SELECT record_id, label FROM ml_groundtruth").all<any>();
  const gt: Record<string, string> = {};
  for (const r of gtRows.results || []) gt[String(r.record_id)] = r.label;

  const rows: MetricRow[] = [];
  for (const p of preds.results || []) {
    const key = String(p.record_id);
    if (!(key in gt)) continue;
    rows.push({ score: p.confidence == null ? 0.5 : Number(p.confidence), label: gt[key] === positiveLabel ? 1 : 0 });
  }
  const metrics = computeMetrics(rows);
  const result = (await c.env.DB
    .prepare(
      "INSERT INTO ml_eval_runs (model_id, auc, sensitivity, specificity, f1, accuracy, sample_size) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(modelId, metrics.auc, metrics.sensitivity, metrics.specificity, metrics.f1, metrics.accuracy, metrics.sampleSize)
    .run()) as any;
  await writeAudit(c, { userId: auth.user.id, action: "ml.evaluate", entity: "ml_model", entityId: modelId });
  return c.json({ ok: true, evalId: result?.meta?.last_row_id, ...metrics });
});

function safeJson(v: any) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
