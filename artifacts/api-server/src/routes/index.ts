import { Router, type IRouter } from "express";
import healthRouter from "./health";
import patientsRouter from "./patients";
import storageRouter from "./storage";
import authRouter, { requireAuth } from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(requireAuth, patientsRouter);
router.use(requireAuth, storageRouter);

export default router;
