import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_WINDOW_SIZE, getApp } from "./app-registry";

export interface DesktopWindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DesktopWindow extends DesktopWindowRect {
  id: string;
  appId: string;
  // Optional wouter-style route (e.g. "/patients/133") used to render the
  // loader inside a sub-Router so `useParams()` resolves to the right record.
  route?: string;
  title?: string;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: DesktopWindowRect;
}

/**
 * Normalized internal state. `windows` used to be a plain array rebuilt on
 * every dispatch, so every `Window` (and its whole page tree: virtualized
 * DataTable, DICOM canvas, 3D scene) re-rendered on FOCUS / MOVE / SET_RECT.
 * Keying by id lets `patch()` keep every untouched window's object identity
 * stable, so a `memo()`-wrapped `Window` bails out and only the window that
 * actually changed re-renders.
 */
export interface WindowState {
  byId: Record<string, DesktopWindow>;
  order: string[];
  activeId: string | null;
  nextZ: number;
  seq: number;
}

type OpenOpts = {
  title?: string;
  route?: string;
  rect?: Partial<Omit<DesktopWindow, "id" | "appId" | "zIndex" | "minimized" | "maximized" | "route">>;
};

type Action =
  | ({ type: "OPEN" } & OpenOpts & { appId: string })
  | { type: "CLOSE"; id: string }
  | { type: "FOCUS"; id: string }
  | { type: "MINIMIZE"; id: string }
  | { type: "RESTORE"; id: string }
  | { type: "MOVE"; id: string; x: number; y: number }
  | { type: "RESIZE"; id: string; w: number; h: number }
  | { type: "MAXIMIZE"; id: string; rect: DesktopWindowRect }
  | { type: "UNMAXIMIZE"; id: string; rect?: DesktopWindowRect }
  | { type: "TOGGLE_MAXIMIZE"; id: string; rect: DesktopWindowRect }
  | { type: "SET_RECT"; id: string; x?: number; y?: number; h?: number; w?: number }
  | { type: "SET_ROUTE"; id: string; route: string }
  | { type: "HYDRATE"; state: WindowState }
  | { type: "RESET" };

/** Shared with `Window.tsx` so the minimum-size contract lives in one place. */
export const MIN_W = 360;
export const MIN_H = 240;

/** Hard cap on simultaneously open windows (D10). */
export const MAX_WINDOWS = 12;

const STORAGE_KEY = "ubuntu-desktop-windows-v1";
/** Bumped whenever the persisted payload shape changes; see `PersistedState`. */
export const STORAGE_VERSION = 2;
const PERSIST_DEBOUNCE_MS = 250;

export { STORAGE_KEY as DESKTOP_WINDOWS_STORAGE_KEY };

/* -------------------------------------------------------------------------- */
/* Route <-> resourceId                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Only the path *parameter* of a route is persisted, never the whole URL.
 *
 * `localStorage` survives logout (see `clearDesktopStorage`), and a shared
 * clinical workstation is a realistic deployment: writing `/patients/133` into
 * storage means the next person to log in sees the previous user's open
 * patient windows — a PHI disclosure with no auth check in between. Storing an
 * opaque `resourceId` plus the app id means a stale layout can only ever be
 * re-hydrated as a *list of windows*, and the page behind each window still
 * fails closed on the API's own authz. Query strings, fragments and tokens in
 * a route are dropped entirely.
 */
