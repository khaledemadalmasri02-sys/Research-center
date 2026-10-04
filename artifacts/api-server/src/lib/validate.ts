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

/**
 * Type augmentation for the request-scoped `validated` bag that `validate()`
 * attaches.
 *
 * Declared against **both** `express` and `express-serve-static-core`.
 * `@types/express` v5 re-exports `Request` from `express-serve-static-core`, so
 * augmenting only the upstream package did not reliably merge into the
 * `express.Request` that route handlers import — `req.validated` was reported as
 * "Property does not exist" in 26 places even though the augmentation resolved.
 * Augmenting the module the handlers actually import from is what makes the
 * merge stick. `express-serve-static-core` is kept so the augmentation also
 * applies to handlers that import the core types directly.
 *
 * `@types/express-serve-static-core` must therefore be a DIRECT devDependency
 * of this package: it is a transitive dep of `@types/express`, and pnpm's strict
 * node_modules layout does not expose transitive `@types/*` to the importer.
 */
export interface ValidatedBag {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

declare module "express" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Request {
    validated?: ValidatedBag;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    validated?: ValidatedBag;
  }
}

export interface ValidationIssue {
  source: "body" | "query" | "params";
  path: string;
  message: string;
}

export interface ValidationErrorBody {
  error: "Validation failed";
  issues: ValidationIssue[];
}

/**
 * Build the SAME 400 body `validate()` produces, for handlers that need to parse
 * inline rather than through the middleware.
 *
 * Several route modules call `Schema.safeParse(...)` themselves because they
 * need the parsed value afterwards (so they cannot use `req.validated`). Those
 * handlers used to answer `{ error: zodError.message }`, which
 * `ZodError.message` renders as a *stringified JSON array of issue objects* —
 * an unhelpful blob that leaks the internal schema shape and drops the
 * `source`/`path` fields clients need to highlight the offending input. This
 * helper keeps one error shape across the whole API, which is what
 * `validate()`'s own doc comment above promises and what the API tests assert.
 */
export function validationErrorBody(
  err: { issues: ReadonlyArray<{ path?: ReadonlyArray<PropertyKey>; message: string }> },
  source: ValidationIssue["source"] = "body",
  message?: string,
): ValidationErrorBody {
  return {
    error: "Validation failed",
    issues: err.issues.map((i) => ({
      source,
      path: (i.path ?? []).map(String).join("."),
      // `message` override carries a schema `.refine()` explanation, which is
      // more useful than the generic "Invalid input" zod emits for it.
      message: message ?? i.message,
    })),
  };
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
