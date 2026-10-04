import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, lazy, createContext, useContext, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ProductTour } from "@/components/product-tour";
import { CommandPalette } from "@/components/command-palette";
import { SkipToContent } from "@/components/skip-to-content";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DURATION, EASE_OUT, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";
import { initDesktopMode, useIsDesktopMode } from "@/lib/desktop-mode";
import { getThemePreset } from "@/lib/theme-presets";
import {
  Home,
  Patients,
  Login,
  Signup,
  ForgotPassword,
  ResetPassword,
   Welcome,
  Database,
  Admin,
  Collections,
  RecordDefinitionEdit,
  RecordList,
  RecordDetail,
  PatientCorridor,
  PatientWorkspace as PatientWorkspaceLoader,
  PatientRecordView,
  PatientRecordFormPage,
  NewRecordPage,
  Feedback,
  Activity,
  ActivityMe,
  ApiTokens,
  Sessions,
  NotFound,
  MoreFeatures,
  Consent,
  Deidentify,
  Coding,
  Cohort,
  ValidationPage,
  Dicom,
  ExportPage,
  Studies,
  Ml,
  Reports,
  Gdpr,
  Ingest,
  SearchPage,
  DataAnalysis,
} from "@/components/desktop/app-registry";
// MFA setup is a default export from its own page rather than a registry entry:
// it is a security-settings flow, not a dockable app, and it must never appear
// in the launcher or command palette.
import MfaSetupPage from "@/pages/mfa-setup";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Route transition
 *
 * The five defects this replaces, and what each fix is:
 *
 *  1. `key={location}` made the transition key depend on whatever the router
 *     reported. `routePath()` now truncates at the first `?`/`#`, so the key is
 *     the PATH and nothing else, and a query/hash update is a structural no-op
 *     for the transition.
 *     Honest note on the original blast radius: wouter 3.10's stock hook
 *     (`useBrowserLocation` in `node_modules/wouter/src/use-browser-location.js`)
 *     returns `location.pathname` only, so with the app's `<Router base=…>` and
 *     no custom hook, `useLocation()[0]` never actually contained a query
 *     string — the old key only LOOKED like a full-URL key. The fix removes
 *     the accident: `tests/route-transition-vitest.test.tsx` drives
 *     `AnimatedRoutes` through a Router whose hook reports
 *     `pathname + search + hash` and asserts no remount, so the invariant holds
 *     the moment anything adopts a full-URL hook or a hash router.
 *  2. `mode="wait"` serialised exit-then-enter at 0.28s + 0.28s = ~560ms of
 *     *empty* page before the next one was readable. Now `mode="popLayout"`:
 *     the new page enters while the old one is still on screen (popLayout
 *     takes the exiting layer out of flow, so the two never stack and the
 *     scroll height never doubles), and both halves run at 180ms, so the
 *     worst case is 180ms and the new page is legible from frame one.
 *  3. Not direction-aware. `routeDirection()` compares route depth, so going
 *     deeper (`/patients` -> `/patients/12`) and coming back
 *     (`/patients/12/edit` -> `/patients`) enter from opposite sides.
 *  4. No scroll restoration: `useRouteScrollReset` returns the scroll
 *     ancestors to the top on a PATH change and deliberately does nothing on
 *     a query-only change (that would throw a filtered user back to row 1).
 *  5. `y: 10 -> 0` on enter and `y: -8` on exit meant the content drifted the
 *     same way in both directions. Enter and exit now travel towards each
 *     other from opposite sides, which reads as the old page handing over to
 *     the new one instead of everything sliding up forever.
 *
 * The offset is 8px on purpose: this is a clinical tool that people navigate
 * dozens of times an hour. Anything above ~12px becomes a slideshow.
 * ------------------------------------------------------------------------ */

/** Travel distance for a directional route change. Deliberately small. */
const ROUTE_SHIFT = 8;

/**
 * `DURATION.fast` (180ms) in and 180ms out, OVERLAPPING. Perceived cost of a
 * navigation is therefore 180ms, versus the old `mode="wait"` at
 * 0.28s + 0.28s = 560ms of blank screen before the next page was readable.
 * A route change must never cost more than reading the new page's <h1>.
 */
const ROUTE_TRANSITION = { duration: DURATION.fast, ease: EASE_OUT } as const;

