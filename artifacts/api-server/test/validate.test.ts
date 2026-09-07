import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";

import { validate } from "../src/lib/validate";

function buildApp(body?: z.ZodSchema, query?: z.ZodSchema, params?: z.ZodSchema) {
  const app = express();
  app.use(express.json());
  app.post(
    "/items/:id",
    validate({ body, query, params }),
    (req, res) => {
      res.json({
        body: req.validated?.body,
        query: req.validated?.query,
        params: req.validated?.params,
      });
    },
  );
  return app;
}

describe("validate middleware", () => {
  const Body = z.object({
    name: z.string().min(1),
    count: z.number().int().nonnegative(),
  });

  const Query = z.object({
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  });

  const Params = z.object({
    id: z.coerce.number().int().positive(),
  });

  it("returns 200 with validated data when all schemas pass", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app)
      .post("/items/42?search=foo&limit=5")
      .send({ name: "thing", count: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      body: { name: "thing", count: 3 },
      query: { search: "foo", limit: 5 },
      params: { id: 42 },
    });
  });

  it("coerces query string values to the right types", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app).post("/items/7?limit=20").send({ name: "x", count: 0 });
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ limit: 20 });
  });

  it("applies query defaults when the field is missing", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app).post("/items/1").send({ name: "x", count: 0 });
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ limit: 10 });
  });

  it("rejects invalid body with 400 and a structured issues array", async () => {
    const app = buildApp(Body);
    const res = await request(app).post("/items/1").send({ name: "", count: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.issues)).toBe(true);
    const sources = res.body.issues.map((i: { source: string }) => i.source);
    expect(sources).toContain("body");
  });

  it("rejects invalid params with 400", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app).post("/items/abc").send({ name: "x", count: 0 });
    expect(res.status).toBe(400);
    const sources = res.body.issues.map((i: { source: string }) => i.source);
    expect(sources).toContain("params");
  });

  it("rejects invalid query with 400", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app).post("/items/1?limit=999").send({ name: "x", count: 0 });
    expect(res.status).toBe(400);
    const sources = res.body.issues.map((i: { source: string }) => i.source);
    expect(sources).toContain("query");
  });

  it("reports issues for multiple sources at once", async () => {
    const app = buildApp(Body, Query, Params);
    const res = await request(app).post("/items/abc?limit=999").send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThanOrEqual(3);
    const sources = new Set(res.body.issues.map((i: { source: string }) => i.source));
    expect(sources.size).toBe(3);
  });

  it("never calls next() when validation fails", async () => {
    const next = vi.fn();
    const req = { body: { name: "" }, query: {}, params: {} } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    validate({ body: Body })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls next() exactly once when validation passes", () => {
    const next = vi.fn();
    const req = { body: { name: "x", count: 1 }, query: {}, params: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    validate({ body: Body })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("handles a missing schema gracefully (no-op for that source)", async () => {
    const app = buildApp(Body);
    // query/params are not validated, anything goes
    const res = await request(app)
      .post("/items/anything?whatever=true")
      .send({ name: "x", count: 0 });
    expect(res.status).toBe(200);
  });
});
