import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/voice", (_req, res) => {
  res.status(200).json({ message: "Voice placeholder" });
});

export default router;