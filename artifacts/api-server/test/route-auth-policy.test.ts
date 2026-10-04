// Regression tests for the mount-level auth gate (P0).
//
// THE BUG: `src/routes/index.ts` mounted most sub-routers as
// `router.use(requireAuth, someRouter)`. Express's `Router.prototype.use`
// (router@2.2.0/lib/index.js:362) turns EVERY callback into its own Layer at
// path "/" with `end: false`, so the leading `requireAuth` became a layer that
// matched every request reaching that point — a global gate, not a per-router
// guard. Two consequences the tests below pin down:
//
//   1. A route that matched NO sub-router was answered 401 by the gate instead
//      of falling through to Express's 404. That killed
//      `GET /api/auth/oauth/:provider/callback` (Google's callback is a GET;
//      only the Apple `form_post` POST was registered) and
//      `GET /api/tour-media/:file`, which is deliberately public so `<video>`
//      can play a screen recording.
//   2. Any route mounted after the first `requireAuth` line inherited a session
//      gate it never declared.
//
// The fix removed the mount-level gate and applied auth per route, explicitly,
// inside each route file. These tests fail if anyone reintroduces the mount
// form, adds an unguarded route without allowlisting it, or double-gates a
// route.

import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import request from "supertest";
import { withDb, type DbFixture } from "./helpers/db";
import router from "../src/routes";
import { requireAuth } from "../src/routes/auth";
import { requireAdmin } from "../src/middlewares/requireAdmin";
import { requireEdit } from "../src/middlewares/requireEdit";

// ── Router introspection ─────────────────────────────────────────────────────

/** Minimal shape of the Express 5 (router@2.x) internals we read. */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (...a: unknown[]) => unknown }>;
  };
  handle?: ((...a: unknown[]) => unknown) & { stack?: unknown[]; name?: string };
  slash?: boolean;
  path?: string;
  match?: (p: string) => boolean;
}

export interface DiscoveredRoute {
  method: string;
  /** Full path, i.e. mount prefix + the path declared in the route file. */
  path: string;
  /** The route's middleware/handler chain, in execution order. */
  handlers: Array<(...a: unknown[]) => unknown>;
}

const SESSION_GUARDS: Array<[string, (...a: unknown[]) => unknown]> = [
  ["requireAuth", requireAuth as unknown as (...a: unknown[]) => unknown],
  ["requireAdmin", requireAdmin as unknown as (...a: unknown[]) => unknown],
  ["requireEdit", requireEdit as unknown as (...a: unknown[]) => unknown],
];

/**
 * `router.use("/some/prefix", guard)` cannot be resolved from the Layer alone:
 * `Layer.path` is only populated on the first `match()` call
 * (router@2.2.0/lib/layer.js:205). We resolve it by probing.
 *
 * The probe candidates are derived from the route paths themselves — a `use`
 * prefix is always a path prefix of some route in the same router — so the
 * resolution is generic. A path-scoped layer that NO candidate matches is an
 * unrecognised mount and throws, which is the point: a new mount must fail the
 * test loudly rather than be silently mis-enumerated as unguarded.
 */
const PROBE_SUFFIX = "__route_policy_probe__";

/**
 * Path-scoped ROUTER mounts must be declared: a sub-router mounted at
 * `/inbound-email` has no route whose full path is knowable before the mount is
 * resolved, so it cannot bootstrap its own probe candidate. Everything else is
 * derived (see `probeCandidates`). Adding a second path-scoped router mount
 * requires adding it here — deliberately, so it is a reviewed decision.
 *
 * `router.use("/prefix", guard)` INSIDE a sub-router (the four /storage/*
 * prefixes) needs no declaration: those are prefixes of real route paths.
 */
const DECLARED_ROUTER_MOUNT_PATHS = ["/inbound-email"] as const;

