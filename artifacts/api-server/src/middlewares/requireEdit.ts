import { type Request, type Response, type NextFunction } from "express";

// Blocks users whose role is "viewer" from mutating data. Admins and editors pass.
export function requireEdit(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated && req.session.role && req.session.role !== "viewer") {
    next();
    return;
  }
  res.status(403).json({ error: "Edit permission required." });
}
