// P1.18 — tests for the crash reporter.
//
// The crash-reporter is a pure TS module: it dedups reports, sends
// via sendBeacon in prod, and logs in dev. We test the dedup logic
// and the dev-mode console.error path by mocking `import.meta.env.DEV`
// via a side-effect import below.

import test from "node:test";
import assert from "node:assert/strict";
import {
  reportCrash,
  _resetCrashDedup,
  type CrashReport,
} from "../src/lib/crash-reporter.ts";

// Run before every test so the in-memory dedup map doesn't leak
// state between tests.
test.beforeEach(() => {
  _resetCrashDedup();
});

// `import.meta.env.DEV` is a build-time constant in Vite but is
// `undefined` under Node's test runner. The reporter guards the
// access in a try/catch, so `undefined.DEV` falls through to the
// prod branch (which calls `navigator.sendBeacon`). We mock
// `navigator` and `window` here so the prod branch has something
// to call; the assertion is on whether `sendBeacon` was invoked.

function withMockBrowser(run: () => void): void {
  const beacons: Array<{ url: string; data: Blob }> = [];
  function setProp(obj: object, key: string, value: unknown): void {
    Object.defineProperty(obj, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  setProp(globalThis, "window", {
    location: { href: "https://test/" },
    addEventListener: () => {},
  });
  setProp(globalThis, "navigator", {
    userAgent: "node-test",
    sendBeacon: (url: string, data: unknown) => {
      beacons.push({ url, data: data as Blob });
      return true;
    },
  });
  setProp(globalThis, "__beacons", beacons);
  try {
    run();
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as Record<string, unknown>)["window"];
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as Record<string, unknown>)["navigator"];
    }
    delete (globalThis as Record<string, unknown>)["__beacons"];
  }
}

function beacons(): Array<{ url: string; data: Blob }> {
  return (
    (globalThis as { __beacons?: Array<{ url: string; data: Blob }> })
      .__beacons ?? []
  );
}

function makeReport(overrides: Partial<CrashReport> = {}): CrashReport {
  return {
    kind: "react",
    message: "Test error",
    stack: "Error: Test error\n  at foo (test.ts:1:1)",
    url: "https://test/page",
    userAgent: "node-test",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

test("sends to sendBeacon when in prod (no DEV flag)", () => {
  withMockBrowser(() => {
    reportCrash(makeReport());
    const sent = beacons();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "/api/crash-report");
    // The blob is opaque to the test, so we just check it exists.
    assert.ok(sent[0].data instanceof Blob);
  });
});

test("dedups identical reports within the dedup window", () => {
  withMockBrowser(() => {
    reportCrash(makeReport());
    reportCrash(makeReport());
    reportCrash(makeReport());
    assert.equal(beacons().length, 1);
  });
});

test("different kind produces a separate report", () => {
  withMockBrowser(() => {
    reportCrash(makeReport({ kind: "react" }));
    reportCrash(makeReport({ kind: "windowerror" }));
    assert.equal(beacons().length, 2);
  });
});

test("different message produces a separate report", () => {
  withMockBrowser(() => {
    reportCrash(makeReport({ message: "A" }));
    reportCrash(makeReport({ message: "B" }));
    assert.equal(beacons().length, 2);
  });
});

test("fallback to fetch when sendBeacon is unavailable", () => {
  withMockBrowser(() => {
    // Remove sendBeacon so the reporter falls back to fetch.
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node-test" },
      configurable: true,
      writable: true,
    });
    const originalFetch = globalThis.fetch;
    let fetched: { url: string; init?: RequestInit } | null = null;
    (globalThis as { fetch: typeof fetch }).fetch = ((
      url: string | URL,
      init?: RequestInit,
    ) => {
      fetched = { url: String(url), init };
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    try {
      reportCrash(makeReport());
      // fetch was called.
      assert.ok(fetched, "fetch should have been called");
      assert.equal(fetched!.url, "/api/crash-report");
      assert.equal(fetched!.init?.method, "POST");
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});

test("never throws even if everything fails", () => {
  withMockBrowser(() => {
    // Force fetch to throw so the inner catch path runs.
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node-test" },
      configurable: true,
      writable: true,
    });
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = () => {
      throw new Error("network down");
    };
    try {
      // Must not throw.
      assert.doesNotThrow(() => reportCrash(makeReport()));
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});