function probeCandidates(): string[] {
  const paths = discoverRoutes({ resolvePrefixes: false }).map((r) => r.path);
  const set = new Set<string>(["/", ...DECLARED_ROUTER_MOUNT_PATHS]);
  for (const routePath of paths) {
    // "/storage/objects/*path" -> "/storage/objects/"
    const stripped = routePath.replace(/\/?[:*][^/]+/g, "");
    set.add(stripped);
    const parts = stripped.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      set.add(`/${parts.slice(0, i).join("/")}`);
    }
  }
  return [...set].filter(Boolean);
}

/** Resolve a path-scoped layer's mount point, or throw if it is unrecognised. */
function resolveMountPath(layer: RouteLayer, candidates: string[]): string {
  if (layer.slash === true) return "";
  // Pass 1 (candidates not yet known) cannot resolve prefixes; it only needs
  // the route paths, and pass 2 re-walks with prefixes resolved.
  if (candidates.length === 0) return "";
  for (const candidate of candidates) {
    if (candidate === "/") continue;
    // Probing compiles the matcher and sets `layer.path` to the matched prefix.
    if (layer.match?.(`${candidate}/${PROBE_SUFFIX}`)) {
      return (layer.path ?? "").replace(/\/$/, "");
    }
  }
  throw new Error(
    "Found a path-scoped router.use() mount that no known route path prefixes " +
      "(e.g. a new `router.use('/brand-new-prefix', guard)`). Route enumeration " +
      "cannot see its guard, so it is reported as unguarded rather than guessed.",
  );
}

type Handler = (...a: unknown[]) => unknown;

/** A `router.use(path, guard)` layer: applies to `path` and everything below it. */
interface PrefixGuard {
  match: string;
  handler: Handler;
}

/** Does a router-relative route path fall under a `use(prefix, ...)` layer? */
function underPrefix(routePath: string, prefix: string): boolean {
  if (prefix === "" || prefix === "/") return true;
  const p = prefix.replace(/\/$/, "");
  return routePath === p || routePath.startsWith(`${p}/`);
}

/**
 * Walk a router's layer stack and record every route with its FULL handler
 * chain, in execution order.
 *
 * Two things have to be modelled or the map is wrong:
 *
 *   * `router.use("/prefix", guard)` inside a sub-router. The guard is a plain
 *     function layer, not part of any route, and it applies only to routes
 *     registered *below* it whose path is under `prefix`. `storage.ts` relies
 *     on this for /storage/objects, /storage/uploads, /storage/images and
 *     /storage/ensure-bucket — which is exactly why those four prefixes must
 *     not be flattened into one blanket guard.
 *   * `router.use(subRouter)` — recursion into a nested router with an
 *     accumulated path prefix (only /inbound-email is path-scoped).
 *
 * Guards registered *after* a route are deliberately not applied: Express only
 * runs a layer for requests that reach it, so a `use` below a route cannot
 * protect that route. The sequential scan gets this right for free.
 */
function walk(
  routerLike: unknown,
  prefix: string,
  out: DiscoveredRoute[],
  candidates: string[],
  inherited: PrefixGuard[] = [],
): void {
  const stack = (routerLike as { stack?: RouteLayer[] }).stack ?? [];
  const pending: PrefixGuard[] = [...inherited];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      const guards = pending.filter((g) => underPrefix(routePath, g.match));
      const handlers = [
        ...guards.map((g) => g.handler),
        ...layer.route.stack.map((h) => h.handle),
      ];
      const methods = Object.keys(layer.route.methods).filter((m) => m !== "_all");
      for (const method of methods) {
        out.push({
          method: method.toUpperCase(),
          path: `${prefix}${routePath}`,
          handlers,
        });
      }
      continue;
    }
    const handle = layer.handle as Handler | undefined;
    if (handle && Array.isArray(handle.stack)) {
      walk(handle, `${prefix}${resolveMountPath(layer, candidates)}`, out, candidates, pending);
      continue;
    }
    if (handle) {
      pending.push({ match: resolveMountPath(layer, candidates), handler: handle });
    }
  }
}

/**
 * Two passes: the first collects route paths (treating an unresolvable mount as
 * root-mounted) so the probe candidates can be derived, the second resolves
 * prefixes properly.
 */
