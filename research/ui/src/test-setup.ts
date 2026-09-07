import { vi } from "vitest";

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// framer-motion: passthrough renderer so we don't need real animations.
// motion.<tag> renders a real <tag> with animation props stripped, and
// AnimatePresence just renders its children.
vi.mock("framer-motion", () => {
  const makePassthrough = (Tag: string) =>
    ({ children, ...rest }: any) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        whileHover: _w,
        whileTap: _wt,
        variants: _v,
        layout: _l,
        ...dom
      } = rest;
      return <Tag {...dom}>{children}</Tag>;
    };
  const motionProxy = new Proxy(
    {},
    {
      get: (_t, prop: string) => makePassthrough(prop === "div" ? "div" : prop),
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => true,
  };
});
