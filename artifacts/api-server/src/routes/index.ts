import { Router, type IRouter } from "express";
import healthRouter from "./health";
import patientsRouter from "./patients";
import storageRouter from "./storage";
import authRouter from "./auth";
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
import crashReportRouter from "./crash-report";
import gdprRouter from "./gdpr";
import { authenticateApiToken } from "../lib/apiToken";

const router: IRouter = Router();

// Resolve Bearer API tokens into a synthetic session before any route runs.
router.use(authenticateApiToken);

// ─────────────────────────────────────────────────────────────────────────────
// MOUNT ORDER IS NOT AN AUTHENTICATION MECHANISM.
//
// This file previously mounted most sub-routers as `router.use(requireAuth, x)`.
// That form does NOT scope the guard to `x`. Express's
// `Router.prototype.use(handler)` (router@2.2.0/lib/index.js) creates ONE layer
// per callback at path "/" with `end: false`, so the leading `requireAuth`
// became a layer that matches EVERY request reaching this point in the stack —
// including requests no sub-router below it handles. Consequences:
//
//   * a request whose path matched no sub-router got 401 from the gate instead
//     of 404 from Express (the gate swallowed the fall-through), and
//   * any route mounted after the first `requireAuth` line inherited a session
//     gate it had never asked for.
//
// `GET /api/tour-media/:file` (public, so <video> can play a recording) and the
// OAuth callback fall-through are the visible casualties.
//
// So: authentication is applied PER ROUTE, explicitly, inside each route file
// (`requireAuth`, `requireAuth, requireAdmin`, `requireAuth, requireEdit`,
// `requireAdmin`+inline checks). See routes/admin.ts, routes/schema.ts,
// routes/metrics.ts and routes/tour-config.ts for that pattern, and
// test/route-auth-policy.test.ts for the allowlist that fails the build when a
// new route is added with no guard and no allowlist entry.
//
// DO NOT reintroduce `router.use(requireAuth, ...)` here, and do not rely on
// mount position to keep a public route public.
// ─────────────────────────────────────────────────────────────────────────────

router.use(authRouter); // public: login, signup, otp, oauth, /me, /logout
router.use(healthRouter); // public: GET /healthz
// Crash-report receiver is unauthenticated by design (the user can't log in if
// the app is broken) and the payload carries no PII. Rate limiting is at the
// Worker layer.
router.use(crashReportRouter); // public: POST /crash-report
// GDPR erasure for the Postgres PHI store. NOT session-gated: it is called by
// the `research` Worker, which authenticates with a shared secret
// (ERASURE_SECRET / INBOUND_EMAIL_SECRET) compared in constant time inside the
// route. See src/routes/gdpr.ts for the response contract.
router.use(gdprRouter); // secret-gated: DELETE /gdpr/erasure/:patientId
// Inbound email from Cloudflare Email Routing is authenticated by a shared
// secret (not a session).
router.use("/inbound-email", inboundEmailRouter); // secret-gated: POST /

router.use(patientsRouter);
router.use(storageRouter);
router.use(voiceRouter);
router.use(schemaRouter);
router.use(adminRouter);
router.use(recordsRouter);
router.use(feedbackRouter);
router.use(auditRouter);
router.use(tokensRouter);
router.use(searchRouter);
router.use(savedViewsRouter);
router.use(notificationsRouter);
router.use(sessionsRouter);
router.use(collectionsRouter);
router.use(analysisRouter);
// Tour config: config read = any authed user, save/upload/delete = admin,
// media serve = public.
router.use(tourConfigRouter);
router.use(metricsRouter);
router.use(backupRouter);

export default router;