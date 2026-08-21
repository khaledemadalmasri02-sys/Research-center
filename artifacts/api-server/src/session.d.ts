import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    userId?: number;
    username?: string;
    role?: "admin" | "editor" | "viewer" | "user";
    canAdminAccess?: boolean;
  }
}
