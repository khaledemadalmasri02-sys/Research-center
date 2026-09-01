// Tests for the pre-send unsubscribe guard. Runs with Node's built-in test
// runner (`node:test`) via tsx — no extra dependencies.
//
//   cd artifacts/api-server
//   npx tsx --test scripts/test-unsubscribe-guard.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  checkUnsubscribed,
  _resetUnsubscribeCache,
} from "../src/lib/unsubscribeGuard";

interface StubResponse {
  status: number;
  body: unknown;
  delayMs?: number;
}

function startStub(responses: StubResponse[]): Promise<{ server: Server; url: string; calls: { path: string }[] }> {
  const calls: { path: string }[] = [];
  const server = createServer((req, res) => {
    calls.push({ path: req.url ?? "" });
    const r = responses.shift() ?? { status: 500, body: { error: "no stub" } };
    const finish = () => {
      res.statusCode = r.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(r.body));
    };
    if (r.delayMs) setTimeout(finish, r.delayMs);
    else finish();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("returns true when no lookup URL is configured (skip check)", async () => {
  _resetUnsubscribeCache();
  const allowed = await checkUnsubscribed(
    { to: "user@example.com", category: "login-otp" },
    {},
  );
  assert.equal(allowed, true);
});

test("returns true when status is 200 and no categories are unsubscribed", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "user@example.com", unsubscribedAll: false, unsubscribedCategories: [] } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, true);
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0].path, /email=user%40example\.com/);
  } finally {
    await closeServer(stub.server);
  }
});

test("returns false when unsubscribedAll is true", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "user@example.com", unsubscribedAll: true, unsubscribedCategories: ["all"] } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, false);
  } finally {
    await closeServer(stub.server);
  }
});

test("returns false when the recipient's category matches", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "user@example.com", unsubscribedAll: false, unsubscribedCategories: ["login-otp"] } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, false);
  } finally {
    await closeServer(stub.server);
  }
});

test("returns true for a different category than the one unsubscribed", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "user@example.com", unsubscribedAll: false, unsubscribedCategories: ["admin-notification"] } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, true);
  } finally {
    await closeServer(stub.server);
  }
});

test("fails-open when the lookup returns non-2xx", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 403, body: { error: "Forbidden" } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, true);
  } finally {
    await closeServer(stub.server);
  }
});

test("fails-open when the lookup times out", async () => {
  _resetUnsubscribeCache();
  // Never respond within the 200ms window.
  const stub = await startStub([{ status: 200, body: {}, delayMs: 2_000 }]);
  try {
    const allowed = await checkUnsubscribed(
      { to: "user@example.com", category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url, MAIL_UNSUBSCRIBE_TIMEOUT_MS: "200" },
    );
    assert.equal(allowed, true);
  } finally {
    await closeServer(stub.server);
  }
});

test("caches allowed lookups for the configured TTL", async () => {
  _resetUnsubscribeCache();
  let hits = 0;
  const stub = await startStub([
    { status: 200, body: { email: "u@e.com", unsubscribedAll: false, unsubscribedCategories: [] } },
  ]);
  // Wrap the stub to count.
  const origClose = stub.server.close.bind(stub.server);
  (stub.server as any).on("request", () => hits++);
  try {
    const env = { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url, MAIL_UNSUBSCRIBE_CACHE_TTL_MS: "60000" };
    await checkUnsubscribed({ to: "u@e.com", category: "login-otp" }, env);
    await checkUnsubscribed({ to: "u@e.com", category: "login-otp" }, env);
    await checkUnsubscribed({ to: "u@e.com", category: "login-otp" }, env);
    // Only one HTTP call thanks to cache.
    assert.equal(stub.calls.length, 1);
  } finally {
    await new Promise<void>((r) => origClose(() => r()));
  }
});

test("different categories are cached separately", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "u@e.com", unsubscribedAll: false, unsubscribedCategories: [] } },
    { status: 200, body: { email: "u@e.com", unsubscribedAll: false, unsubscribedCategories: [] } },
  ]);
  try {
    const env = { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url };
    await checkUnsubscribed({ to: "u@e.com", category: "login-otp" }, env);
    await checkUnsubscribed({ to: "u@e.com", category: "signup-otp" }, env);
    assert.equal(stub.calls.length, 2);
  } finally {
    await closeServer(stub.server);
  }
});

test("recipients array: blocked if any is unsubscribed", async () => {
  _resetUnsubscribeCache();
  const stub = await startStub([
    { status: 200, body: { email: "a@e.com", unsubscribedAll: false, unsubscribedCategories: [] } },
    { status: 200, body: { email: "b@e.com", unsubscribedAll: true,  unsubscribedCategories: ["all"] } },
  ]);
  try {
    const allowed = await checkUnsubscribed(
      { to: ["a@e.com", "b@e.com"], category: "login-otp" },
      { MAIL_UNSUBSCRIBE_LOOKUP_URL: stub.url },
    );
    assert.equal(allowed, false);
  } finally {
    await closeServer(stub.server);
  }
});

// (No additional helpers — the stub setup above is self-contained.)
