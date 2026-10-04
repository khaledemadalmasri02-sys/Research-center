import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router, useLocation } from "wouter";

import { AnimatedRoutes, routePath, routeDirection } from "@/App";
import { activeMain } from "@/components/layout";

/* -------------------------------------------------------------------------- *
 * Route transition — the regression this file exists for
 *
 * `AnimatedRoutes` used to key its animated layer on `useLocation()`, i.e. the
 * FULL url including the query string. Every keystroke that reached the URL
 * therefore remounted the whole route subtree and replayed a 280ms entrance.
 * In a clinical tool that means re-running enter animations, resetting scroll
 * and dropping selection on every filter change.
 *
 * `tests/vitest.setup.tsx` mocks framer-motion with a component-identity cache
 * and `useReducedMotion()` returning true, so the default here is the reduced
 * (instant-swap) branch; `__setReducedMotion(false)` opts into the animated
 * branch. `AnimatePresence` is mocked as a plain passthrough and cannot retain
 * an exiting child, so the mid-transition overlap is asserted through the
 * attribute contract the real component sets (`data-route-state`, `inert`) and
 * through `activeMain()`, which is what focus management actually depends on.
 * -------------------------------------------------------------------------- */

const setReduced = (on: boolean) =>
  (globalThis as unknown as { __setReducedMotion?: (v: boolean) => void }).__setReducedMotion?.(on);
const resetReduced = () =>
  (globalThis as unknown as { __resetReducedMotion?: () => void }).__resetReducedMotion?.();

let mounts = 0;

/** Stands in for a page component: counts how often it is mounted fresh. */
function Page({ label }: { label: string }) {
  React.useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>{label}</h1>
    </main>
  );
}

function Nav() {
  const [, navigate] = useLocation();
  return (
    <>
      <button data-testid="go-query" onClick={() => navigate("/patients?q=smith")}>
        query
      </button>
      <button data-testid="go-query-2" onClick={() => navigate("/patients?q=smith-jones")}>
        query2
      </button>
      <button data-testid="go-hash" onClick={() => navigate("/patients#row-12")}>
        hash
      </button>
      <button data-testid="go-deep" onClick={() => navigate("/patients/12")}>
        deep
      </button>
    </>
  );
}

/**
 * A Router whose location is the FULL url.
 *
 * This is the configuration `AnimatedRoutes` has to be immune to, and the one
 * that makes the fix load-bearing rather than decorative.
 *
 * Note what wouter's default hook does today: `useBrowserLocation` returns
 * `location.pathname` (`node_modules/wouter/src/use-browser-location.js`), so
 * with `<Router base=…>` and no custom hook, `useLocation()[0]` never contained
 * a query string in the first place. The old `key={location}` therefore only
 * *looked* path-scoped. This harness removes that accident: as soon as anyone
 * swaps in a hook that reports `pathname + search + hash` — or the app adopts a
 * hash router — the old key remounts the route subtree on every filter
 * keystroke, and these tests fail.
 */
const LOCATION_EVENTS = ["popstate", "pushState", "replaceState", "hashchange"] as const;

function useFullUrlLocation(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    for (const event of LOCATION_EVENTS) window.addEventListener(event, onChange);
    return () => {
      for (const event of LOCATION_EVENTS) window.removeEventListener(event, onChange);
    };
  }, []);
  const snapshot = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const location = React.useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = React.useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
  }, []);
  return [location, navigate];
}

function Routes({ initialPath = "/patients" }: { initialPath?: string }) {
  return (
    <>
      <Nav />
      <AnimatedRoutes>
        <Page label={initialPath} />
      </AnimatedRoutes>
    </>
  );
}

function renderRoutes() {
  return render(
    <Router hook={useFullUrlLocation as never}>
      <Routes />
    </Router>,
  );
}

/** Same tree on wouter's stock pathname-only hook. */
function renderRoutesWithDefaultLocation() {
  return render(
    <Router>
      <Routes />
    </Router>,
  );
}

