import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { rateLimit, clientIp } from "../lib/security";

/**
 * Crash-report receiver.
 *
 * The frontend ErrorBoundary and the global `error`/
 * `unhandledrejection` handlers POST a structured payload here.
 * We just log it to pino for now; the shape is Sentry-compatible
 * so a future switch to Sentry is one-line.
 *
 * Why this route is unauthenticated:
 *   - The user can't log in if the app is broken.
 *   - The payload is anonymous by design: it carries the user agent
 *     and a stack trace, but no user ID, no PII.
 *
 * Rate limiting (A18): the previous comment claimed "rate limiting happens at
 * the Worker layer" — there is no such rate limit, and this endpoint is
 * mounted outside `requireAuth`, so anyone could flood the log pipeline (and
 * the pino transport behind it) with arbitrary payloads. There is now a
 * per-IP budget here as well.
 */
const CRASH_REPORT_LIMIT = 20; // per IP per 15 min — a render loop can fire
const CRASH_REPORT_WINDOW_MS = 15 * 60 * 1000; // several; a flood cannot.

const router: IRouter = Router();

// Schema is permissive: the frontend is a moving target and we
// don't want a schema bump to silently drop crash reports.
const CrashReportBody = z
  .object({
    kind: z.string().max(32).optional(),
    message: z.string().max(2000),
    stack: z.string().max(20_000).optional(),
    componentStack: z.string().max(20_000).optional(),
    url: z.string().max(2000).optional(),
    userAgent: z.string().max(2000).optional(),
    ts: z.string().max(64).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

router.post("/crash-report", (req: Request, res: Response) => {
  const limit = rateLimit(
    `crash-report:${clientIp(req)}`,
    CRASH_REPORT_LIMIT,
    CRASH_REPORT_WINDOW_MS,
  );
  if (!limit.success) {
    res.set("Retry-After", String(limit.retryAfterSec));
    res.status(429).json({ error: "Too many crash reports. Try again later." });
    return;
  }

  const parsed = CrashReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid crash report" });
    return;
  }
  const c = parsed.data;
  // Pino will JSON-encode the structured fields. The Sentry-compatible
  // fields are intentionally first-class in the log line.
  logger.error(
    {
      crash: {
        kind: c.kind ?? "unknown",
        url: c.url,
        userAgent: c.userAgent,
        ts: c.ts,
        componentStack: c.componentStack,
        context: c.context,
      },
      msg: c.message,
      stack: c.stack,
    },
    "frontend crash report",
  );
  res.status(204).end();
});

export default router;