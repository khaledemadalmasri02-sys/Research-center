import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { DEFAULT_WINDOW_SIZE, getApp } from "./app-registry";

export interface DesktopWindow {
  id: string;
  appId: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  prevRect?: { x: number; y: number; w: number; h: number };
}

interface WindowState {
  windows: DesktopWindow[];
  activeId: string | null;
  nextZ: number;
  seq: number;
}

type Action =
  | { type: "OPEN"; appId: string; title?: string; rect?: Partial<Omit<DesktopWindow, "id" | "appId" | "zIndex" | "minimized" | "maximized">> }
  | { type: "CLOSE"; id: string }
  | { type: "FOCUS"; id: string }
  | { type: "MINIMIZE"; id: string }
  | { type: "RESTORE"; id: string }
  | { type: "MOVE"; id: string; x: number; y: number }
  | { type: "RESIZE"; id: string; w: number; h: number }
  | { type: "MAXIMIZE"; id: string; rect: { x: number; y: number; w: number; h: number } }
  | { type: "UNMAXIMIZE"; id: string }
  | { type: "SET_RECT"; id: string; x?: number; y?: number; w?: number; h?: number }
  | { type: "HYDRATE"; state: WindowState }
  | { type: "RESET" };

const STORAGE_KEY = "ubuntu-desktop-windows-v1";

function cascadeRect(seq: number): { x: number; y: number; w: number; h: number } {
  const size = DEFAULT_WINDOW_SIZE;
  const offset = (seq % 8) * 30;
  return { x: 64 + offset, y: 56 + offset, w: size.w, h: size.h };
}

function focusWindow(state: WindowState, id: string, restore: boolean): WindowState {
  const z = state.nextZ + 1;
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, zIndex: z, minimized: restore ? false : w.minimized } : w,
    ),
    activeId: id,
    nextZ: z,
  };
}

function topmostId(windows: DesktopWindow[]): string | null {
  if (windows.length === 0) return null;
  return windows.reduce((top, w) => (w.zIndex > top.zIndex ? w : top), windows[0]).id;
}

function reducer(state: WindowState, action: Action): WindowState {
  switch (action.type) {
    case "OPEN": {
      const app = getApp(action.appId);
      if (!app) return state;

      if (app.singleton) {
        const existing = state.windows.find((w) => w.appId === action.appId);
        if (existing) return focusWindow(state, existing.id, true);
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
        ...rect,
        zIndex: z,
        minimized: false,
        maximized: false,
      };
      return { ...state, windows: [...state.windows, win], activeId: id, nextZ: z, seq };
    }

    case "CLOSE": {
      const windows = state.windows.filter((w) => w.id !== action.id);
      const activeId = state.activeId === action.id ? topmostId(windows) : state.activeId;
      return { ...state, windows, activeId };
    }

    case "FOCUS":
      return focusWindow(state, action.id, false);

    case "MINIMIZE": {
      const z = state.nextZ + 1;
      const windows = state.windows.map((w) =>
        w.id === action.id ? { ...w, minimized: true, zIndex: z } : w,
      );
      const remaining = windows.filter((w) => !w.minimized);
      return { ...state, windows, activeId: topmostId(remaining), nextZ: z };
    }

    case "RESTORE":
      return focusWindow(state, action.id, true);

    case "MOVE":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w,
        ),
      };

    case "RESIZE":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, w: action.w, h: action.h } : w,
        ),
      };

    case "MAXIMIZE": {
      const z = state.nextZ + 1;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id
            ? { ...w, prevRect: { x: w.x, y: w.y, w: w.w, h: w.h }, ...action.rect, maximized: true, minimized: false, zIndex: z }
            : w,
        ),
        activeId: action.id,
        nextZ: z,
      };
    }

    case "UNMAXIMIZE": {
      const z = state.nextZ + 1;
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id && w.prevRect
            ? { ...w, ...w.prevRect, maximized: false, zIndex: z }
            : w,
        ),
        activeId: action.id,
        nextZ: z,
      };
    }

    case "SET_RECT":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id
            ? {
                ...w,
                ...(action.x !== undefined ? { x: action.x } : {}),
                ...(action.y !== undefined ? { y: action.y } : {}),
                ...(action.w !== undefined ? { w: action.w } : {}),
                ...(action.h !== undefined ? { h: action.h } : {}),
              }
            : w,
        ),
      };

    case "HYDRATE":
      return action.state;

    case "RESET":
      return { windows: [], activeId: null, nextZ: 10, seq: 0 };

    default:
      return state;
  }
}

function initState(): WindowState {
  const base: WindowState = { windows: [], activeId: null, nextZ: 10, seq: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const windows = Array.isArray(parsed.windows) ? (parsed.windows as DesktopWindow[]) : [];
    const nextZ = windows.reduce((m, w) => Math.max(m, w.zIndex || 0), 10) + 1;
    return {
      windows,
      activeId: parsed.activeId ?? null,
      nextZ,
      seq: parsed.seq ?? windows.length,
    };
  } catch {
    return base;
  }
}

interface DesktopContextValue {
  windows: DesktopWindow[];
  activeId: string | null;
  getWindow: (id: string) => DesktopWindow | undefined;
  open: (appId: string, opts?: { title?: string; rect?: Partial<Omit<DesktopWindow, "id" | "appId" | "zIndex" | "minimized" | "maximized">> }) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string, maximizedRect: { x: number; y: number; w: number; h: number }) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  setRect: (id: string, rect: { x?: number; y?: number; w?: number; h?: number }) => void;
  reset: () => void;
}

const WindowCtx = createContext<DesktopContextValue | null>(null);

export function WindowStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          windows: state.windows,
          activeId: state.activeId,
          nextZ: state.nextZ,
          seq: state.seq,
        }),
      );
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [state]);

  const value = useMemo<DesktopContextValue>(
    () => ({
      windows: state.windows,
      activeId: state.activeId,
      getWindow: (id) => state.windows.find((w) => w.id === id),
      open: (appId, opts) => dispatch({ type: "OPEN", appId, title: opts?.title, rect: opts?.rect }),
      close: (id) => dispatch({ type: "CLOSE", id }),
      focus: (id) => dispatch({ type: "FOCUS", id }),
      minimize: (id) => dispatch({ type: "MINIMIZE", id }),
      restore: (id) => dispatch({ type: "RESTORE", id }),
      toggleMaximize: (id, maximizedRect) => {
        const w = state.windows.find((win) => win.id === id);
        if (w?.maximized) dispatch({ type: "UNMAXIMIZE", id });
        else dispatch({ type: "MAXIMIZE", id, rect: maximizedRect });
      },
      move: (id, x, y) => dispatch({ type: "MOVE", id, x, y }),
      resize: (id, w, h) => dispatch({ type: "RESIZE", id, w, h }),
      setRect: (id, rect) => dispatch({ type: "SET_RECT", id, ...rect }),
      reset: () => dispatch({ type: "RESET" }),
    }),
    [state],
  );

  return <WindowCtx.Provider value={value}>{children}</WindowCtx.Provider>;
}

export function useDesktop(): DesktopContextValue {
  const ctx = useContext(WindowCtx);
  if (!ctx) throw new Error("useDesktop must be used within a WindowStoreProvider");
  return ctx;
}

export function useDesktopOptional(): DesktopContextValue | null {
  return useContext(WindowCtx);
}
