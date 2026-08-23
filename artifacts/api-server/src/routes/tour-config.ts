import express, { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "./auth";
import { requireAdmin } from "../middlewares/requireAdmin";

export type TourSource = "animated" | "screen";

export interface TourStepConfig {
  source?: TourSource;
  screenUrl?: string;
}

export interface TourConfig {
  defaultSource: TourSource;
  steps: Record<string, TourStepConfig>;
}

const DEFAULT_CONFIG: TourConfig = { defaultSource: "animated", steps: {} };

const MEDIA_DIR =
  process.env.TOUR_MEDIA_DIR || path.join(process.cwd(), "data", "tour-media");

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".ogg", ".m4v", ".avi"]);
const EXT_CONTENT_TYPE: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogg": "video/ogg",
  ".avi": "video/x-msvideo",
};

function ensureMediaDir() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function safeFilename(name: string): string | null {
  const base = path.basename(name);
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

async function readConfig(): Promise<TourConfig> {
  const { rows } = await pool.query<{ config: TourConfig }>(
    `SELECT "config" FROM "tour_config" WHERE "id" = 1`,
  );
  if (rows.length === 0) return DEFAULT_CONFIG;
  const cfg = rows[0].config;
  return {
    defaultSource: cfg?.defaultSource === "screen" ? "screen" : "animated",
    steps: cfg?.steps && typeof cfg.steps === "object" ? cfg.steps : {},
  };
}

function sanitizeConfig(input: unknown): TourConfig {
  const cfg = (input ?? {}) as Partial<TourConfig>;
  const defaultSource: TourSource = cfg.defaultSource === "screen" ? "screen" : "animated";
  const steps: Record<string, TourStepConfig> = {};
  if (cfg.steps && typeof cfg.steps === "object") {
    for (const [key, val] of Object.entries(cfg.steps)) {
      if (typeof key !== "string" || !key) continue;
      const v = (val ?? {}) as TourStepConfig;
      const step: TourStepConfig = {};
      if (v.source === "screen" || v.source === "animated") step.source = v.source;
      if (typeof v.screenUrl === "string" && v.screenUrl) step.screenUrl = v.screenUrl.slice(0, 2000);
      steps[key] = step;
    }
  }
  return { defaultSource, steps };
}

const router = Router();

// Read the tour configuration (any authenticated user — the tour needs it).
router.get("/tour-config", requireAuth, async (_req: Request, res: Response) => {
  try {
    res.json(await readConfig());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load tour config" });
  }
});

// Save the tour configuration (admin only).
router.put("/tour-config", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const cfg = sanitizeConfig(req.body);
    await pool.query(
      `INSERT INTO "tour_config" ("id", "config") VALUES (1, $1::jsonb)
       ON CONFLICT ("id") DO UPDATE SET "config" = $1::jsonb`,
      [JSON.stringify(cfg)],
    );
    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save tour config" });
  }
});

// Upload a real screen-recording video for a step. Raw body (video bytes).
router.post(
  "/tour-config/screen",
  requireAuth,
  requireAdmin,
  // The SPA sends the File bytes directly with a video/* content type, so this
  // route parses the raw body instead of JSON/multipart.
  (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (!/^video\/|\/octet-stream|application\/octet-stream/i.test(ct)) {
      res.status(415).json({ error: "Expected a video file" });
      return;
    }
    next();
  },
  // Buffer the raw video bytes into req.body (global express.json skips non-JSON).
  express.raw({ type: () => true, limit: "80mb" }),
  async (req: Request, res: Response) => {
    try {
      const buf = (req as Request & { body?: Buffer }).body;
      if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: "Empty upload" });
        return;
      }
      const step = String((req.query.step as string) || "step").replace(/[^a-zA-Z0-9_-]/g, "");
      const ext = String((req.query.ext as string) || "mp4").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (!ALLOWED_EXT.has(`.${ext}`)) {
        res.status(400).json({ error: "Unsupported video format" });
        return;
      }
      if (buf.length > 80 * 1024 * 1024) {
        res.status(413).json({ error: "Video too large (max 80MB)" });
        return;
      }
      ensureMediaDir();
      const filename = `${step}-${randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);
      res.json({ url: `/api/tour-media/${filename}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// Serve uploaded screen recordings (public so <video> can play them).
router.get("/tour-media/:file", async (req: Request, res: Response) => {
  try {
      const name = safeFilename(String(req.params.file));
    if (!name) {
      res.status(400).json({ error: "Invalid file" });
      return;
    }
    const filePath = path.join(MEDIA_DIR, name);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ext = path.extname(name).toLowerCase();
    const contentType = EXT_CONTENT_TYPE[ext] || "application/octet-stream";
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
      const clampedEnd = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${clampedEnd}/${stat.size}`);
      res.setHeader("Content-Length", clampedEnd - start + 1);
      fs.createReadStream(filePath, { start, end: clampedEnd }).pipe(res);
    } else {
      res.setHeader("Content-Length", stat.size);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to serve media" });
  }
});

// Delete an uploaded screen recording (admin only).
router.delete(
  "/tour-media/:file",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
    const name = safeFilename(String(req.params.file));
      if (!name) {
        res.status(400).json({ error: "Invalid file" });
        return;
      }
      const filePath = path.join(MEDIA_DIR, name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Delete failed" });
    }
  },
);

export default router;
export { ensureMediaDir };
