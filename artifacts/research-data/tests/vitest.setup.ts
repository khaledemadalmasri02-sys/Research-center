/**
 * Vitest setup for component tests.
 *
 * The real component tree pulls in heavy providers (framer-motion,
 * next-themes, react-i18next). We mock them here so individual component
 * tests can stay focused on the component under test.
 */
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// framer-motion: replace motion.div with a passthrough div and every
// other motion.* element (e.g. motion.input) with a passthrough that
// keeps the underlying tag. AnimatePresence just renders its children.
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
