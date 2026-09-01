# Ubuntu Desktop UX on research-center.fit — Implementation Plan (single Worker)

## Goal
One Cloudflare Worker (`research`), one SPA build, one `./public`:
- `www.research-center.fit` → current **classic** UI (unchanged).
- `research-center.fit` → new **Ubuntu desktop** UI (draggable windows, dock/launcher, top bar, wallpaper).

No backend, wrangler, or `/api` proxy changes. The two hostnames already route to the
same worker (`research/wrangler.toml:36`) and share the `/api/*` proxy
(`research/src/index.ts:156`) and host-scoped `connect.sid` cookie.

---

## 1. Core mechanism — runtime host switch
Cloudflare Static Assets binds **one** directory per worker (`research/wrangler.toml:11`),
so we cannot serve two folders from one worker. Instead the SPA selects its top-level
shell from the hostname:
- `src/lib/desktop-mode.ts`: `isDesktopMode()` → `!window.location.host.startsWith("www.")`.
  Optional `?desktop=1` / `?desktop=0` query override for testing.
- `App.tsx` renders `ClassicApp` (www) or `DesktopApp` (apex) after auth.

## 2. `App.tsx` restructure (Phase 1)
- `ClassicApp` = current `<Layout>` + `<Switch>` block extracted unchanged.
- `DesktopApp` = placeholder that currently renders `ClassicApp` (proves the switch);
  later phases replace it with `<WindowStoreProvider><Desktop /></WindowStoreProvider>`.
- `ProtectedRoutes`: unauthenticated → Login/Signup; authenticated → host-based choice.

## 3. App registry — catalog of "apps"
`src/components/desktop/app-registry.ts`:
`AppDef = { id, titleKey, icon, loader: lazy(import), defaultSize, minSize?, singleton?, category, showInDock? }`.
Reuses every existing page; icons from `lucide-react`; titles via existing `t(\`nav.${key}\`)`.

## 4. Window state store
`src/components/desktop/window-store.tsx`: Context + `useReducer`.
State: `windows[] {id, appId, rect, zIndex, minimized, maximized, prevRect}`, `activeId`, `nextZ`.
Actions: `open`, `close`, `focus`, `minimize`, `restore`, `toggleMaximize`, `move`, `resize`.
Persist to versioned `localStorage` key; restore or open a default Home window on load.

## 5. Window component
`src/components/desktop/Window.tsx`:
- Title bar: app icon + title + 3 Ubuntu buttons (min/max/close).
- Drag: framer-motion `drag`, `dragMomentum={false}`, `dragConstraints` = desktop area, persist on `onDragEnd`.
- Resize: bottom-right pointer-event handle (no new dep; `react-rnd` optional).
- Maximize fills desktop area (store `prevRect`); minimize animates to dock; focus raises zIndex.
- Internal scroll container for page content.

## 6. Desktop shell
`src/components/desktop/`:
- `Desktop.tsx` — `<Wallpaper/>` + `<TopBar/>` + window stack + `<Dock/>`; provides `WindowStoreProvider`; holds desktop-area ref for drag constraints.
- `Wallpaper.tsx` — Ubuntu aubergine gradient (or `public/` image), adapts to `next-themes`.
- `TopBar.tsx` — thin Ubuntu/GNOME bar: left Activities + clock; right tray reusing `NotificationBell`, `ThemeToggle`, `LanguageSwitcher`, user menu/logout from `layout.tsx:224`.
- `Dock.tsx` — left vertical launcher: pinned apps, running-dot indicator, click open/focus/restore, "Show Applications" → `AppLauncher`.
- `AppLauncher.tsx` — full-screen grid of all apps.

## 7. Mobile
`useIsMobile`: DesktopApp degrades to maximized single-window + bottom app bar/drawer (reuse `layout.tsx:147` pattern).

## 8. i18n & theming
Titles via `nav.*` keys; RTL flips dock right; dark mode via `next-themes`; ProductTour desktop-aware or classic-only (follow-up).

## 9. Build & deploy — zero Worker changes
`wrangler.toml`/`index.ts` unchanged; `run_worker_first`, SPA fallback, `CANONICAL_HOSTS`
(all hosts) stay correct. Single `pnpm build:frontend` → `research/public`. Sessions,
CORS (`app.ts:33`), MinIO/S3 untouched.

