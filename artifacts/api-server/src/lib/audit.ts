import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

export function clientIp(req: Request): string {
  return (req.ip as string) ?? "unknown";
}

interface AuditInput {
  action: string;
  userId?: number | null;
  entity?: string;
  entityId?: number | null;
  detail?: unknown;
  ip?: string;
}

// Fire-and-forget audit write. Never throws into the request path.
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      detail: input.detail ?? null,
      ip: input.ip ?? null,
    });
  } catch (err) {
    // Audit failures must not break the main operation.
    console.error("[audit] write failed", err);
  }
}