function discoverRoutes(opts: { resolvePrefixes: boolean } = { resolvePrefixes: true }): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = [];
  if (!opts.resolvePrefixes) {
    walk(router, "", out, [], []);
    return out;
  }
  walk(router, "", out, probeCandidates(), []);
  return out;
}

function label(route: DiscoveredRoute): string {
  return `${route.method} ${route.path}`;
}

function guardNames(route: DiscoveredRoute): string[] {
  return route.handlers
    .filter((h) => SESSION_GUARDS.some(([, g]) => g === h))
    .map((h) => SESSION_GUARDS.find(([, g]) => g === h)![0]);
}

// ── Allowlists ───────────────────────────────────────────────────────────────

/**
 * Every route reachable WITHOUT a session cookie. Adding a route means adding
 * it here (or a guard) — the "no unguarded routes" test fails otherwise.
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  // --- auth.ts: the whole point of these is to run before there is a session.
  "POST /auth/login",
  "POST /auth/signup",
  "POST /auth/signup/otp/send",
  "POST /auth/signup/otp/verify",
  "POST /auth/login/otp/send",
  "POST /auth/login/otp/verify",
  // Password recovery: both routes MUST answer identically for an unknown
  // account, so they cannot require a session.
  "POST /auth/password-reset/request",
  "POST /auth/password-reset/confirm",
  // Second factor of the login flow: runs before there is a session, exactly
  // like /auth/login/otp/verify, and is authorised by the single-use
  // `login_challenges` token the password step handed out.
  "POST /auth/mfa/verify",
  "POST /auth/mfa/recovery/verify",
  // Logout is idempotent and safe with no session (it just destroys nothing).
  "POST /auth/logout",
  // /me IS the session probe: it answers 200 {authenticated:true} or
  // 401 {authenticated:false} itself. It must never be behind requireAuth or the
  // SPA could not discover that it is logged out.
  "GET /auth/me",
  "GET /auth/oauth/:provider",
  "POST /auth/oauth/:provider/callback",
  // RFC 6749 §4.1.2 has the authorization server redirect the user-agent to the
  // redirect URI with GET `?code=…&state=…`; that is what Google actually does,
  // so the GET verb is what made social login work at all. It is not an
  // unauthenticated write: the handler requires the session-bound, 10-minute,
  // single-use `state` to match and verifies the id_token against the nonce
  // issued at authorize time via JWKS. See the comment on the registration in
  // src/routes/auth.ts. The allowlist test below is what caught this route when
  // it was first added — keep it here.
  "GET /auth/oauth/:provider/callback",
  // --- health.ts
  "GET /healthz",
  // --- crash-report.ts: unauthenticated by design (the user cannot log in if
  // the app is broken) and the payload carries no PII.
  "POST /crash-report",
  // --- tour-config.ts: public so <video> can play a screen recording.
  "GET /tour-media/:file",
]);

/**
 * Routes with NO session guard that authenticate some other way (shared secret
 * compared inside the handler). These must never be mounted behind a session
 * gate — a secret caller has no session by definition.
 */
