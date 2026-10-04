import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RefObject } from "react";

/**
 * Regression cover for the desktop shell's motion work.
 *
 * WHY A LOCAL framer-motion MOCK: `tests/vitest.setup.tsx` (not mine to edit)
 * replaces `motion.*` with a passthrough and exposes only `motion`,
 * `AnimatePresence` and `useReducedMotion` — which is enough for every page
 * component but NOT for `Window.tsx`, which imports `useDragControls` and
 * `useMotionValue`. Rendering a window under the shared mock throws. So this file
 * installs its own, strictly more capable mock: same passthrough idea, plus the
 * drag/motion-value hooks, plus per-element control of the reduced-motion
 * signal so the `prefers-reduced-motion` branches are actually exercised
 * instead of being the suite-wide default.
 *
 * The `motion` passthrough resolves `MotionValue`s inside `style` to their
 * current number, because the shared mock would otherwise hand a live object to
 * React's style serialiser.
 */
vi.mock("framer-motion", async () => {
  const { createElement, Fragment } = await import("react");

  const ANIMATION_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "whileHover",
    "whileTap",
    "whileDrag",
    "whileInView",
    "variants",
    "layout",
    "layoutId",
    "drag",
    "dragListener",
    "dragControls",
    "dragMomentum",
    "dragConstraints",
    "dragElastic",
    "onDragStart",
    "onDrag",
    "onDragEnd",
    "onAnimationStart",
    "onAnimationComplete",
    "onUpdate",
  ]);

  const resolveStyle = (style: unknown) => {
    if (!style || typeof style !== "object") return style;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
      if (key === "transformOrigin") continue;
      out[key] =
        value && typeof value === "object" && typeof (value as { get?: unknown }).get === "function"
          ? (value as { get: () => unknown }).get()
          : value;
    }
    return out;
  };

  const makePassthrough = (tag: string) => {
    const Cached = ({ children, style, ...rest }: Record<string, unknown>) => {
      const dom: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (ANIMATION_PROPS.has(key)) continue;
        dom[key] = value;
      }
      return createElement(tag, { ...dom, style: resolveStyle(style) }, children as never);
    };
    Cached.displayName = `motion.${tag}`;
    return Cached;
  };

  const cache = new Map<string, ReturnType<typeof makePassthrough>>();
  const motionProxy = new Proxy(
    {},
    { get: (_t, prop: string) => {
      if (!cache.has(prop)) cache.set(prop, makePassthrough(prop));
      return cache.get(prop);
    } },
  );

  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: unknown }) => createElement(Fragment, null, children as never),
    useReducedMotion: () => (globalThis as { __desktopReduced?: boolean }).__desktopReduced === true,
    useDragControls: () => ({ start: () => {} }),
    useMotionValue: (initial: number) => ({
      get: () => initial,
      set: () => {},
      on: () => () => {},
    }),
  };
});

import {
  WindowStoreProvider,
  useDesktopActions,
  useDesktopState,
} from "@/components/desktop/window-store";
import { Window } from "@/components/desktop/Window";
import { Dock } from "@/components/desktop/Dock";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { getApp } from "@/components/desktop/app-registry";
import { staggerFor } from "@/components/desktop/desktop-motion";
import {
  clearDockAnchors,
  getDockAnchor,
  measureAllDockAnchors,
  setDockAnchor,
} from "@/components/desktop/dock-anchor";

const MINIMIZE_FLIGHT_MS = 400;

const setReducedMotion = (on: boolean) => {
  (globalThis as { __desktopReduced?: boolean }).__desktopReduced = on;
};

function Harness({ areaRef }: { areaRef: RefObject<HTMLDivElement | null> }) {
  const actions = useDesktopActions();
  const { windows, activeId } = useDesktopState();
  return (
    <>
      <button type="button" data-testid="open" onClick={() => actions.open("home")}>
        open
      </button>
      <button type="button" data-testid="open-second" onClick={() => actions.open("feedback")}>
        open second
      </button>
      <button
        type="button"
        data-testid="minimize"
        onClick={() => (activeId ? actions.minimize(activeId) : undefined)}
      >
        minimize
      </button>
      <button
        type="button"
        data-testid="restore"
        onClick={() => {
          const m = windows.find((w) => w.minimized);
          if (m) actions.restore(m.id);
        }}
      >
        restore
      </button>
      <div ref={areaRef} data-testid="area">
        {windows.map((w) => {
          const app = getApp(w.appId);
          if (!app) return null;
          return <Window key={w.id} win={w} app={app} areaRef={areaRef} />;
        })}
      </div>
    </>
  );
}

function renderShell() {
  const areaRef = createRef<HTMLDivElement>();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <WindowStoreProvider>
        <Harness areaRef={areaRef} />
      </WindowStoreProvider>
    </QueryClientProvider>,
  );
  return { ...utils, areaRef };
}

