import { Hono } from "hono";
import type { AppBindings, AppVariables } from "../src/lib/env";
import { consentApp } from "../src/routes/consent";
import { deidentifyApp } from "../src/routes/deidentify";
import { recordVersionsApp } from "../src/routes/recordVersions";
import { recordVerifyApp } from "../src/routes/recordVerify";
import { codingApp } from "../src/routes/coding";
import { cohortApp } from "../src/routes/cohort";
import { validationApp } from "../src/routes/validation";
import { dicomApp } from "../src/routes/dicom";
import { exportApp } from "../src/routes/export";
import { studiesApp } from "../src/routes/studies";
import { mlApp } from "../src/routes/ml";
import { reportsApp } from "../src/routes/reports";
import { gdprApp } from "../src/routes/gdpr";
import { ingestApp } from "../src/routes/ingest";
import { searchApp, savedViewsApp } from "../src/routes/search";
import { auditApp } from "../src/routes/audit";

export interface FakeResponse {
  results?: any[];
  first?: any;
  lastRowId?: number;
  changes?: number;
}

// A scriptable fake D1. Rather than parsing SQL, it returns canned responses
// matched by SQL substring via `responder`, which tests configure per case.
// This validates routing, RBAC, input validation and response shapes without
// a real database (real SQL correctness is covered by live `wrangler` tests).
export class FakeD1 {
  public calls: { sql: string; binds: any[] }[] = [];
  public responder: (sql: string, binds: any[]) => FakeResponse = () => ({});

  prepare(sql: string) {
    const stmt: any = {
      _binds: [] as any[],
      bind: (...binds: any[]) => {
        stmt._binds = binds;
        return stmt;
      },
      run: () => {
        this.calls.push({ sql, binds: stmt._binds });
        const r = this.responder(sql, stmt._binds);
        return { meta: { last_row_id: r.lastRowId ?? 1, changes: r.changes ?? 0 } };
      },
      all: () => {
        this.calls.push({ sql, binds: stmt._binds });
        const r = this.responder(sql, stmt._binds);
        return { results: r.results ?? [] };
      },
      first: () => {
        this.calls.push({ sql, binds: stmt._binds });
        const r = this.responder(sql, stmt._binds);
        return r.first ?? null;
      },
    };
    return stmt;
  }
}

export function makeApp() {
  const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>({
    strict: false,
  });
  app.onError((err, c) => {
    console.error("[test app error]", err);
    return c.text("Internal Server Error", 500);
  });
  app.route("/api/consent", consentApp);
  app.route("/api/deidentify", deidentifyApp);
  app.route("/api/record-versions", recordVersionsApp);
  app.route("/api/record-verify", recordVerifyApp);
  app.route("/api/codings", codingApp);
  app.route("/api/cohort", cohortApp);
  app.route("/api/validation", validationApp);
  app.route("/api/dicom", dicomApp);
  app.route("/api/export", exportApp);
  app.route("/api/studies", studiesApp);
  app.route("/api/ml", mlApp);
  app.route("/api/reports", reportsApp);
  app.route("/api/gdpr", gdprApp);
  app.route("/api/ingest", ingestApp);
  app.route("/api/search", searchApp);
  app.route("/api/saved-views", savedViewsApp);
  app.route("/api/audit", auditApp);
  return app;
}

export function makeEnv(db: FakeD1): AppBindings {
  return {
    DB: db as any,
    SESSIONS: {} as any,
    ASSETS: {
      fetch: () => Promise.resolve(new Response("not found", { status: 404 })),
    } as any,
    APP_USERNAME: "test",
    APP_PASSWORD_HASH: "",
    SESSION_SECRET: "test-secret",
  } as unknown as AppBindings;
}

export const adminUser = {
  id: 1,
  username: "admin",
  fullName: null,
  email: null,
  role: "admin",
  canAdminAccess: true,
  status: "active",
};

export const editorUser = {
  id: 2,
  username: "editor",
  fullName: null,
  email: null,
  role: "editor",
  canAdminAccess: false,
  status: "active",
};

export const viewerUser = {
  id: 3,
  username: "viewer",
  fullName: null,
  email: null,
  role: "viewer",
  canAdminAccess: false,
  status: "active",
};