/** Path only: everything from the first `?` or `#` is dropped. */
export function routePath(location: string): string {
  const cut = location.search(/[?#]/);
  return cut === -1 ? location : location.slice(0, cut);
}

type RouteDirection = "forward" | "back" | "none";

function depth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

/**
 * Forward = the new route is deeper than the old one (list -> record).
 * Back = shallower (record -> list). Same depth is deliberately `none`:
 * `/patients` -> `/collections` and `/patients/12` -> `/patients/13` are not
 * "deeper", and sliding them would lie about where the user went. Cross-fade
 * only. That also keeps a filter-driven or in-record update from being
 * misread as a direction change.
 */
export function routeDirection(previous: string | null, next: string): RouteDirection {
  if (!previous || previous === next) return "none";
  const from = depth(previous);
  const to = depth(next);
  if (to > from) return "forward";
  if (to < from) return "back";
  return "none";
}

/**
 * `dir="rtl"` is written onto <html> by i18n on every language change. The
 * directional offsets are physical (`x`), so they have to be mirrored here —
 * framer has no logical-axis transform.
 */
function rtlSign(): number {
  if (typeof document === "undefined") return 1;
  return document.documentElement.getAttribute("dir") === "rtl" ? -1 : 1;
}

function offsetFor(direction: RouteDirection, entering: boolean): number {
  if (direction === "none") return 0;
  const sign = rtlSign();
  const forward = direction === "forward";
  // Entering deeper comes from the far edge; coming back comes from the near
  // edge. The exiting layer travels the opposite way, so the two cross.
  return entering === forward ? ROUTE_SHIFT * sign : -ROUTE_SHIFT * sign;
}

/** Only walk to the nearest scrollable ancestors — never the whole tree. */
function scrollableAncestors(from: Element | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  let el = from?.parentElement ?? null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        found.push(el);
      }
    }
    el = el.parentElement;
  }
  return found;
}

/**
 * Top-of-page on navigation, position-preserved on a filter change.
 *
 * The scroll container is whichever ancestor scrolls, which differs per shell:
 * the desktop shell scrolls `<main id="main-content">`, the classic desktop
 * shell scrolls an inner wrapper while `<main>` itself is `overflow-hidden`,
 * and the phone shell scrolls its `<main>`. Querying by id would therefore
 * have reset nothing in the classic shell.
 *
 * The effect depends on `pathname`, NOT on `location`, and that dep array is
 * the whole mechanism: a query-only change re-renders with the same `pathname`,
 * so the effect does not run and a clinician filtering down to row 400 keeps
 * their place. Do not "tidy" the deps to `location` — that one token is the
 * difference between preserving and destroying scroll position on every
 * keystroke that reaches the URL. There is a test for exactly that.
 */