const SECRET_AUTHENTICATED_ROUTES: ReadonlySet<string> = new Set([
  // gdpr.ts — ERASURE_SECRET / INBOUND_EMAIL_SECRET, constant-time compare.
  "DELETE /gdpr/erasure/:patientId",
  // inbound-email.ts — INBOUND_EMAIL_SECRET.
  "POST /inbound-email/",
]);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("route auth policy", () => {
  let routes: DiscoveredRoute[] = [];

  beforeAll(() => {
    routes = discoverRoutes();
  });

  describe("mount mechanism", () => {
    it("has no session guard registered at the top level of the router", () => {
      const stack = (router as unknown as { stack: RouteLayer[] }).stack;
      const gates = stack
        .filter((layer) =>
          SESSION_GUARDS.some(([, g]) => g === (layer.handle as unknown)),
        )
        .map((layer) => (layer.handle as { name?: string }).name);
      expect(gates).toEqual([]);
    });

    it("mounts every sub-router with the router alone, never `use(mw, router)`", () => {
      // `router.use(requireAuth, x)` creates two layers: a function layer
      // followed by the router layer. A function layer at the top level that is
      // not `authenticateApiToken` means the mount form is back.
      const stack = (router as unknown as { stack: RouteLayer[] }).stack;
      const middlewareMounts = stack
        .filter((l) => !l.route && l.handle && !Array.isArray(l.handle.stack))
        .map((l) => (l.handle as { name?: string }).name);
      expect(middlewareMounts).toEqual(["authenticateApiToken"]);
    });
  });

  describe("allowlist", () => {
    it("enumerates a non-empty route set (the walk actually works)", () => {
      expect(routes.length).toBeGreaterThan(40);
    });

    it("resolves the storage prefix guards rather than losing them", () => {
      // storage.ts protects four path prefixes with router.use(prefix, ...).
      // If the walk ever stopped resolving them, these routes would look
      // unguarded — so assert the resolved chain explicitly.
      const byPath = new Map(routes.map((r) => [label(r), r]));
      for (const l of [
        "GET /storage/objects/*path",
        "POST /storage/uploads/request-url",
        "POST /storage/images/search",
        "POST /storage/ensure-bucket",
      ]) {
        expect(guardNames(byPath.get(l)!)).toEqual(["requireAuth"]);
      }
      // ...and that a sibling route outside those prefixes is NOT covered by them.
      expect(guardNames(byPath.get("GET /storage/health")!)).toEqual(["requireAuth"]);
      expect(
        guardNames(byPath.get("POST /storage/upload-file")!),
      ).toEqual(["requireAuth"]);
    });

    it("has no route that is neither guarded nor allowlisted", () => {
      const ungated = routes
        .filter((r) => guardNames(r).length === 0)
        .map(label)
        .filter(
          (l) => !PUBLIC_ROUTES.has(l) && !SECRET_AUTHENTICATED_ROUTES.has(l),
        );
      expect(ungated).toEqual([]);
    });

    it("has no allowlist entry for a route that no longer exists", () => {
      const live = new Set(routes.map(label));
      const stale = [...PUBLIC_ROUTES, ...SECRET_AUTHENTICATED_ROUTES].filter(
        (l) => !live.has(l),
      );
      expect(stale).toEqual([]);
    });

    it("has no allowlist entry that is actually guarded", () => {
      // A guarded route listed as public would mean the policy was recorded
      // wrongly — the guard is what protects it, and the allowlist must not
      // become a second source of truth that silently disagrees.
      const contradictory = [...PUBLIC_ROUTES, ...SECRET_AUTHENTICATED_ROUTES]
        .map((l) => routes.find((r) => label(r) === l))
        .filter((r): r is DiscoveredRoute => !!r && guardNames(r).length > 0)
        .map(label);
      expect(contradictory).toEqual([]);
    });
  });

  describe("no double gating", () => {
    it("applies requireAuth at most once per route", () => {
      const doubled = routes
        .filter((r) => guardNames(r).filter((n) => n === "requireAuth").length > 1)
        .map(label);
      expect(doubled).toEqual([]);
    });

    it("puts requireAuth first when it is present", () => {
      // `requireAuth, requireAdmin` is the correct order (401 before 403);
      // `requireAdmin, requireAuth` would leak the existence of the route to an
      // unauthenticated caller as a 403 instead of a 401.
      const misordered = routes
        .filter((r) => {
          const names = guardNames(r);
          const i = names.indexOf("requireAuth");
          return i > 0;
        })
        .map(label);
      expect(misordered).toEqual([]);
    });

    it("never applies the same guard twice in one route", () => {
      const doubled = routes
        .filter((r) => {
          const names = guardNames(r);
          return new Set(names).size !== names.length;
        })
        .map(label);
      expect(doubled).toEqual([]);
    });

    it("gates every mutating route behind requireAuth", () => {
      const safe = new Set(["GET", "HEAD", "OPTIONS"]);
      const unguardedWrites = routes
        .filter((r) => !safe.has(r.method))
        .filter((r) => guardNames(r).length === 0)
        .map(label)
        .filter((l) => !PUBLIC_ROUTES.has(l) && !SECRET_AUTHENTICATED_ROUTES.has(l));
      expect(unguardedWrites).toEqual([]);
    });
  });
});

