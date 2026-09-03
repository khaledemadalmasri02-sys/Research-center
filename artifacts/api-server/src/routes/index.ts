import { Router, type IRouter } from "express";
import healthRouter from "./health";
import patientsRouter from "./patients";
import storageRouter from "./storage";
import authRouter, { requireAuth } from "./auth";
import voiceRouter from "./voice";
import schemaRouter from "./schema";
import adminRouter from "./admin";
import recordsRouter from "./records";
import feedbackRouter from "./feedback";
import auditRouter from "./audit";
import tokensRouter from "./tokens";
import searchRouter from "./search";
import savedViewsRouter from "./saved-views";
import notificationsRouter from "./notifications";
import sessionsRouter from "./sessions";
import collectionsRouter from "./collections";
import metricsRouter from "./metrics";
import backupRouter from "./backup";
import analysisRouter from "./analysis";
import tourConfigRouter from "./tour-config";
import inboundEmailRouter from "./inbound-email";
import { authenticateApiToken } from "../lib/apiToken";

const router: IRouter = Router();

// Resolve Bearer API tokens into a synthetic session before any route runs.
router.use(authenticateApiToken);
router.use(authRouter);
router.use(healthRouter);
router.use(requireAuth, patientsRouter);
router.use(storageRouter);
router.use(requireAuth, voiceRouter);
// NOTE: `requireAdmin` is applied INSIDE schemaRouter/adminRouter/metricsRouter/
// backupRouter (via `router.use(requireAdmin)` at the top of each file), NOT here.
// Mounting it at this level with no path would register it as a root middleware on
// the whole API router, leaking the admin gate onto every route mounted after it
// (records, feedback, audit, tokens, etc.) and blocking non-admin users.
router.use(requireAuth, schemaRouter);
router.use(requireAuth, adminRouter);
router.use(requireAuth, recordsRouter);
router.use(requireAuth, feedbackRouter);
router.use(requireAuth, auditRouter);
router.use(requireAuth, tokensRouter);
router.use(requireAuth, searchRouter);
router.use(requireAuth, savedViewsRouter);
router.use(requireAuth, notificationsRouter);
router.use(requireAuth, sessionsRouter);
router.use(requireAuth, collectionsRouter);
router.use(requireAuth, analysisRouter);
// Tour config: each route enforces its own auth (config read = any authed user,
// save/upload/delete = admin, media serve = public). Do NOT wrap in requireAuth
// here or the public /api/tour-media GET would be blocked.
router.use(tourConfigRouter);
router.use(requireAuth, metricsRouter);
router.use(requireAuth, backupRouter);
// Inbound email from Cloudflare Email Routing is authenticated by a shared
// secret (not a session), so it is mounted outside the requireAuth gates.
router.use("/inbound-email", inboundEmailRouter);

export default router;
