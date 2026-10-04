import { vi } from "vitest";

vi.mock("framer-motion", () => {
  const passthrough =
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
        layout: _l,
        ...dom
      } = rest;
      return <Tag {...dom}>{children}</Tag>;
    };
  const proxy = new Proxy({} as any, {
    get: (_t, prop: string) => passthrough(prop === "div" ? "div" : prop),
  });
  return {
    motion: proxy,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: () => {} }),
  ThemeProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: any) => <>{children}</>,
  I18nextProvider: ({ children }: any) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isLoading: false,
    authenticated: false,
    username: null,
    role: null,
    canAdminAccess: false,
    canEdit: false,
    login: vi.fn(),
    logout: vi.fn(),
    signup: vi.fn(),
  }),
}));
