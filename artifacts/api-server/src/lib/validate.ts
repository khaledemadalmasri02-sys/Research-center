import type { Request, Response, NextFunction } from "express";
import { z, type ZodSchema } from "zod";

/**
 * Express middleware factory that validates `req.body`, `req.query`,
 * and/or `req.params` against zod schemas before the route runs.
 *
 * On success the validated (and coerced) value replaces the original,
 * and a typed reference is attached under `req.validated.<key>` so
 * downstream handlers don't have to re-parse.
 *
 * On failure a 400 is returned with a structured error body:
 *
 *     { error: "Validation failed", issues: [{ path, message }, ...] }
 *
 * The original `req.body` / `req.query` / `req.params` are NEVER
 * mutated to a wider type — only replaced with the schema output.
 *
 * Example:
 *
 *     const Body = z.object({ name: z.string().min(1) });
 *     router.post("/things", validate({ body: Body }), (req, res) => {
 *       const { name } = req.validated.body;
 *     });
 */
export interface ValidateSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

declare module "express-serve-static-core" {
  interface Request {
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
  }
}

export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issues: { source: "body" | "query" | "params"; path: string; message: string }[] = [];
    const validated: { body?: unknown; query?: unknown; params?: unknown } = {};

    if (schemas.body) {
      const r = schemas.body.safeParse(req.body);
      if (r.success) {
        validated.body = r.data;
        req.body = r.data;
      } else {
        for (const i of r.error.issues) issues.push({ source: "body", path: i.path.join("."), message: i.message });
      }
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(req.query);
      if (r.success) {
        validated.query = r.data;
        // Express 5 makes req.query a getter; assign through Object.defineProperty
        // so we don't trip on it.
        Object.defineProperty(req, "query", { value: r.data, writable: true, configurable: true });
      } else {
        for (const i of r.error.issues) issues.push({ source: "query", path: i.path.join("."), message: i.message });
      }
    }
    if (schemas.params) {
      const r = schemas.params.safeParse(req.params);
      if (r.success) {
        validated.params = r.data;
        req.params = r.data as Record<string, string>;
      } else {
        for (const i of r.error.issues) issues.push({ source: "params", path: i.path.join("."), message: i.message });
      }
    }

    if (issues.length > 0) {
      res.status(400).json({ error: "Validation failed", issues });
      return;
    }

    req.validated = validated;
    next();
  };
}

/** Helper: re-export zod for one-line schemas at the call site. */
export { z };