describe("mount gate regression — behaviour", () => {
  const t: DbFixture = withDb();

  const OAUTH_ENV = {
    GOOGLE_CLIENT_ID: "policy-test-client-id",
    GOOGLE_CLIENT_SECRET: "policy-test-secret",
    GOOGLE_REDIRECT_URI: "https://app.test/api/auth/oauth/google/callback",
    APPLE_CLIENT_ID: "policy-test-apple-id",
    APPLE_CLIENT_SECRET: "policy-test-apple-secret",
    APPLE_REDIRECT_URI: "https://app.test/api/auth/oauth/apple/callback",
  };
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [k, v] of Object.entries(OAUTH_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("serves the OAuth authorize redirect with no session instead of 401", async () => {
    const res = await request(t.app).get("/api/auth/oauth/google").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("answers the OAuth callback with the provider flow, not 401", async () => {
    // POST (Apple's form_post callback) with no stored state → the callback's
    // own 400 "Missing or invalid OAuth state.", i.e. the handler ran.
    // Before the fix this was reachable only because authRouter is mounted
    // above the gate; the gate made any *unmatched* method 401.
    const post = await request(t.app)
      .post("/api/auth/oauth/google/callback")
      .type("form")
      .send({ code: "abc", state: "whatever" })
      .redirects(0);
    expect(post.status).toBe(400);
    expect(post.body.error).toMatch(/oauth state/i);

    // GET is Google's actual callback verb (RFC 6749 §4.1.2 redirects with
    // GET `?code=…&state=…`), so it is now registered alongside POST. The point
    // of this assertion is unchanged and is the reason the bug was found: the
    // mount gate used to answer 401 for this path, which disguised a missing
    // route as an auth failure. Now the route exists and the handler itself
    // rejects the request — 400 "Missing or invalid OAuth state" — because
    // `state: "whatever"` does not match the session. What must NOT come back is
    // a 401, because that would mean a session gate is in front of it again.
    const get = await request(t.app)
      .get("/api/auth/oauth/google/callback")
      .query({ code: "abc", state: "whatever" })
      .redirects(0);
    expect(get.status).not.toBe(401);
    expect(get.status).toBe(400);
    // A genuinely unregistered path still falls through to Express's own 404,
    // which is what proves the gate is gone rather than merely relocated.
    const unknown = await request(t.app).get("/api/auth/oauth/nope/callback/extra").redirects(0);
    expect(unknown.status).toBe(404);
  });

  it("no longer answers an unmatched path with 401 from the gate", async () => {
    const res = await request(t.app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
  });

  it("serves the public tour media route with no session", async () => {
    const res = await request(t.app).get("/api/tour-media/no-such-file.mp4");
    // 404 = the route ran and looked for the file. 401 = the mount gate.
    expect(res.status).toBe(404);
  });

  it("keeps 401 on genuinely protected routes", async () => {
    const paths = [
      "/api/patients",
      "/api/patients/stats",
      "/api/records",
      "/api/records/definitions",
      "/api/collections/stats",
      "/api/search/global",
      "/api/audit",
      "/api/audit/me",
      "/api/tokens",
      "/api/sessions",
      "/api/notifications",
      "/api/tour-config",
      "/api/storage/health",
      "/api/storage/objects/radiology/x.png",
      "/api/saved-views",
    ];
    for (const path of paths) {
      const res = await request(t.app).get(path);
      expect(res.status, `GET ${path}`).toBe(401);
      expect(res.body.error, `GET ${path}`).toBe("Unauthorized");
    }
  });

  it("keeps 401 (not 403) on protected admin routes", async () => {
    // requireAdmin answers 403 on its own, so requireAuth has to run first.
    // Before the fix the mount gate supplied the 401; dropping it naively would
    // have turned these into 403s.
    for (const path of ["/api/users", "/api/signups", "/api/metrics", "/api/db/tables", "/api/feedback"]) {
      const res = await request(t.app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error, path).toBe("Unauthorized");
    }
  });

  it("keeps 401 (not 403) on protected write routes", async () => {
    const cases: Array<[string, string]> = [
      ["post", "/api/patients"],
      ["post", "/api/records"],
      ["post", "/api/feedback"],
      ["post", "/api/voice/correct"],
    ];
    for (const [method, path] of cases) {
      const agent = request(t.app);
      const res =
        method === "post" ? await agent.post(path) : await agent.get(path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body.error, `${method.toUpperCase()} ${path}`).toBe("Unauthorized");
    }
  });

  it("keeps public routes reachable for an authenticated caller", async () => {
    await t.createUser({ username: "policy-user", password: "StrongPass1!" });
    const agent = await t.loginAs("policy-user", "StrongPass1!");

    const health = await agent.get("/api/healthz");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });

    const crash = await agent.post("/api/crash-report").send({ message: "policy probe" });
    expect(crash.status).toBe(204);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.authenticated).toBe(true);

    // A session must not change the public route's status either.
    const media = await agent.get("/api/tour-media/no-such-file.mp4");
    expect(media.status).toBe(404);

    // ...and the same session still works on a protected route.
    const patients = await agent.get("/api/patients");
    expect(patients.status).toBe(200);
  });
});

describe("secret-authenticated routes are not behind a session gate", () => {
  const t: DbFixture = withDb();
  const SECRET = "policy-erasure-secret";
  let savedErasure: string | undefined;
  let savedInbound: string | undefined;

  beforeEach(() => {
    savedErasure = process.env.ERASURE_SECRET;
    savedInbound = process.env.INBOUND_EMAIL_SECRET;
    // Both secret-authenticated routes are exercised below, and each reads a
    // different variable, so both are set to the same test value.
    process.env.ERASURE_SECRET = SECRET;
    process.env.INBOUND_EMAIL_SECRET = SECRET;
  });

  afterEach(() => {
    if (savedErasure === undefined) delete process.env.ERASURE_SECRET;
    else process.env.ERASURE_SECRET = savedErasure;
    if (savedInbound === undefined) delete process.env.INBOUND_EMAIL_SECRET;
    else process.env.INBOUND_EMAIL_SECRET = savedInbound;
  });

  it("authenticates the erasure route by shared secret, not by session", async () => {
    const without = await request(t.app).delete("/api/gdpr/erasure/42");
    expect(without.status).toBe(401);
    // The secret gate answers "unauthorized" (lower-case); the session gate
    // answers "Unauthorized". Distinguishing them proves which one fired.
    expect(without.body.error).toBe("unauthorized");

    const with_ = await request(t.app)
      .delete("/api/gdpr/erasure/999999")
      .set("x-erasure-secret", SECRET);
    // Anything other than 401/403 means the secret was accepted and the route
    // ran to completion.
    expect(with_.status).not.toBe(401);
    expect(with_.status).not.toBe(403);
  });

  it("does not reject a secret-authenticated caller for want of a session", async () => {
    await t.createUser({ username: "secret-caller", password: "StrongPass1!" });
    // No session cookie at all: a bare supertest request.
    const body = { from: "a@example.test", to: "b@example.test", subject: "s", text: "b" };

    const bad = await request(t.app).post("/api/inbound-email").send(body);
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("unauthorized");

    const good = await request(t.app)
      .post("/api/inbound-email")
      .set("x-inbound-email-secret", SECRET)
      .send(body);
    // The session gate would have answered 401 "Unauthorized"; reaching the
    // handler means the secret was accepted.
    expect(good.status).toBeLessThan(400);
    expect(good.body?.error).not.toBe("Unauthorized");
  });
});
