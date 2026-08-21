import type { Context } from "hono";
import type { AuthResult } from "./security";

export interface Session {
  authenticated: boolean;
  username?: string;
}

export interface AppBindings {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
  APP_USERNAME: string;
  APP_PASSWORD_HASH: string;
  SESSION_SECRET: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: R2Bucket;
  GROQ_API_KEY?: string;
  API_BACKEND_URL?: string;
}

export interface AppVariables {
  session: Session | null;
  sessionId?: string;
  authUser?: AuthResult | null;
}

export type AppContext = Context<{ Bindings: AppBindings; Variables: AppVariables }>;