/** Let effects, rAF callbacks and history listeners settle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 24));
  });
}

beforeEach(() => {
  mounts = 0;
  window.history.replaceState({}, "", "/patients");
  document.documentElement.removeAttribute("dir");
});

afterEach(() => {
  resetReduced();
});

describe("routePath — the transition key", () => {
  it("drops the query string", () => {
    expect(routePath("/patients?q=smith&page=3")).toBe("/patients");
  });

  it("drops the hash", () => {
    expect(routePath("/patients#row-12")).toBe("/patients");
  });

  it("drops both", () => {
    expect(routePath("/patients?q=smith#row-12")).toBe("/patients");
  });

  it("leaves a bare path untouched", () => {
    expect(routePath("/patients/12")).toBe("/patients/12");
    expect(routePath("/")).toBe("/");
  });
});

describe("routeDirection", () => {
  it("is forward when the new route is deeper (list -> record)", () => {
    expect(routeDirection("/patients", "/patients/12")).toBe("forward");
  });

  it("is back when the new route is shallower (record -> list)", () => {
    expect(routeDirection("/patients/12/edit", "/patients")).toBe("back");
  });

  it("is neutral for the first render", () => {
    expect(routeDirection(null, "/patients")).toBe("none");
  });

  it("is neutral for a query-string-only change, so a filter never slides", () => {
    // This is the misfire guard: `/patients` -> `/patients?q=smith` is one
    // path, so it must not read as a navigation at all.
    expect(routePath("/patients?q=smith")).toBe(routePath("/patients"));
    expect(routeDirection(routePath("/patients"), routePath("/patients?q=smith"))).toBe("none");
  });

  it("is neutral between two records at the same depth", () => {
    // "Next patient" is not a deeper navigation; sliding it would lie about
    // where the user went.
    expect(routeDirection("/patients/12", "/patients/13")).toBe("none");
  });

  it("is neutral between two different sections", () => {
    expect(routeDirection("/patients", "/collections")).toBe("none");
  });
});

describe("AnimatedRoutes", () => {
  it("does NOT remount the route subtree on a query-string-only change", async () => {
    renderRoutes();
    await flush();

    const before = mounts;
    const subtreeBefore = document.getElementById("main-content");
    expect(before).toBe(1);

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query"));
    });
    await flush();

    expect(mounts).toBe(before);
    // Same DOM node, not merely the same number of mounts.
    expect(document.getElementById("main-content")).toBe(subtreeBefore);
  });

  it("does not replay the transition on a second query change either", async () => {
    renderRoutes();
    await flush();
    const before = mounts;

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query"));
    });
    await flush();
    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query-2"));
    });
    await flush();

    expect(mounts).toBe(before);
  });

  it("does not remount on a hash-only change", async () => {
    renderRoutes();
    await flush();
    const before = mounts;

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-hash"));
    });
    await flush();

    expect(mounts).toBe(before);
  });

  it("DOES remount on a real path change (the control case)", async () => {
    renderRoutes();
    await flush();
    expect(mounts).toBe(1);

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-deep"));
    });
    await flush();

    expect(mounts).toBe(2);
    expect(window.location.pathname).toBe("/patients/12");
  });

  it("marks the live layer active and focusable, never inert", async () => {
    setReduced(false);
    renderRoutes();
    await flush();

    const layer = document.querySelector("[data-route-state]");
    expect(layer?.getAttribute("data-route-state")).toBe("active");
    // An `inert` or `aria-hidden` live layer would make the page unreachable
    // by keyboard and invisible to a screen reader.
    expect(layer?.hasAttribute("inert")).toBe(false);
    expect(layer?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("also does not remount on wouter's stock pathname-only location hook", async () => {
    renderRoutesWithDefaultLocation();
    await flush();
    const before = mounts;

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query"));
    });
    await flush();

    expect(mounts).toBe(before);
  });

  it("swaps instantly under reduced motion with exactly one layer", async () => {
    // Default in vitest.setup.tsx.
    setReduced(true);
    renderRoutes();
    await flush();

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-deep"));
    });
    await flush();

    const layers = document.querySelectorAll("[data-route-state]");
    expect(layers).toHaveLength(1);
    expect(layers[0].getAttribute("data-route-state")).toBe("active");
    // No inline transform: reduced motion must not even fade.
    expect((layers[0] as HTMLElement).style.transform).toBe("");
  });
});

describe("activeMain — focus must never land on a page that is leaving", () => {
  /** Standalone DOM (no React): this is the shape AnimatePresence builds. */
  function withLayers(build: (host: HTMLElement) => void) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      build(host);
    } finally {
      host.remove();
    }
  }

  function layer(state: "active" | "exiting", host: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.setAttribute("data-route-state", state);
    if (state === "exiting") {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    }
    const main = document.createElement("main");
    main.id = "main-content";
    el.appendChild(main);
    host.appendChild(el);
    return el;
  }

  it("returns the single live #main-content", () => {
    let found: HTMLElement | null = null;
    withLayers((host) => {
      const active = layer("active", host);
      found = activeMain();
      expect(found).toBe(active.firstElementChild);
    });
    expect(found).not.toBeNull();
  });

  it("skips a #main-content inside a layer that is mid-exit", () => {
    // Reproduces the DOM `AnimatePresence` builds during the 180ms overlap:
    // the outgoing layer is still mounted and still carries its own
    // `#main-content`. `getElementById` returns THAT one — and focus would
    // die with it a frame later.
    withLayers((host) => {
      layer("exiting", host);
      const active = layer("active", host);

      expect(document.querySelectorAll("#main-content")).toHaveLength(2);
      expect(document.getElementById("main-content")).toBe(active.previousElementSibling?.firstElementChild);
      expect(activeMain()).toBe(active.firstElementChild);
    });
  });

  it("returns null when the page has no main landmark", () => {
    withLayers(() => {
      expect(activeMain()).toBeNull();
    });
  });
});