function useRouteScrollReset(pathname: string, layer: React.RefObject<HTMLDivElement | null>) {
  const initialised = useRef(false);

  useEffect(() => {
    // Do not touch the scroll position on the first paint: the browser's own
    // restoration after a reload is more useful than forcing the top.
    if (!initialised.current) {
      initialised.current = true;
      return;
    }

    const id = window.requestAnimationFrame(() => {
      for (const el of scrollableAncestors(layer.current)) el.scrollTop = 0;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathname, layer]);
}

/**
 * The path the router is on RIGHT NOW. `AnimatePresence` retains the outgoing
 * layer with the props it was mounted with, so a layer cannot learn that it is
 * now the outgoing one from its own props — it reads it from here. Context (not
 * a ref) so the retained layer re-renders when the path changes even though its
 * parent bails out.
 */
const CurrentRouteContext = createContext<string>("");

/**
 * One route layer. Mounted by `AnimatedRoutes` under `AnimatePresence`, and
 * kept mounted (absolutely positioned, out of flow) for the length of its exit
 * so the two pages can overlap.
 *
 * The outgoing layer is marked `inert` + `aria-hidden`. That matters for focus:
 * during the overlap the DOM briefly holds two `#main-content` elements (one
 * per page), and making the outgoing layer inert guarantees `useRouteFocus()`
 * in `layout.tsx` cannot land a keyboard user in a subtree that is about to be
 * removed — the exact failure the old `mode="wait"` avoided by never having
 * two pages on screen at once.
 */
function RouteLayer({
  routeKey,
  enteringDirection,
  layerRef,
  children,
}: {
  routeKey: string;
  enteringDirection: RouteDirection;
  layerRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const current = useContext(CurrentRouteContext);
  const exiting = routeKey !== current;
  // On the way out the direction is re-derived from this layer's own path and
  // the live one, so a fast A -> B -> C cannot make B exit using A -> B's
  // direction.
  const direction = exiting ? routeDirection(routeKey, current) : enteringDirection;

  return (
    <motion.div
      /* Only the incoming layer owns the ref: two elements sharing one ref
         would let the outgoing layer's unmount null it out mid-navigation. */
      ref={exiting ? undefined : layerRef}
      data-route-state={exiting ? "exiting" : "active"}
      aria-hidden={exiting ? true : undefined}
      inert={exiting ? true : undefined}
      initial={{ opacity: 0, x: offsetFor(direction, true) }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: offsetFor(direction, false) }}
      transition={ROUTE_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedRoutes({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const pathname = useMemo(() => routePath(location), [location]);
  // `useMotionPrefs()` rather than framer's `useReducedMotion()` alone: this
  // also honours `prefers-reduced-data: reduce`, which the token system treats
  // as "skip non-essential motion" — and a page transition is exactly that.
  const reducedMotion = shouldReduceMotion(useMotionPrefs());
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Direction has to be known during the render that mounts the new layer, so
  // it is derived from the previous path here rather than in an effect. Writing
  // the ref during render is safe under StrictMode's double invoke: the second
  // pass sees `previousPath.current === pathname` and returns the same answer.
  const previousPath = useRef<string | null>(null);
  const direction = useRef<RouteDirection>("none");
  if (previousPath.current !== pathname) {
    direction.current = routeDirection(previousPath.current, pathname);
    previousPath.current = pathname;
  }

  useRouteScrollReset(pathname, layerRef);

  const content = <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>;

  // Reduced motion is a plain instant swap — not a fade. Keeping the layer
  // under AnimatePresence with a zero-length exit would still paint the old
  // page for a frame; swapping the element outright is the only version with no
  // motion in it at all.
  if (reducedMotion) {
    return (
      <div key={pathname} data-route-state="active" ref={layerRef}>
        {content}
      </div>
    );
  }

  return (
    <CurrentRouteContext.Provider value={pathname}>
      {/* popLayout, never "wait": the entering page is in flow immediately, so
          content is never absent, and the exiting page is taken out of flow so
          the two never double the scroll height. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <RouteLayer
          key={pathname}
          routeKey={pathname}
          enteringDirection={direction.current}
          layerRef={layerRef}
        >
          {content}
        </RouteLayer>
      </AnimatePresence>
    </CurrentRouteContext.Provider>
  );
}

function ClassicApp({ canAdminAccess }: { canAdminAccess: boolean }) {
  return (
    <AnimatedRoutes>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/patients" component={Patients} />
        <Route path="/patients/vr" component={PatientCorridor} />
        <Route path="/patients/spatial" component={PatientWorkspaceLoader as any} />
        <Route path="/patients/spatial/:id" component={PatientWorkspaceLoader as any} />
        <Route path="/patients/new" component={NewRecordPage} />
        <Route path="/patients/:id" component={PatientRecordView as any} />
        <Route path="/patients/:id/edit" component={PatientRecordFormPage as any} />
        <Route path="/collections" component={Collections} />
        <Route path="/collections/new" component={RecordDefinitionEdit} />
        <Route path="/collections/:id/edit" component={RecordDefinitionEdit} />
        <Route path="/records/:definitionId" component={() => <RecordList />} />
        <Route path="/records/:definitionId/new" component={() => <RecordDetail />} />
        <Route path="/records/:definitionId/:recordId" component={() => <RecordDetail />} />
        <Route path="/feedback" component={Feedback} />
        <Route path="/activity/me" component={ActivityMe} />
        <Route path="/api-tokens" component={ApiTokens} />
        <Route path="/sessions" component={Sessions} />
        {/* Authenticated (unlike /login and /reset-password): setting up a
            second factor requires an existing session AND a fresh password
            confirmation, so a signed-out visitor must never land here. */}
        <Route path="/mfa-setup" component={MfaSetupPage} />
        {canAdminAccess && <Route path="/database" component={Database} />}
        {canAdminAccess && <Route path="/activity" component={Activity} />}
        {canAdminAccess && <Route path="/admin" component={Admin} />}
        <Route path="/more-features" component={MoreFeatures} />
        <Route path="/consent" component={Consent} />
        <Route path="/deidentify" component={Deidentify} />
        <Route path="/coding" component={Coding} />
        <Route path="/cohort" component={Cohort} />
        <Route path="/validation" component={ValidationPage} />
        <Route path="/dicom" component={Dicom} />
        <Route path="/export" component={ExportPage} />
        <Route path="/studies" component={Studies} />
        <Route path="/ml" component={Ml} />
        <Route path="/reports" component={Reports} />
        <Route path="/gdpr" component={Gdpr} />
        <Route path="/ingest" component={Ingest} />
        <Route path="/search" component={SearchPage} />
        <Route path="/data-analysis" component={DataAnalysis} />
        {/* `/data-table-demo` is deliberately NOT routed in the classic shell.
            The page synthesises 2,000 fake patients in-browser (see
            data-table-demo.tsx makeData) as a component harness for DataTable.
            Shipping it in a PHI application put a fake patient roster on a
            production URL, where it is indistinguishable from real data and
            reachable by anyone who guesses the path. It remains reachable in
            the desktop shell's app registry for development; delete both
            registrations once the table work has landed. */}
        <Route component={NotFound} />
      </Switch>
    </AnimatedRoutes>
  );
}

/**
 * Read the persisted desktop preset so the `lazy()` fallback uses the *active*
 * wallpaper. It used to hardcode the Amethyst gradient, so every non-Amethyst
 * preset flashed aubergine while the shell chunk loaded.
 *
 * TOKEN AGENT: if `--desktop-wallpaper` (or a `data-theme-preset` attribute on
 * `<html>`) is available, prefer it — this is the pre-CSS fallback.
 */
function desktopWallpaper(): string {
  if (typeof window === "undefined") return getThemePreset("amethyst").background;
  try {
    const raw = window.localStorage.getItem("desktop-theme");
    if (!raw) return getThemePreset("amethyst").background;
    const parsed = JSON.parse(raw) as { id?: string; custom?: { background?: string } };
    if (parsed?.custom?.background) return parsed.custom.background;
    return getThemePreset(parsed?.id ?? "amethyst").background;
  } catch {
    return getThemePreset("amethyst").background;
  }
}

function DesktopApp() {
  const Desktop = lazy(() => import("@/components/desktop/Desktop"));
  const wallpaper = desktopWallpaper();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" style={{ background: wallpaper }}>
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        </div>
      }
    >
      <Desktop />
    </Suspense>
  );
}

function ProtectedRoutes() {
  const { isLoading, authenticated, canAdminAccess } = useAuth();
  // Reactive: re-evaluates when the viewport crosses the 767px boundary (or a
  // tablet rotates), so the correct shell is mounted instead of the one chosen
  // at first paint. `initDesktopMode()` strips the developer-only
  // `?desktop=1|0` override from the URL before it can leak into a shared link.
  const isDesktop = useIsDesktopMode();

  useEffect(() => {
    initDesktopMode();
  }, []);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Public routes
  if (!authenticated) {
    return (
      <AnimatedRoutes>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/signup" component={Signup} />
          {/* Password recovery. MUST stay inside the unauthenticated branch and
              MUST precede the catch-all below: the person following a reset link
              from their email is signed out, and `Welcome` would otherwise
              swallow both paths. */}
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route component={Welcome} />
        </Switch>
      </AnimatedRoutes>
    );
  }

  return (
    <>
      {isDesktop ? <DesktopApp /> : <ClassicApp canAdminAccess={canAdminAccess} />}
      <ProductTour />
      {/* Mounted once, here, for BOTH shells. `Desktop.tsx` used to render a
          second <CommandPalette />, so one ⌘K press registered two keydown
          listeners and opened two stacked Radix dialogs; running an action
          closed only the top one, leaving a palette stuck on screen. */}
      <CommandPalette />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <SkipToContent />
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <ProtectedRoutes />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

export default App;
