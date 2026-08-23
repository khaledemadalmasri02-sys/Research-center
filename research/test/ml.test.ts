import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApp, makeEnv, FakeD1, editorUser, viewerUser } from "./helpers";
import { getAuthUser, canEdit, writeAudit } from "../src/lib/security";
import { computeMetrics } from "../src/routes/ml";

vi.mock("../src/lib/security", () => ({
  getAuthUser: vi.fn(),
  isAdmin: (u: any) => !!u?.canAdminAccess,
  canEdit: (u: any) => !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin"),
  writeAudit: vi.fn(),
  hashPassword: (p: string) => p,
  verifyPassword: () => true,
}));

const auth = getAuthUser as unknown as ReturnType<typeof vi.fn>;

describe("ML metrics — pure computeMetrics", () => {
  it("computes perfect metrics on a separable set", () => {
    const m = computeMetrics([
      { score: 0.9, label: 1 },
      { score: 0.8, label: 1 },
      { score: 0.1, label: 0 },
      { score: 0.2, label: 0 },
    ]);
    expect(m.sensitivity).toBe(1);
    expect(m.specificity).toBe(1);
    expect(m.accuracy).toBe(1);
    expect(m.auc).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.sampleSize).toBe(4);
  });

  it("computes a yes/no AUC via ranking", () => {
    // perfect separation -> AUC 1 even if not ordered
    const m = computeMetrics([
      { score: 0.1, label: 0 },
      { score: 0.9, label: 1 },
      { score: 0.2, label: 0 },
      { score: 0.8, label: 1 },
    ]);
    expect(m.auc).toBe(1);
    expect(m.sensitivity).toBe(1);
    expect(m.specificity).toBe(1);
  });

  it("returns zeros for an empty set", () => {
    const m = computeMetrics([]);
    expect(m.sampleSize).toBe(0);
    expect(m.auc).toBe(0);
  });
});

describe("ML routes", () => {
  let app: ReturnType<typeof makeApp>;
  let db: FakeD1;
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    app = makeApp();
    db = new FakeD1();
    env = makeEnv(db);
    auth.mockReset();
    db.calls = [];
  });

  it("registers a model (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO ml_models")) return { lastRowId: 2 };
      return {};
    };
    const res = await app.request(
      "/api/ml/models",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "CXR", version: "1.0" }) },
      env
    );
    expect(res.status).toBe(201);
  });

  it("rejects model register for viewer (403)", async () => {
    auth.mockResolvedValue({ user: viewerUser });
    const res = await app.request(
      "/api/ml/models",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X", version: "1" }) },
      env
    );
    expect(res.status).toBe(403);
  });

  it("logs a prediction (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("INSERT INTO ml_predictions")) return { lastRowId: 4 };
      return {};
    };
    const res = await app.request(
      "/api/ml/predictions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: 2, recordId: 10, confidence: 0.87, outputJson: { label: "pneumonia" } }) },
      env
    );
    expect(res.status).toBe(201);
  });

  it("evaluates a model and stores the run (editor)", async () => {
    auth.mockResolvedValue({ user: editorUser });
    db.responder = (sql) => {
      if (sql.startsWith("SELECT record_id, confidence FROM ml_predictions WHERE model_id")) {
        return { results: [{ record_id: 10, confidence: 0.9 }, { record_id: 11, confidence: 0.2 }] };
      }
      if (sql.startsWith("SELECT record_id, label FROM ml_groundtruth")) {
        return { results: [{ record_id: 10, label: "positive" }, { record_id: 11, label: "negative" }] };
      }
      if (sql.startsWith("INSERT INTO ml_eval_runs")) return { lastRowId: 9 };
      return {};
    };
    const res = await app.request(
      "/api/ml/evaluate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: 2, positiveLabel: "positive" }) },
      env
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.auc).toBe(1);
    expect(body.sampleSize).toBe(2);
  });

  it("400 evaluate without modelId", async () => {
    auth.mockResolvedValue({ user: editorUser });
    const res = await app.request(
      "/api/ml/evaluate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      env
    );
    expect(res.status).toBe(400);
  });
});
