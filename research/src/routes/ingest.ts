import { Hono } from "hono";
import type { AppBindings, AppVariables, AppContext } from "../lib/env";
import { getAuthUser, canEdit, writeAudit } from "../lib/security";

// ---- Pure HL7 v2 parsing (exported for unit tests) ----

// Reverse HL7 field escaping (`\F\` -> `|`, etc.).
export function hl7Unescape(value: string): string {
  return String(value ?? "")
    .replace(/\\E\\/g, "\\")
    .replace(/\\F\\/g, "|")
    .replace(/\\S\\/g, "^")
    .replace(/\\T\\/g, "&")
    .replace(/\\R\\/g, "~");
}

export interface Hl7Segment {
  type: string; // e.g. "MSH", "PID"
  fields: string[]; // field[0] is the segment type
}

// Parse an HL7 v2 message (segments separated by \r or \n) into typed segments.
export function parseHl7(message: string): Hl7Segment[] {
  return message
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const fields = line.split("|");
      return { type: fields[0], fields };
    });
}

// Extract a normalized patient from PID fields (HL7 v2).
export function extractPid(fields: string[]): {
  patientId?: string;
  patientName?: string;
  dob?: string;
  sex?: string;
} {
  return {
    patientId: fields[3] ? hl7Unescape(fields[3]) : undefined,
    patientName: fields[5] ? hl7Unescape(fields[5]) : undefined,
    dob: fields[7] ? hl7Unescape(fields[7]) : undefined,
    sex: fields[8] ? hl7Unescape(fields[8]) : undefined,
  };
}

// ---- Route ----

export const ingestApp = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

// POST /api/ingest/hl7 — accept an HL7 v2 message, map PID -> a record (editor+)
ingestApp.post("/hl7", async (c: AppContext) => {
  const auth = await getAuthUser(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  if (!canEdit(auth.user)) return c.json({ error: "Forbidden" }, 403);

  let message = "";
  const ct = c.req.header("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}));
    message = typeof body?.message === "string" ? body.message : "";
  } else {
    message = await c.req.text();
  }
  if (!message.trim()) return c.json({ error: "Empty HL7 message." }, 400);

  const segments = parseHl7(message);
  const pid = segments.find((s) => s.type === "PID");
  if (!pid) return c.json({ error: "No PID segment found." }, 422);
  const patient = extractPid(pid.fields);
  if (!patient.patientId && !patient.patientName) {
    return c.json({ error: "PID has no patient identifier or name." }, 422);
  }

  // Resolve a target record definition (prefer "Patients", else the first one).
  const def = await c.env.DB
    .prepare("SELECT id FROM record_definitions WHERE name = 'Patients' LIMIT 1")
    .bind()
    .first<any>();
  let defId = def?.id;
  if (!defId) {
    const any = await c.env.DB.prepare("SELECT id FROM record_definitions ORDER BY id LIMIT 1").bind().first<any>();
    defId = any?.id;
  }
  if (!defId) return c.json({ error: "No record definition available." }, 409);

  const data = {
    patientId: patient.patientId ?? "",
    patientName: patient.patientName ?? "",
    dob: patient.dob ?? "",
    sex: patient.sex ?? "",
    source: "hl7",
  };
  const result = (await c.env.DB
    .prepare("INSERT INTO records (user_id, definition_id, data) VALUES (?, ?, ?)")
    .bind(auth.user.id, defId, JSON.stringify(data))
    .run()) as any;
  const recordId = result?.meta?.last_row_id;
  await writeAudit(c, { userId: auth.user.id, action: "ingest.hl7", entity: "record", entityId: recordId });
  return c.json({ ok: true, recordId, patient }, 201);
});