function renderDock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WindowStoreProvider>
        <Harness areaRef={createRef<HTMLDivElement>()} />
        <Dock onOpenLauncher={() => {}} />
      </WindowStoreProvider>
    </QueryClientProvider>,
  );
}

const winEl = (id?: string) =>
  document.querySelector<HTMLElement>(id ? `[data-window-id="${id}"]` : "[data-window-id]")!;

beforeEach(() => {
  window.localStorage.clear();
  clearDockAnchors();
  setReducedMotion(true);
});

afterEach(() => {
  setReducedMotion(true);
  vi.useRealTimers();
  window.localStorage.clear();
  clearDockAnchors();
});

/* -------------------------------------------------------------------------- */

describe("window a11y contract survives the motion rewrite", () => {
  it("keeps role=group + aria-roledescription=window and never uses aria-modal", () => {
    renderShell();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    const el = winEl();
    expect(el).toHaveAttribute("role", "group");
    expect(el).toHaveAttribute("aria-roledescription", "window");
    expect(el).not.toHaveAttribute("aria-modal");
    expect(el.getAttribute("aria-labelledby")).toBeTruthy();
    // `zIndex` must stay on the DOM element, not only in the store.
    expect(Number(el.style.zIndex)).toBeGreaterThanOrEqual(100);
  });

  it("marks the unfocused window inert + aria-hidden and the focused one neither", () => {
    renderShell();
    const open = document.querySelector<HTMLButtonElement>('[data-testid="open"]')!;
    act(() => open.click());
    act(() => open.click());
    const wins = Array.from(document.querySelectorAll<HTMLElement>("[data-window-id]"));
    // `home` is a singleton, so the second click focuses the same window.
    expect(wins).toHaveLength(1);
    expect(wins.filter((w) => w.getAttribute("aria-hidden") !== "true")).toHaveLength(1);
    expect(wins.filter((w) => w.hasAttribute("inert"))).toHaveLength(0);

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open-second"]')!.click();
    });
    const after = Array.from(document.querySelectorAll<HTMLElement>("[data-window-id]"));
    expect(after).toHaveLength(2);
    expect(after.filter((w) => w.getAttribute("aria-hidden") === "true")).toHaveLength(1);
    expect(after.filter((w) => w.hasAttribute("inert"))).toHaveLength(1);
  });

  it("applies inert + aria-hidden to a minimized window immediately, before the flight", () => {
    setReducedMotion(false);
    renderShell();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="minimize"]')!.click();
    });
    const el = winEl();
    // The store flip and the a11y attributes land on the SAME commit: the
    // live-region announcement must never outrun the DOM change.
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("inert");
    expect(el.style.pointerEvents).toBe("none");
  });
});

/* -------------------------------------------------------------------------- */

describe("minimize paint timing", () => {
  it("keeps the window painted for the flight when motion is allowed", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    renderShell();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="minimize"]')!.click();
    });
    expect(winEl().style.visibility).toBe("visible");
    act(() => {
      vi.advanceTimersByTime(MINIMIZE_FLIGHT_MS + 20);
    });
    expect(winEl().style.visibility).toBe("hidden");
  });

  it("hides a minimized window on the same commit under reduced motion", () => {
    vi.useFakeTimers();
    renderShell();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="minimize"]')!.click();
    });
    expect(winEl().style.visibility).toBe("hidden");
  });

  it("un-hides on restore in the same commit, not after the flight", () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    renderShell();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="minimize"]')!.click();
    });
    act(() => {
      vi.advanceTimersByTime(MINIMIZE_FLIGHT_MS + 20);
    });
    expect(winEl().style.visibility).toBe("hidden");
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="restore"]')!.click();
    });
    expect(winEl().style.visibility).toBe("visible");
  });

  it("hides a window that hydrates already-minimized on the first frame", () => {
    window.localStorage.setItem(
      "ubuntu-desktop-windows-v1",
      JSON.stringify({
        version: 2,
        windows: [
          {
            id: "home-1",
            appId: "home",
            x: 10,
            y: 10,
            w: 800,
            h: 600,
            zIndex: 11,
            minimized: true,
            maximized: false,
          },
        ],
        activeId: null,
        nextZ: 12,
        seq: 1,
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WindowStoreProvider>
          <Harness areaRef={createRef<HTMLDivElement>()} />
        </WindowStoreProvider>
      </QueryClientProvider>,
    );
    expect(winEl("home-1").style.visibility).toBe("hidden");
    expect(winEl("home-1")).toHaveAttribute("aria-hidden", "true");
  });
});

/* -------------------------------------------------------------------------- */