## 10. Risks
- Pages must be self-contained (they are — wouter renders `component={X}` with no Layout props).
- Radix portals (dialogs/toasts) render at body; keep top bar/dock below modal z-index.
- Versioned localStorage key prevents stale restored windows.

## 11. Implementation order
1. **Phase 1** — `desktop-mode.ts` + `App.tsx` split (`ClassicApp`/`DesktopApp`, both classic to prove switch). ✅ STARTED
2. Phase 2 — `app-registry.ts` (relocate lazy imports).
3. Phase 3 — `window-store.tsx`.
4. Phase 4 — `Window.tsx` (drag + resize + buttons).
5. Phase 5 — `Wallpaper`/`TopBar`/`Dock`/`AppLauncher`/`Desktop`.
6. Phase 6 — wire dock + launcher → open/focus/restore.
7. Phase 7 — mobile degradation.
8. Phase 8 — i18n/RTL/dark + product-tour decision.
9. Phase 9 — `pnpm typecheck` + `pnpm build:frontend` + deploy; verify both hosts.

## 12. Verification
- `pnpm typecheck`; `pnpm build:frontend`.
- Deploy: `www.research-center.fit` → classic; `research-center.fit` → Ubuntu desktop.
- Open apps from dock, drag, minimize/maximize/close, reopen; login independently per host; API works from both; Arabic RTL + dark mode; mobile viewport.

---
### Phase 1 status — DONE
- Created `src/lib/desktop-mode.ts`.
- Split `App.tsx` into `ClassicApp` / `DesktopApp`; `ProtectedRoutes` chooses by host.
- `DesktopApp` currently renders `ClassicApp` so the switch is verifiable without the desktop UI yet.

### Phase 2 status — DONE
- Created `src/components/desktop/app-registry.ts` with `AppDef` interface, all ~36 lazy page components, `DEFAULT_WINDOW_SIZE`, `APPS[]` catalog (id/titleKey/icon/loader/singleton/adminOnly/category/showInDock), and `getApp(id)`.
- `App.tsx` lazy imports relocated into the registry; `App.tsx` now imports the page components from the registry (no local `lazy` declarations).
- `Database`/`Activity` lucide icons aliased to `DatabaseIcon`/`ActivityIcon` to avoid clashing with the exported page components.
- `pnpm typecheck` clean.

### Phase 3 status — DONE
- Created `src/components/desktop/window-store.tsx`: `DesktopWindow` type, `WindowState`, reducer (OPEN/CLOSE/FOCUS/MINIMIZE/RESTORE/MOVE/RESIZE/MAXIMIZE/UNMAXIMIZE/HYDRATE), `WindowStoreProvider`, `useDesktop()` hook.
- Singleton apps focus existing instead of duplicating; cascade positioning for new windows; topmost re-focus on close/minimize.
- Persists to versioned `localStorage` key (`ubuntu-desktop-windows-v1`); hydrates on init.
- `pnpm typecheck` clean.

### Phase 4 status — DONE
- `src/components/desktop/Window.tsx`: draggable title bar (framer-motion `drag`, `dragConstraints` = desktop area, persist on drag end), bottom-right pointer-event resize handle (no new dep), Ubuntu min/max/close buttons, lazy body in `Suspense`, active-window highlight, double-click title bar to maximize, maximize uses desktop-area size.
- Added `desktop.*` i18n keys (minimize/maximize/restore/close/activities/showApps/launcher/wallpaper) to `en.ts` + `ar.ts`.
- `pnpm typecheck` clean.

### Phase 5 status — DONE
- `Wallpaper.tsx` (Ubuntu aubergine radial gradient), `TopBar.tsx` (Activities + clock + system tray reusing `NotificationBell`/`ThemeToggle`/`LanguageSwitcher` + user menu/logout), `Dock.tsx` (pinned + running apps with indicator dot, click open/focus/restore, Show Applications button), `AppLauncher.tsx` (searchable grid of all apps), `Desktop.tsx` (assembles shell, holds area ref, opens default `home` window, persists via store).
- `App.tsx` `DesktopApp` now lazy-loads and renders the real `<Desktop/>` (was placeholder). `pnpm typecheck` + `pnpm build` both clean.

