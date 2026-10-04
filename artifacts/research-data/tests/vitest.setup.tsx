/**
 * Vitest setup for component tests.
 *
 * The real component tree pulls in heavy providers (framer-motion,
 * next-themes, react-i18next). We mock them here so individual component
 * tests can stay focused on the component under test.
 */
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Registers the DOM matchers (`toBeInTheDocument()`, `toHaveTextContent()`, ...)
// globally, including their TypeScript types. Tests were written with these
// matchers but nothing ever registered them, so every assertion using one
// failed with "Invalid Chai property".
import "@testing-library/jest-dom/vitest";

// framer-motion: replace motion.div with a passthrough div and every
// other motion.* element (e.g. motion.input) with a passthrough that
// keeps the underlying tag. AnimatePresence just renders its children.
vi.mock("framer-motion", () => {
  const makePassthrough =
    (Tag: string) =>
    ({ children, ...rest }: any) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        whileHover: _w,
        whileTap: _wt,
        variants: _v,
        ...dom
      } = rest;
      return <Tag {...dom}>{children}</Tag>;
    };

  // Component identity MUST be stable across accesses. The previous
  // implementation called `makePassthrough()` inside the Proxy `get` trap, so
  // every render of `motion.input` produced a brand-new function type. React
  // reconciles by component type, so the element was treated as a different
  // component every time: the node unmounted and remounted, keyboard focus was
  // lost on every keystroke, and any node reference a test captured before an
  // interaction became detached. That made the OTP tests assert against stale
  // DOM (`boxes[0]` then `boxes[1]` yielding "1|||||" with
  // `document.activeElement === body`) and quietly tested nothing.
  // Cache one passthrough per tag so `motion.input === motion.input`.
  const cache = new Map<string, ReturnType<typeof makePassthrough>>();
  const passthroughFor = (tag: string) => {
    let c = cache.get(tag);
    if (!c) {
      c = makePassthrough(tag);
      cache.set(tag, c);
    }
    return c;
  };

  const motionProxy = new Proxy(
    {},
    {
      get: (_t, prop: string) => passthroughFor(prop === "div" ? "div" : prop),
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    // Reduced motion is ON by default so tests never depend on animation
    // timing. Tests that need the motion-allowed branch opt in explicitly via
    // __setReducedMotion(false) — see the welcome autoplay tests.
    useReducedMotion: () => __reducedMotionState.value,
  };
});

const __reducedMotionState = { value: true };
(globalThis as any).__setReducedMotion = (on: boolean) => {
  __reducedMotionState.value = on;
};
(globalThis as any).__resetReducedMotion = () => {
  __reducedMotionState.value = true;
};

// next-themes: tests control the theme via __setNextTheme below.
const __themeState: { theme: string; setTheme: (t: string) => void } = {
  theme: "light",
  setTheme: (t) => {
    __themeState.theme = t;
  },
};
(globalThis as any).__setNextTheme = (t: string) => {
  __themeState.theme = t;
};
(globalThis as any).__nextThemeState = __themeState;
vi.mock("next-themes", () => ({
  useTheme: () => __themeState,
  ThemeProvider: ({ children }: any) => <>{children}</>,
}));

// react-i18next: t is a passthrough, useTranslation returns a working shape.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: any) => <>{children}</>,
  I18nextProvider: ({ children }: any) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(() => {
  cleanup();
  __themeState.theme = "light";
});
