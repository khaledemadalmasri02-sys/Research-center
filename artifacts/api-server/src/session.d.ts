import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    userId?: number;
    username?: string;
    role?: "admin" | "editor" | "viewer" | "user";
    canAdminAccess?: boolean;
    oauthState?: { provider: "google" | "apple"; state: string; nonce: string; createdAt: number };
    /** ms epoch. Set by `establishSession`; drives the ABSOLUTE session bound. */
    createdAt?: number;
    /** ms epoch. Slid forward on every authenticated request; drives the IDLE bound. */
    lastActivityAt?: number;
    /**
     * ms epoch of the last successful `POST /auth/reauth` (password re-entry).
     * Deliberately NOT set by `establishSession`: a login is not a step-up.
     */
    reauthenticatedAt?: number;
    /** Client IP at login, for the device list in `GET /sessions`. */
    ip?: string;
    /** User-Agent at login, truncated, for the device list in `GET /sessions`. */
    userAgent?: string | null;
  }
}