### Phase 6 status — DONE (folded into Phase 5)
- Dock and AppLauncher already open/focus/restore windows via `useDesktop()`; singleton apps focus existing, multi-instance apps open new.

### Phase 7 status — DONE
- `Window.tsx` gains `mobile` prop: on mobile, windows fill the area (`inset-0`, no drag/resize/double-click-maximize).
- `Dock.tsx` gains `mobile` prop: becomes a bottom horizontal, scrollable bar.
- `Desktop.tsx` uses `useIsMobile()` to switch between desktop (left dock + area) and mobile (area + bottom dock) layouts.
- `pnpm typecheck` + `pnpm build` clean.

### Phase 8 status — DONE
- RTL: desktop layout flips the dock to the right via `order-1 rtl:order-2` (Dock) / `order-2 rtl:order-1` (area); Arabic already flips `dir` via i18n.
- `desktop.*` i18n keys present in `en.ts`/`ar.ts`; window titles use existing `nav.*` keys.
- Product tour limited to classic mode (its `data-tour` anchors don't exist in the desktop).
- `pnpm typecheck` + `pnpm build` clean.

### Known limitations / next steps (post-MVP)
- **In-app `<Link>` navigation** (e.g. Patients list → patient detail, "New Patient"): these still use wouter and change the URL, but the desktop has no `<Switch>`, so they won't open a window yet. Follow-up: intercept navigation to open the matching app/window (global link handler or a `navigateApp()` helper), and deep-link `location.pathname` → open that app on load.
- Top-bar tray icons (`NotificationBell`/`ThemeToggle`/`LanguageSwitcher`) are tuned for light backgrounds; may need contrast tweaks on the dark bar.
- Window state persists per browser; consider a "Reset desktop" action.
- Visual smoke test in a browser (drag/minimize/maximize/restore, dock indicators, launcher, RTL, mobile) before deploy.

### Post-MVP enhancements — DONE
- **Desktop notifications**: new `DesktopToasts.tsx` — subscribes to `useNotifications()`, shows new (post-load) notifications as Ubuntu-style toast popups in the top-right, auto-dismiss after 6s, dismiss marks read. Seeded so existing unread don't spam. Replaces/extends the in-app bell for the desktop shell.
- **Right-click desktop menu**: `DesktopContextMenu.tsx` opened by right-clicking the wallpaper; options: Open Applications, Change Wallpaper (cycles 4 gradients), Reset Desktop Layout (clears window store). `Wallpaper.tsx` gained `variant` + `onContextMenu`.
- **Keyboard shortcuts** (`Desktop.tsx` global handler): `Super/Meta` → toggle launcher; `Esc` → close launcher or focused window; `Alt+Tab` → cycle window focus; `Ctrl/Cmd+W` → close focused window.
- `window-store.tsx` gained `RESET` action + `reset()` (clears windows/localStorage).
- Added `desktop.changeWallpaper` / `desktop.resetDesktop` i18n keys (en/ar).
- `pnpm typecheck` + `pnpm build` clean.

### Window refinements — DONE
- **Hide page sidebar in windows**: `Layout.tsx` now returns bare `<main>` (no sidebar/top-nav) when `isDesktopMode()` — pages wrap themselves in `Layout`, so the desktop window shows only page content. Added `p-4 md:p-6` scroll wrapper; window body stays `overflow-auto`.
- **SVG window controls**: replaced lucide `Minus/Square/X` with custom SVG min/max/restore/close glyphs in `Window.tsx`.
- **8-direction resize**: edges + corners (`RESIZE_HANDLES`) with pointer-driven `setRect()`; SE corner shows an SVG grip. Added `SET_RECT` action + `setRect()` to `window-store.tsx`.
- **Animations**: `AnimatePresence` wrap in `Desktop.tsx`; windows animate open (scale/opacity), close (exit), and minimize (scale-to-hidden, kept mounted so dock restore animates back). Size changes (maximize/restore/resize) use a `transition-[width,height]` tween.

### How to verify / deploy
- `cd artifacts/research-data && pnpm dev` → open `http://localhost:5173/?desktop=1` (or set host to a non-`www.` name) to see the Ubuntu desktop; `?desktop=0` or `www.` host for classic.
- `pnpm build && pnpm deploy` (existing `research` worker) ships both shells in one `./public`; the worker/edge config is unchanged.
