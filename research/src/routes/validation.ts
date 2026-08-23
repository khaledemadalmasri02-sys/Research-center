import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

export interface ValidationRule {
  id?: number;
  definitionId?: number;
  fieldKey: string;
  ruleType: "required" | "range" | "regex" | "cross_field" | "unique";
  params: Record<string, any>;
  message?: string;
  severity: "error" | "warning";
}

export interface Violation {
  field: string;
  ruleType: string;
  severity: "error" | "warning";
  message: string;
}

const VALID_TYPES = new Set(["required", "range", "regex", "cross_field", "unique"]);

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

// Pure evaluation for rules that need no DB lookup. `unique` is handled by the
// caller (needs a records query). Returns per-rule violations.
export function evaluateRules(
  rules: Array<ValidationRule & { id: number }>,
  data: Record<string, any>
): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rules) {
    const value = data[rule.fieldKey];
    const msg =
      rule.message || defaultMessage(rule);
    const fail = (): void => {
      violations.push({
        field: rule.fieldKey,
        ruleType: rule.ruleType,
        severity: rule.severity,
        message: msg,
      });
    };

    if (rule.ruleType === "required") {
      if (isEmpty(value)) fail();
    } else if (rule.ruleType === "range") {
      if (!isEmpty(value)) {
        const n = Number(value);
        const min = rule.params?.min;
        const max = rule.params?.max;
        if (Number.isNaN(n)) fail();
        else if (min !== undefined && n < min) fail();
        else if (max !== undefined && n > max) fail();
      }
    } else if (rule.ruleType === "regex") {
      if (!isEmpty(value) && rule.params?.pattern) {
        try {
          if (!new RegExp(rule.params.pattern).test(String(value))) fail();
        } catch {
          /* invalid pattern → skip */
        }
      }
    } else if (rule.ruleType === "cross_field") {
      const other = data[rule.params?.otherField];
      if (rule.params?.op === "eq" && String(value) !== String(other)) fail();
      else if (rule.params?.op === "neq" && String(value) === String(other)) fail();
    }
    // "unique" handled by caller via DB.
  }
  return violations;
}

function defaultMessage(rule: ValidationRule): string {
  switch (rule.ruleType) {
    case "required":
      return `${rule.fieldKey} is required.`;
    case "range":
      return `${rule.fieldKey} must be between ${rule.params?.min ?? "-∞"} and ${rule.params?.max ?? "∞"}.`;
    case "regex":
      return `${rule.fieldKey} has an invalid format.`;
    case "cross_field":
      return `${rule.fieldKey} does not satisfy the cross-field rule.`;
    case "unique":
      return `${rule.fieldKey} must be unique.`;
    default:
      return `${rule.fieldKey} is invalid.`;
  }
}

export const validationApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// GET /api/validation/rules?definitionId= — list rules
validationApp.get("/rules", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const definitionId = c.req.query("definitionId");
  const rows = definitionId
    ? await c.env.DB.prepare(
        "SELECT * FROM validation_rules WHERE definition_id = ? ORDER BY id"
      )
        .bind(parseInt(definitionId, 10))
        .all<any>()
    : await c.env.DB.prepare("SELECT * FROM validation_rules ORDER BY id").all<any>();
  return c.json({ rules: (rows.results || []).map(normalizeRule) });
});

// POST /api/validation/rules — create a rule (editor+)
validationApp.post("/rules", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const fieldKey = typeof body?.fieldKey === "string" ? body.fieldKey.trim() : "";
  const ruleType = body?.ruleType;
  if (!fieldKey) return c.json({ error: "fieldKey is required." }, 400);
  if (!VALID_TYPES.has(ruleType)) return c.json({ error: "Invalid ruleType." }, 400);
  const severity = body?.severity === "warning" ? "warning" : "error";

  const result = (await c.env.DB
    .prepare(
      `INSERT INTO validation_rules (definition_id, field_key, rule_type, params, message, severity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      body?.definitionId != null ? parseInt(body.definitionId, 10) : 0,
      fieldKey,
      ruleType,
      JSON.stringify(body?.params ?? {}),
      body?.message ? String(body.message) : null,
      severity
    )
    .run()) as any;
  const id = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "validation.rule.create", entity: "validation_rule", entityId: id });
  return c.json({ ok: true, id }, 201);
});

// DELETE /api/validation/rules/:id — remove a rule (editor+)
validationApp.delete("/rules/:id", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);
  await c.env.DB.prepare("DELETE FROM validation_rules WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// POST /api/validation/validate — run rules against a data object
validationApp.post("/validate", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const data = body?.data && typeof body.data === "object" ? body.data : {};
  const definitionId = body?.definitionId != null ? parseInt(body.definitionId, 10) : null;

  const db = c.env.DB;
  const clauses = ["1=1"];
  const binds: any[] = [];
  if (definitionId != null) {
    clauses.push("(definition_id = ? OR definition_id = 0)");
    binds.push(definitionId);
  }
  const rows = await db
    .prepare(`SELECT * FROM validation_rules WHERE ${clauses.join(" AND ")}`)
    .bind(...binds)
    .all<any>();
  const rules = (rows.results || []).map(normalizeRule);

  const violations = evaluateRules(rules as any, data);

  // Handle "unique" rules with a DB lookup.
  for (const rule of rules) {
    if (rule.ruleType === "unique") {
      const value = data[rule.fieldKey];
      if (!isEmpty(value)) {
        const existing = await db
          .prepare(
            "SELECT COUNT(*) as c FROM records WHERE json_extract(data, ?) = ? AND id <> ?"
          )
          .bind(`$.${rule.fieldKey}`, value, body?.recordId != null ? parseInt(body.recordId, 10) : -1)
          .first<any>();
        if (existing && existing.c > 0) {
          violations.push({
            field: rule.fieldKey,
            ruleType: "unique",
            severity: rule.severity,
            message: rule.message || `${rule.fieldKey} must be unique.`,
          });
        }
      }
    }
  }

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warning");
  return c.json({ valid: errors.length === 0, errors, warnings });
});

function normalizeRule(row: any) {
  return {
    id: row.id,
    definitionId: row.definition_id,
    fieldKey: row.field_key,
    ruleType: row.rule_type,
    params: typeof row.params === "string" ? safeJson(row.params) : row.params,
    message: row.message,
    severity: row.severity,
  };
}

function safeJson(v: any) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}
