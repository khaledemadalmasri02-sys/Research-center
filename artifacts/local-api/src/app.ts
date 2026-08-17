import express, { type Express, type Request } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { initDb, clearDb } from "./db/memory";
import { randomUUID } from "crypto";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
  }
}

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: Request) {
        return { id: req.id, method: req.method, url: (req.url ?? "").split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.CLEAR_DB === "true") {
  clearDb();
}
initDb();

const sessions = new Map<string, { authenticated: boolean; username: string }>();

class MemoryStore extends session.Store {
  constructor() {
    super();
  }
  get(sid: string, cb: (err: Error | null, obj?: any) => void) {
    cb(null, sessions.get(sid));
  }
  set(sid: string, obj: any, cb: (err: Error | null) => void) {
    sessions.set(sid, obj);
    cb(null);
  }
  destroy(sid: string, cb: (err: Error | null) => void) {
    sessions.delete(sid);
    cb(null);
  }
}

app.use(
  session({
    store: new MemoryStore(),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

export default app;