const ROUTE_SPECS: Record<string, { prefix: RegExp; build: (res: string) => string }> = {
  "records/:definitionId": {
    prefix: /^\/records\/([^/?#]+)\/?$/,
    build: (r) => `/records/${r}`,
  },
  "records/:definitionId/new": {
    prefix: /^\/records\/([^/?#]+)\/new\/?$/,
    build: (r) => `/records/${r}/new`,
  },
  "record-detail": {
    prefix: /^\/records\/([^/?#]+\/[^/?#]+)\/?$/,
    build: (r) => `/records/${r}`,
  },
  "patient-view": {
    prefix: /^\/patients\/([^/?#]+)\/?$/,
    build: (r) => `/patients/${r}`,
  },
  "patient-edit": {
    prefix: /^\/patients\/([^/?#]+)\/edit\/?$/,
    build: (r) => `/patients/${r}/edit`,
  },
  "collections/:id/edit": {
    prefix: /^\/collections\/([^/?#]+)\/edit\/?$/,
    build: (r) => `/collections/${r}/edit`,
  },
};

export function resourceIdFromRoute(appId: string, route?: string): string | undefined {
  if (!route) return undefined;
  const spec = ROUTE_SPECS[appId];
  if (!spec) return undefined;
  // Query strings and fragments are never part of a window route and are never
  // persisted: a route like `/patients/133?token=…` must still reduce to `133`.
  const path = route.split("?")[0].split("#")[0];
  const m = spec.prefix.exec(path);
  return m ? m[1] : undefined;
}

export function routeFromResource(appId: string, resourceId?: string): string | undefined {
  if (!resourceId) return undefined;
  const spec = ROUTE_SPECS[appId];
  if (!spec) return undefined;
  return spec.build(resourceId);
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

interface PersistedWindow extends DesktopWindowRect {
  id: string;
  appId: string;
  /** Opaque path parameter; the full `route` is never written to storage. */
  resourceId?: string;
  title?: string;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: DesktopWindowRect;
}

interface PersistedState {
  version: number;
  windows: PersistedWindow[];
  activeId: string | null;
  nextZ: number;
  seq: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Remove every desktop-shell key from `localStorage`.
 *
 * MUST be called on logout. `rc_sid` is host-scoped to
 * `.research-center.fit` so a stale `ubuntu-desktop-windows-v1` outlives the
 * session and leaks the previous user's open windows (and their patient ids)
 * to whoever logs in next on a shared workstation.
 *
 * Exported for `use-auth.ts`'s `logout()` to call directly; `Desktop.tsx`
 * also calls it on the authenticated -> unauthenticated transition so the key
 * is cleared even if the auth hook is never updated.
 */
export function clearDesktopStorage(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota: nothing to clear */
  }
}

function cascadeRect(seq: number): DesktopWindowRect {
  const size = DEFAULT_WINDOW_SIZE;
  // Distinct offsets for the first six windows, then the whole cascade shifts
  // by half a step so 7..11 do not land on top of 1..6. The old `(seq % 8) * 30`
  // repeated exactly, so windows 9..16 piled onto identical coordinates.
  const stepX = 44;
  const stepY = 34;
  const i = seq % 6;
  const wave = Math.floor(seq / 6);
  const shift = (wave % 2) * (stepX / 2);
  return {
    x: 48 + i * stepX + shift,
    y: 40 + i * stepY + shift / 2,
    w: size.w,
    h: size.h,
  };
}

function listWindows(state: WindowState): DesktopWindow[] {
  const out: DesktopWindow[] = [];
  for (const id of state.order) {
    const w = state.byId[id];
    if (w) out.push(w);
  }
  return out;
}

/** Replace one window, keeping every other object identity untouched. */
function patch(state: WindowState, id: string, next: DesktopWindow): WindowState {
  if (state.byId[id] === next) return state;
  return { ...state, byId: { ...state.byId, [id]: next } };
}

function focusWindow(state: WindowState, id: string, restore: boolean): WindowState {
  const current = state.byId[id];
  if (!current) return state;
  const z = state.nextZ + 1;
  return {
    ...patch(state, id, {
      ...current,
      zIndex: z,
      minimized: restore ? false : current.minimized,
    }),
    activeId: id,
    nextZ: z,
  };
}

function topmostId(state: WindowState, onlyVisible = false): string | null {
  const candidates = listWindows(state).filter((w) => (onlyVisible ? !w.minimized : true));
  if (candidates.length === 0) return null;
  return candidates.reduce((top, w) => (w.zIndex > top.zIndex ? w : top), candidates[0]).id;
}

/**
 * Clamp a rect inside the workspace without ever violating MIN_W / MIN_H:
 * if honouring the minimum would push the window past the right/bottom edge,
 * the position is pulled back instead (the window then overhangs by less than
 * its minimum, which the `overflow-hidden` area tolerates), because shrinking
 * a window below its minimum makes the content unusable.
 */
export function clampRect(rect: DesktopWindowRect, areaW: number, areaH: number): DesktopWindowRect {
  const limitW = Math.max(MIN_W, areaW || MIN_W);
  const limitH = Math.max(MIN_H, areaH || MIN_H);
  const w = Math.min(Math.max(MIN_W, rect.w), limitW);
  const h = Math.min(Math.max(MIN_H, rect.h), limitH);
  const x = Math.max(0, Math.min(rect.x, Math.max(0, limitW - w)));
  const y = Math.max(0, Math.min(rect.y, Math.max(0, limitH - h)));
  return { x, y, w, h };
}

/** Approximate workspace size at hydration time (no DOM measurements yet). */
function hydrationArea(): { w: number; h: number } {
  if (!canUseStorage()) return { w: DEFAULT_WINDOW_SIZE.w, h: DEFAULT_WINDOW_SIZE.h };
  const mobile = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  // Top bar (36px) always; the dock rail (~68px + margins) only on desktop.
  return { w: Math.max(MIN_W, mobile ? vw : vw - 100), h: Math.max(MIN_H, vh - 36) };
}

function sanitizeWindows(raw: unknown[]): { byId: Record<string, DesktopWindow>; order: string[] } {
  const byId: Record<string, DesktopWindow> = {};
  const order: string[] = [];
  const area = hydrationArea();

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const rec = entry as Partial<PersistedWindow> & { route?: string };
    const appId = typeof rec.appId === "string" ? rec.appId : "";
    // `getApp` guards against a payload naming an app id that no longer exists
    // (renamed/removed app): such an entry would render `null` forever while
    // still being counted, persisted and skipped in the reducer.
    if (!appId || !getApp(appId)) return;
    if (!Number.isFinite(rec.w) || !Number.isFinite(rec.h)) return;
    if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y)) return;

    const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : `${appId}-${index}`;
    if (byId[id]) return; // duplicate id in a hand-edited payload

    const rect = clampRect(
      { x: rec.x as number, y: rec.y as number, w: rec.w as number, h: rec.h as number },
      area.w,
      area.h,
    );
    const route =
      routeFromResource(appId, rec.resourceId) ??
      // Legacy (pre-`resourceId`) payloads stored the full route; accept it
      // once so an existing layout is not lost on upgrade, then re-persist in
      // the narrowed form.
      resourceIdFromRoute(appId, rec.route);

    byId[id] = {
      id,
      appId,
      route: route ?? rec.route,
      title: typeof rec.title === "string" ? rec.title : undefined,
      ...rect,
      zIndex: Number.isFinite(rec.zIndex) ? (rec.zIndex as number) : 10,
      minimized: !!rec.minimized,
      // A hydrated `maximized: true` with no `prevRect` used to be stuck
      // maximized forever; fall back to the clamped rect as the restore target.
      maximized: !!rec.maximized,
      prevRect: rec.prevRect
        ? clampRect(
            {
              x: rec.prevRect.x,
              y: rec.prevRect.y,
              w: rec.prevRect.w,
              h: rec.prevRect.h,
            },
            area.w,
            area.h,
          )
        : undefined,
    };
    order.push(id);
  });

  return { byId, order };
}

function initState(): WindowState {
  const base: WindowState = { byId: {}, order: [], activeId: null, nextZ: 10, seq: 0 };
  if (!canUseStorage()) return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.windows)) return base;
    const { byId, order } = sanitizeWindows(parsed.windows as unknown[]);
    if (order.length === 0) return base;
    const nextZ = order.reduce((m, id) => Math.max(m, byId[id]?.zIndex ?? 0), 10) + 1;
    const activeId = parsed.activeId && byId[parsed.activeId] ? parsed.activeId : topmostId({ byId, order, activeId: null, nextZ, seq: 0 });
    return {
      byId,
      order,
      activeId,
      nextZ,
      seq: Number.isFinite(parsed.seq) ? (parsed.seq as number) : order.length,
    };
  } catch {
    return base;
  }
}

function serialize(state: WindowState): PersistedState {
  const windows: PersistedWindow[] = [];
  for (const id of state.order) {
    const w = state.byId[id];
    if (!w) continue;
    const { route, ...rest } = w;
    windows.push({ ...rest, resourceId: resourceIdFromRoute(w.appId, route) });
  }
  return { version: STORAGE_VERSION, windows, activeId: state.activeId, nextZ: state.nextZ, seq: state.seq };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

function reducer(state: WindowState, action: Action): WindowState {
  switch (action.type) {
    case "OPEN": {
      const app = getApp(action.appId);
      if (!app) return state;

      if (app.singleton) {
        const existing = listWindows(state).find((w) => w.appId === action.appId);
        if (existing) {
          // Reuse the open window instead of spawning a second one, but keep
          // it in sync with the requested route so that, e.g. clicking a
          // different patient record on the patients page actually opens that
          // record in the existing `patient-view` window rather than leaving
          // the previously-shown record on screen. This also covers the View
          // and Edit buttons, which open the `patient-view` / `patient-edit`
          // singletons the same way.
          const focused = focusWindow(state, existing.id, true);
          if (action.route && action.route !== existing.route) {
            return patch(focused, existing.id, { ...focused.byId[existing.id], route: action.route });
          }
          return focused;
        }
      }

      if (state.order.length >= MAX_WINDOWS) {
        // Bounded window count: a non-singleton app opened past the cap focuses
        // the oldest window instead of stacking an 13th copy of the same page
        // (and, past `cascadeRect`'s 6 offsets, onto identical coordinates).
        const oldest = state.order[0];
        return oldest ? focusWindow(state, oldest, true) : state;
      }

      const seq = state.seq + 1;
      const base = cascadeRect(state.seq);
      const rect = action.rect ? { ...base, ...action.rect } : base;
      const id = `${action.appId}-${seq}`;
      const z = state.nextZ + 1;
      const win: DesktopWindow = {
        id,
        appId: action.appId,
        title: action.title,
        route: action.route,
        ...rect,
        zIndex: z,
        minimized: false,
        maximized: false,
      };
      return {
        ...state,
        byId: { ...state.byId, [id]: win },
        order: [...state.order, id],
        activeId: id,
        nextZ: z,
        seq,
      };
    }

    case "CLOSE": {
      if (!state.byId[action.id]) return state;
      const byId = { ...state.byId };
      delete byId[action.id];
      const order = state.order.filter((id) => id !== action.id);
      const activeId = state.activeId === action.id ? topmostId({ ...state, byId, order }) : state.activeId;
      return { ...state, byId, order, activeId };
    }

    case "FOCUS": {
      const current = state.byId[action.id];
      if (!current) return state;
      // Already the active, topmost window: bumping `nextZ` would re-create
      // every array, re-render every window and write to localStorage for no
      // visible change. This is the hot path — `Window` used to fire FOCUS on
      // every pointerdown inside its content.
      if (state.activeId === action.id && topmostId(state) === action.id) return state;
      return focusWindow(state, action.id, false);
    }

    case "MINIMIZE": {
      const current = state.byId[action.id];
      if (!current || current.minimized) return state;
      const z = state.nextZ + 1;
      const next = { ...patch(state, action.id, { ...current, minimized: true, zIndex: z }) };
      next.activeId = topmostId(next, true);
      next.nextZ = z;
      return next;
    }

    case "RESTORE":
      return focusWindow(state, action.id, true);

    case "MOVE": {
      const current = state.byId[action.id];
      if (!current || (current.x === action.x && current.y === action.y)) return state;
      return patch(state, action.id, { ...current, x: action.x, y: action.y });
    }

    case "RESIZE": {
      const current = state.byId[action.id];
      if (!current || (current.w === action.w && current.h === action.h)) return state;
      return patch(state, action.id, { ...current, w: action.w, h: action.h });
    }

    case "MAXIMIZE": {
      const current = state.byId[action.id];
      if (!current) return state;
      const z = state.nextZ + 1;
      return {
        ...patch(state, action.id, {
          ...current,
          prevRect: { x: current.x, y: current.y, w: current.w, h: current.h },
          ...action.rect,
          maximized: true,
          minimized: false,
          zIndex: z,
        }),
        activeId: action.id,
        nextZ: z,
      };
    }

    case "UNMAXIMIZE": {
      const current = state.byId[action.id];
      if (!current) return state;
      const z = state.nextZ + 1;
      // A window hydrated (or created) with `maximized: true` and no
      // `prevRect` used to be stuck maximized forever: the reducer only
      // restored when `prevRect` existed and silently did nothing otherwise.
      // Fall back to the default size, clamped into the space the maximized
      // window currently occupies, so un-maximize always visibly shrinks it.
      const restoreRect =
        current.prevRect ??
        clampRect({ x: 24, y: 24, w: DEFAULT_WINDOW_SIZE.w, h: DEFAULT_WINDOW_SIZE.h }, current.w, current.h);
      return {
        ...patch(state, action.id, {
          ...current,
          ...restoreRect,
          maximized: false,
          zIndex: z,
        }),
        activeId: action.id,
        nextZ: z,
      };
    }

    case "TOGGLE_MAXIMIZE": {
      const current = state.byId[action.id];
      if (!current) return state;
      const z = state.nextZ + 1;
      if (current.maximized) {
        const restoreRect =
          current.prevRect ??
          clampRect({ x: 24, y: 24, w: DEFAULT_WINDOW_SIZE.w, h: DEFAULT_WINDOW_SIZE.h }, current.w, current.h);
        return {
          ...patch(state, action.id, {
            ...current,
            ...restoreRect,
            maximized: false,
            zIndex: z,
          }),
          activeId: action.id,
          nextZ: z,
        };
      }
      return {
        ...patch(state, action.id, {
          ...current,
          prevRect: { x: current.x, y: current.y, w: current.w, h: current.h },
          ...action.rect,
          maximized: true,
          minimized: false,
          zIndex: z,
        }),
        activeId: action.id,
        nextZ: z,
      };
    }

    case "SET_RECT": {
      const current = state.byId[action.id];
      if (!current) return state;
      const { x, y, w, h } = action;
      const nextX = x !== undefined ? x : current.x;
      const nextY = y !== undefined ? y : current.y;
      const nextW = w !== undefined ? w : current.w;
      const nextH = h !== undefined ? h : current.h;
      if (nextX === current.x && nextY === current.y && nextW === current.w && nextH === current.h) {
        return state;
      }
      return patch(state, action.id, { ...current, x: nextX, y: nextY, w: nextW, h: nextH });
    }

    case "SET_ROUTE": {
      const current = state.byId[action.id];
      if (!current || current.route === action.route) return state;
      return patch(state, action.id, { ...current, route: action.route });
    }

    case "HYDRATE":
      return action.state;

    case "RESET":
      return { byId: {}, order: [], activeId: null, nextZ: 10, seq: 0 };

    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Contexts                                                                   */
/* -------------------------------------------------------------------------- */

export interface DesktopContextValue {
  windows: DesktopWindow[];
  activeId: string | null;
  getWindow: (id: string) => DesktopWindow | undefined;
  open: (appId: string, opts?: OpenOpts) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string, maximizedRect: DesktopWindowRect) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  setRect: (id: string, rect: { x?: number; y?: number; w?: number; h?: number }) => void;
  setRoute: (id: string, route: string) => void;
  reset: () => void;
}

export type DesktopActions = Omit<DesktopContextValue, "windows" | "activeId">;

const WindowStateCtx = createContext<{ windows: DesktopWindow[]; activeId: string | null } | null>(null);
const WindowActionsCtx = createContext<DesktopContextValue | null>(null);
const WindowActionsStableCtx = createContext<DesktopActions | null>(null);

/** Fine-grained subscription surface used by `Window` (see `useWindowRecord`). */
interface StoreApi {
  subscribe: (cb: () => void) => () => void;
  getWindow: (id: string) => DesktopWindow | undefined;
  getActiveId: () => string | null;
}
const StoreApiCtx = createContext<StoreApi | null>(null);

const noopUnsubscribe = () => () => {};

export function WindowStoreProvider({
  children,
  canAdminAccess = false,
}: {
  children: ReactNode;
  /**
   * Fail-closed default (`false`) so a provider mounted without auth context
   * cannot open `adminOnly` apps. `Desktop` passes the real value.
   */
  canAdminAccess?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const canAdminRef = useRef(canAdminAccess);
  canAdminRef.current = canAdminAccess;

  const subscribers = useRef<Set<() => void>>(new Set());

  const storeApi = useMemo<StoreApi>(
    () => ({
      subscribe: (cb: () => void) => {
        subscribers.current.add(cb);
        return () => {
          subscribers.current.delete(cb);
        };
      },
      getWindow: (id: string) => stateRef.current.byId[id],
      getActiveId: () => stateRef.current.activeId,
    }),
    [],
  );

  // Notify fine-grained subscribers after every commit. `useSyncExternalStore`
  // re-reads each snapshot and bails out when the value is `Object.is`-equal, so
  // untouched windows do not re-render.
  useEffect(() => {
    subscribers.current.forEach((cb) => cb());
  });

  /* ---- persistence ---------------------------------------------------- */

  const skipPersistRef = useRef(false);

  // Two tabs sharing one localStorage key used to diverge and clobber each
  // other; adopt the other tab's layout instead.
  useEffect(() => {
    if (!canUseStorage()) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      try {
        const parsed = JSON.parse(e.newValue) as Partial<PersistedState>;
        if (!Array.isArray(parsed.windows)) return;
        const { byId, order } = sanitizeWindows(parsed.windows as unknown[]);
        if (order.length === 0) return;
        const nextZ = order.reduce((m, id) => Math.max(m, byId[id]?.zIndex ?? 0), 10) + 1;
        skipPersistRef.current = true; // do not echo the write back
        dispatch({
          type: "HYDRATE",
          state: {
            byId,
            order,
            activeId: parsed.activeId && byId[parsed.activeId] ? parsed.activeId : null,
            nextZ,
            seq: Number.isFinite(parsed.seq) ? (parsed.seq as number) : order.length,
          },
        });
      } catch {
        /* ignore malformed cross-tab payloads */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // `activeId` is deliberately *not* a dependency: focusing a window does not
  // change the layout worth persisting, and a drag emits SET_RECT per
  // pointermove, which used to mean a synchronous `JSON.stringify` +
  // `localStorage.setItem` per frame per window.
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    const snapshot = serialize(state);
    const id = window.setTimeout(() => {
      if (!canUseStorage()) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        /* ignore quota / private-mode errors */
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.byId, state.order]);

  /* ---- actions -------------------------------------------------------- */

  const open = useCallback((appId: string, opts?: OpenOpts) => {
    const app = getApp(appId);
    if (!app) return;
    // Role gate. `AppLauncher`/`Dock` already filter `adminOnly`, but any code
    // path that calls `desktop.open("admin")` directly bypassed them. This is
    // client-side only and purely cosmetic — the backend still enforces authz —
    // but it stops the shell from rendering admin pages for non-admins.
    if (app.adminOnly && !canAdminRef.current) return;
    dispatch({ type: "OPEN", appId, title: opts?.title, route: opts?.route, rect: opts?.rect });
  }, []);

  const close = useCallback((id: string) => dispatch({ type: "CLOSE", id }), []);
  const focus = useCallback((id: string) => dispatch({ type: "FOCUS", id }), []);
  const minimize = useCallback((id: string) => dispatch({ type: "MINIMIZE", id }), []);
  const restore = useCallback((id: string) => dispatch({ type: "RESTORE", id }), []);
  const toggleMaximize = useCallback(
    (id: string, maximizedRect: DesktopWindowRect) =>
      dispatch({ type: "TOGGLE_MAXIMIZE", id, rect: maximizedRect }),
    [],
  );
  const move = useCallback((id: string, x: number, y: number) => dispatch({ type: "MOVE", id, x, y }), []);
  const resize = useCallback((id: string, w: number, h: number) => dispatch({ type: "RESIZE", id, w, h }), []);
  const setRect = useCallback(
    (id: string, rect: { x?: number; y?: number; w?: number; h?: number }) => dispatch({ type: "SET_RECT", id, ...rect }),
    [],
  );
  const setRoute = useCallback((id: string, route: string) => dispatch({ type: "SET_ROUTE", id, route }), []);
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const getWindow = useCallback((id: string) => stateRef.current.byId[id], []);

  const windows = useMemo(() => listWindows(state), [state.byId, state.order]);

  const stateValue = useMemo(() => ({ windows, activeId: state.activeId }), [windows, state.activeId]);

  const stableActions = useMemo<DesktopActions>(
    () => ({ getWindow, open, close, focus, minimize, restore, toggleMaximize, move, resize, setRect, setRoute, reset }),
    [getWindow, open, close, focus, minimize, restore, toggleMaximize, move, resize, setRect, setRoute, reset],
  );

  const combinedActions = useMemo<DesktopContextValue>(
    () => ({ windows, activeId: state.activeId, ...stableActions }),
    [windows, state.activeId, stableActions],
  );

  return (
    <StoreApiCtx.Provider value={storeApi}>
      <WindowStateCtx.Provider value={stateValue}>
        <WindowActionsStableCtx.Provider value={stableActions}>
          <WindowActionsCtx.Provider value={combinedActions}>{children}</WindowActionsCtx.Provider>
        </WindowActionsStableCtx.Provider>
      </WindowStateCtx.Provider>
    </StoreApiCtx.Provider>
  );
}

export function useDesktop(): DesktopContextValue {
  const ctx = useContext(WindowActionsCtx);
  if (!ctx) throw new Error("useDesktop must be used within a WindowStoreProvider");
  return ctx;
}

export function useDesktopOptional(): DesktopContextValue | null {
  return useContext(WindowActionsCtx);
}

export function useDesktopState(): { windows: DesktopWindow[]; activeId: string | null } {
  const ctx = useContext(WindowStateCtx);
  if (!ctx) throw new Error("useDesktopState must be used within a WindowStoreProvider");
  return ctx;
}

export function useDesktopActions(): DesktopActions {
  const ctx = useContext(WindowActionsStableCtx);
  if (!ctx) throw new Error("useDesktopActions must be used within a WindowStoreProvider");
  return ctx;
}

/**
 * Stable-identity actions, or `null` outside a `WindowStoreProvider` (the
 * classic shell has none). Components shared by both shells must use this
 * rather than `useDesktop()`/`useDesktopOptional()`, whose value identity
 * changes on every window state change.
 */
export function useDesktopActionsOptional(): DesktopActions | null {
  return useContext(WindowActionsStableCtx);
}

/**
 * Subscribe to a single window record. Returns `undefined` only if the window
 * was removed. Because the reducer preserves object identity for untouched
 * windows, this hook re-renders only the window that actually changed.
 */
export function useWindowRecord(id: string): DesktopWindow | undefined {
  const api = useContext(StoreApiCtx);
  const subscribe = api ? api.subscribe : noopUnsubscribe;
  const getSnapshot = useCallback(() => api?.getWindow(id), [api, id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Subscribe to just the active window id (a primitive, so cheap). */
export function useActiveWindowId(): string | null {
  const api = useContext(StoreApiCtx);
  const subscribe = api ? api.subscribe : noopUnsubscribe;
  const getSnapshot = useCallback(() => api?.getActiveId() ?? null, [api]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}