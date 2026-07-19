import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

type AppUser = { username: string; hash: string };

function loadUsers(): AppUser[] {
  // Prefer APP_USERS (JSON array) for multi-user support.
  // Fall back to legacy single-user APP_USERNAME / APP_PASSWORD_HASH env vars.
  if (process.env.APP_USERS) {
    try {
      return JSON.parse(process.env.APP_USERS) as AppUser[];
    } catch {
      // fall through to legacy
    }
  }
  const username = process.env.APP_USERNAME;
  const hash = process.env.APP_PASSWORD_HASH;
  if (username && hash) return [{ username, hash }];
  return [];
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  const valid = user ? await bcrypt.compare(password, user.hash) : false;

  if (!valid) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  req.session.authenticated = true;
  req.session.username = username;
  res.json({ ok: true, username });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req: Request, res: Response) => {
  if (req.session.authenticated) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

export default router;