describe("dock running vs focused", () => {
  it("marks the focused app with the accent pill", () => {
    renderDock();
    expect(
      document.querySelector<HTMLButtonElement>('[data-dock-app-id="home"]')!.className,
    ).not.toContain("rail-icon-active");
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    expect(
      document.querySelector<HTMLButtonElement>('[data-dock-app-id="home"]')!.className,
    ).toContain("rail-icon-active");
  });

  it("keeps a running-but-unfocused app visually distinct", () => {
    renderDock();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    // Focus a second app, so `home` is running and unfocused.
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-dock-app-id="feedback"]')!.click();
    });
    const home = document.querySelector<HTMLButtonElement>('[data-dock-app-id="home"]')!;
    expect(home.className).not.toContain("rail-icon-active");
    expect(home.className).toContain("bg-black/5");
    // …and the newly focused one is marked.
    expect(
      document.querySelector<HTMLButtonElement>('[data-dock-app-id="feedback"]')!.className,
    ).toContain("rail-icon-active");
  });

  it("renders an indicator only for apps that are running, and keeps it while minimized", () => {
    renderDock();
    const dotOf = (appId: string) =>
      document
        .querySelector<HTMLElement>(`[data-dock-app-id="${appId}"]`)
        ?.querySelector("span.h-1.w-5");
    expect(dotOf("home")).toBeNull();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();
    });
    expect(dotOf("home")).not.toBeNull();
    // The old code dropped the dot entirely in expanded mode, so "minimized"
    // and "not running" looked identical.
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="minimize"]')!.click();
    });
    expect(dotOf("home")).not.toBeNull();
  });

  it("keeps every data-tour target and the launcher hook the tour needs", () => {
    renderDock();
    expect(document.querySelector('[data-dock-app-id="home"]')).not.toBeNull();
    expect(
      document.querySelector('[data-dock-app-id="home"]')?.getAttribute("data-tour"),
    ).toBe("dashboard");
    expect(document.querySelector("[data-launcher-trigger]")).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("stagger cap", () => {
  it("never pushes the last item past the budget, whatever the count", () => {
    for (const count of [2, 6, 12, 40, 120, 1000]) {
      const gap = staggerFor(count, 0.05, 0.2);
      expect((count - 1) * gap).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  it("returns 0 for a single item", () => {
    expect(staggerFor(1, 0.05, 0.2)).toBe(0);
    expect(staggerFor(0, 0.05, 0.2)).toBe(0);
  });

  it("uses the ideal gap for short lists", () => {
    expect(staggerFor(3, 0.05, 0.2)).toBeCloseTo(0.05);
  });
});

/* -------------------------------------------------------------------------- */

describe("dock anchor registry", () => {
  it("round-trips a published rect and ignores sub-pixel jitter", () => {
    setDockAnchor("home", { left: 10, top: 20, width: 44, height: 44 });
    expect(getDockAnchor("home")).toEqual({ left: 10, top: 20, width: 44, height: 44 });
    setDockAnchor("home", { left: 10.2, top: 20.1, width: 44, height: 44 });
    expect(getDockAnchor("home")?.left).toBe(10);
    setDockAnchor("home", { left: 12, top: 20, width: 44, height: 44 });
    expect(getDockAnchor("home")?.left).toBe(12);
    setDockAnchor("home", null);
    expect(getDockAnchor("home")).toBeNull();
  });

  it("refuses to publish a zero-size rect (a hidden dock must not become (0,0))", () => {
    renderDock();
    measureAllDockAnchors();
    // jsdom reports zero-size rects, so nothing is published.
    expect(getDockAnchor("home")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("wallpaper cross-fade", () => {
  it("paints one layer, then keeps the outgoing layer while the new one fades in", () => {
    setReducedMotion(false);
    const a = "linear-gradient(135deg, #111 0%, #222 100%)";
    const b = "linear-gradient(135deg, #333 0%, #444 100%)";
    const { container, rerender } = render(<Wallpaper background={a} />);
    const layers = () =>
      Array.from(container.querySelectorAll<HTMLElement>("[aria-hidden='true'] > div"));
    expect(layers()).toHaveLength(1);
    expect(layers()[0].getAttribute("style")).toContain("gradient");
    rerender(<Wallpaper background={b} />);
    expect(layers()).toHaveLength(2);
    // Newest first, and both are painted: the outgoing layer must stay under
    // the incoming one or the cross-fade flashes through to nothing.
    const painted = layers().map((el) => el.getAttribute("style") ?? "");
    expect(painted[0]).not.toBe(painted[1]);
    expect(painted.every((style) => style.includes("gradient"))).toBe(true);
  });

  it("collapses to a single layer under reduced motion", () => {
    setReducedMotion(true);
    const a = "linear-gradient(135deg, #111 0%, #222 100%)";
    const b = "linear-gradient(135deg, #333 0%, #444 100%)";
    const { container, rerender } = render(<Wallpaper background={a} />);
    rerender(<Wallpaper background={b} />);
    expect(container.querySelectorAll("[aria-hidden='true'] > div")).toHaveLength(1);
  });
});