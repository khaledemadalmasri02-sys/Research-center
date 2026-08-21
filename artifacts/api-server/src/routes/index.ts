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
import metricsRouter from "./metrics";
import backupRouter from "./backup";
import { requireAdmin } from "../middlewares/requireAdmin";
import { authenticateApiToken } from "../lib/apiToken";

const router: IRouter = Router();

// Resolve Bearer API tokens into a synthetic session before any route runs.
router.use(authenticateApiToken);
router.use(authRouter);
router.use(healthRouter);
router.use(requireAuth, patientsRouter);
router.use(storageRouter);
router.use(requireAuth, voiceRouter);
router.use(requireAuth, requireAdmin, schemaRouter);
router.use(requireAuth, requireAdmin, adminRouter);
router.use(requireAuth, recordsRouter);
router.use(requireAuth, feedbackRouter);
router.use(requireAuth, auditRouter);
router.use(requireAuth, tokensRouter);
router.use(requireAuth, searchRouter);
router.use(requireAuth, savedViewsRouter);
router.use(requireAuth, notificationsRouter);
router.use(requireAuth, sessionsRouter);
router.use(requireAuth, requireAdmin, metricsRouter);
router.use(requireAuth, requireAdmin, backupRouter);

export default router;