describe("scroll restoration", () => {
  /**
   * jsdom performs no layout, so a scroll box reports 0 for both
   * `scrollHeight` and `clientHeight` and the scrollable-ancestor walk would
   * find nothing. Describe the box by hand, inside React, so the reset path is
   * exercised for real instead of short-circuiting on a zero-height element.
   */
  function ScrollHost({ children }: { children: React.ReactNode }) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      Object.defineProperty(el, "scrollHeight", { value: 5000, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: 800, configurable: true });
    }, []);
    return (
      <div ref={ref} style={{ overflowY: "auto" }}>
        {children}
      </div>
    );
  }

  function renderScrolled() {
    const view = render(
      <Router hook={useFullUrlLocation as never}>
        <ScrollHost>
          <Routes />
        </ScrollHost>
      </Router>,
    );
    const scroller = view.container.firstElementChild as HTMLElement;
    return { scroller, view };
  }

  it("describes a genuinely scrollable box (guard for the two tests below)", () => {
    const { scroller } = renderScrolled();
    scroller.scrollTop = 640;
    expect(window.getComputedStyle(scroller).overflowY).toBe("auto");
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    expect(scroller.scrollTop).toBe(640);
  });

  it("returns the scroll position to the top on a path change", async () => {
    const { scroller } = renderScrolled();
    await flush();
    scroller.scrollTop = 640;

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-deep"));
    });
    await flush();

    expect(window.location.pathname).toBe("/patients/12");
    expect(scroller.scrollTop).toBe(0);
  });

  it("PRESERVES the scroll position on a query-string-only change", async () => {
    const { scroller } = renderScrolled();
    await flush();

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query"));
    });
    await flush();

    // Deep into the result set, then keep filtering. A clinician on row 400
    // must not be thrown back to row 1 by a keystroke.
    scroller.scrollTop = 640;

    await act(async () => {
      await userEvent.click(screen.getByTestId("go-query-2"));
    });
    await flush();

    expect(window.location.search).toBe("?q=smith-jones");
    expect(scroller.scrollTop).toBe(640);
  });
});
