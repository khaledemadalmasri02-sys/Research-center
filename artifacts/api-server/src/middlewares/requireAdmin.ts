import { type Request, type Response, type NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated && req.session?.canAdminAccess) {
    next();
    return;
  }
  res.status(403).json({ error: "Admin access required." });
}
