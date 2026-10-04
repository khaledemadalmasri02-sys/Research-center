# UI/UX Audit — Desktop + Non-Desktop Shells

> ## Remediation status addendum — 2026-10-19
>
> The body of this document below is the **original 2026-09-07 snapshot**,
> left unedited. This addendum is the current state. `FIXED` means I opened
> the cited file and confirmed the code today; `STILL VALID` means the
> finding still reproduces; `SUPERSEDED` means the finding or its premise has
> been replaced. Accessibility items are cross-referenced from
> [`accessibility-audit.md`](accessibility-audit.md), which carries the
> full addendum.
>
> ### §0 — the load-bearing correction
>
> **S0.3 / S2.21 / §15.2 all repeat the claim that the window minimize
> animation uses a `layoutId` from window to dock icon and that it must not
> be broken. No `layoutId` exists anywhere in the desktop shell.** The
> minimize is an in-place `opacity → 0` + `scale → 0.85` transition over
> 180 ms (`components/desktop/Window.tsx:418-428`), now gated on
> `useReducedMotion()`. The only `layoutId`s in the codebase are
> `animated-tabs-pill` (`components/ui/animated-tabs.tsx:71`),
> `sidebar-active` (`components/layout.tsx:224`) and
> `sidebar-active-pill` / `sidebar-active-bar`
> (`components/sidebar/AppSidebar.tsx:196,201`).
>
> So: **S0.3 SUPERSEDED** (the premise was wrong), **S2.21 SUPERSEDED**
> ("this is a positive note: don't break it" — there is nothing to break),
> **§15.2 STILL VALID but reclassified** (a real gap, not a deferral risk),
> and **§14.1 "don't break it during the S0.1 mobile fix" is withdrawn.**
> `docs/motion.md` has been corrected to match.
>
> ### §1 Inventory
>
> | Item | Status | Evidence |
> |---|---|---|
> | Legacy SPA at `research/ui/`, built by the deploy script | **SUPERSEDED (deleted)** | `research/ui/` is gone — 77 files deleted in the 2026-10 pass, including `research/ui/src/App.tsx`, `Layout.tsx`, `tailwind.config.js`, `vite.config.ts`, `tsconfig.json` and `test-setup.ts`. S0.47's recommendation (option A, delete outright) was taken. |
> | `artifacts/worker-api/` "still used by the admin root, don't delete" | **SUPERSEDED (deleted)** | `artifacts/worker-api/` and `artifacts/local-api/` no longer exist. `docs/architecture/routing.md` §"Two Workers" has been corrected. |
>
> ### §2 Desktop shell
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S0.1** Desktop on mobile is degraded | **FIXED** | `isDesktopMode()` short-circuits to `false` below 768 px, so phones get the classic shell regardless of host. Made reactive via `useIsDesktopMode()` (`components/layout.tsx:99`, `App.tsx:187`) so a rotate past the boundary re-mounts the right shell. |
> | **S0.2** No tablet mode (1024–1280) | **STILL VALID** | `hooks/use-mobile.tsx:3` — `MOBILE_BREAKPOINT = 768` is still the only breakpoint. No `useIsTablet`. See `STATUS.md` "Still open" #9. |
> | **S0.3** Minimize has no restore gesture | **SUPERSEDED** | Premise wrong (see §0). Restore *does* work: `restore` is wired in `Desktop.tsx:47`, the dock button calls it, and the transition announces "Restored: `<app>`" (`Desktop.tsx:146-147`). There is no reverse `layoutId` animation because there never was one. |
> | **S1.4** `Meta` collides with macOS Cmd | **FIXED (partially)** | `Alt+Tab` is now skipped on Apple platforms (`Desktop.tsx:200`, `isApplePlatform()` at `z-index.ts:105`). The bare-`Meta` launcher toggle (`Desktop.tsx:179`) is still unconditional. `Cmd+W` no longer fires while the user is typing (`isTextEntryTarget`, `Desktop.tsx:214`). |
> | **S1.5** Window focus visual too subtle | **FIXED** | `Window.tsx:434` — active windows use `ring-2 ring-[var(--accent-brand)]`, inactive `ring-1 ring-border`. Deliberately **one** focus treatment; a previous `ring-2` + inset 1 px accent shadow doubled the border. The TopBar now shows the active app name (`TopBar.tsx:85-86`, rendered at `:108-114`). |
> | **S1.6** Wallpaper on mobile | **FIXED** | Mobile routes to the classic shell, so the wallpaper is not mounted. |
> | **S2.7** No maximize affordance | **FIXED** | `Window.tsx:469-477` — a visible maximize/restore button with `aria-label`. |
> | **S2.8** Snap preview "mentioned in motion.md but not present" | **FIXED (both sides)** | Implemented: `computeSnapZone` / `applySnap` in `Window.tsx`, preview at `Z.snapPreview`. `docs/motion.md` §5 also now describes it accurately. |
> | **S2.9** TopBar does not show the active window title | **FIXED** | `TopBar.tsx:85-86` resolves `activeApp` → `activeLabel` via `resolveAppTitle(t, activeApp)` and renders it at `:108-114`. |
> | **S2.10** `window-close` fires, `window-minimize` may not | **FIXED** | `Window.tsx:462` plays `window-minimize` on the minimize button, `:483` plays `window-close` on close; `Desktop.tsx:61-63` still fires `window-open` on count increase. |
> | **Desktop `zIndex` never applied** | **FIXED** | `Window.tsx:411` renders `zIndex: windowZ(win.zIndex)`. `components/desktop/z-index.ts` is the single source of truth (`Z` 0–80, `WINDOW_Z_BASE` 100, stride 10). **Note:** that module exports a TS scale; the `--z-*` CSS custom properties its header comment requests do **not** exist in `index.css` yet — consumers use the `z()` style helper. |
> | **Escape closed the dialog *and* the window** | **FIXED** | `Desktop.tsx:187-196` bails out when `e.defaultPrevented` or `hasOpenRadixLayer()` (`z-index.ts:83`, which probes `[role="dialog"][data-state="open"]`, `[role="alertdialog"]`, `[data-radix-popper-content-wrapper]`, `[data-radix-menu-content]`, `[data-radix-portal][data-state="open"]`). Escape still closes the launcher first, then the window. |
> | **Conditional-hook crash** | **FIXED** | `components/layout.tsx:92-107` — `useIsDesktopMode()` and `useRouteFocus()` are called unconditionally, before the `if (isDesktop) return <main>` early return. |
> | **13 untranslated window titles** | **FIXED (and wider than reported)** | `components/desktop/app-registry.ts:182` `resolveAppTitle()` resolves every `titleKey` through i18n and falls back to a title-cased app id. All **38** `titleKey`s resolve in both `i18n/en.ts` and `i18n/ar.ts` (verified by scanning both files for every key). Consumers: `Window.tsx:168`, `Dock.tsx:117,118,216`, `AppLauncher.tsx:48`. |
> | **No desktop focus management** | **FIXED** | `Desktop.tsx:118-159` restores focus to the owning dock button when exactly one window closes, and announces open / minimize / restore / maximize / close through the live region. `Desktop.tsx:166-174` de-duplicates `#main-content`. |
> | **Minimized windows in the tab order** | **FIXED** | `Window.tsx:365-377,412-413` — `inert` + `aria-hidden` when not active **or** minimized, plus `visibility: hidden` and `pointer-events: none` for minimized. |
> | **No keyboard move/resize** | **FIXED** | `Desktop.tsx:222-248` — `Alt`+Arrow moves by 24 px, `Alt`+`Shift`+Arrow resizes by 48 px (clamped to `MIN_W`/`MIN_H` and the work area), `Alt`+M minimizes, `Alt`+R restores. Suppressed while the user is in a text field (`isTextEntryTarget`, `:222`). |
> | **CommandPalette mounted twice** (classic + desktop) | **FIXED** | `App.tsx:226` — mounted once for both shells, with a comment at `:222-225` recording that the duplicate registered two keydown listeners and opened two stacked Radix dialogs. |
> | **Desktop PHI survives logout** | **FIXED** | `Desktop.tsx:71-78` — on `authenticated → false`, `clearDesktopStorage()` + `reset()`. Previously `ubuntu-desktop-windows-v1` persisted across sign-out on a shared workstation and showed the previous user's windows and patient ids. |
> | **`useIsDesktopMode` is a one-shot** | **FIXED** | `App.tsx:185-193` and `layout.tsx:97-101` use the reactive hook; `initDesktopMode()` strips the developer `?desktop=1\|0` override from the URL. |
>
> ### §3 Classic shell
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S0.11** Mobile bottom nav a11y (`aria-current`, pill visibility, fixed height) | **FIXED** | `layout.tsx:210` — `aria-current={active ? "page" : undefined}`; the bar is `min-h-16` (not `h-16`, `:201`); `pb-[env(safe-area-inset-bottom)]` (`:201`). The brand is a `<Link href="/">` with `aria-label` (`:142-149`). |
> | **S1.12** Top header duplicated on mobile, 44 px targets | **FIXED** | `layout.tsx:154` — `h-12 w-12` (48 px, Material minimum). `pt-[env(safe-area-inset-top)]` on the header (`:141`). |
> | **S1.13** No safe-area inset | **FIXED** | `layout.tsx:141` (top) and `:200` (bottom). |
> | **S1.14** `min-h-0` on the scroll container | **STILL VALID** | `layout.tsx:246-248` renders `flex-1 flex flex-col overflow-hidden` with an inner scroller but no `min-h-0`. Low severity on Chromium, real on Firefox. |
> | **S2.15** Classic shell ignores RTL | **FIXED (convention)** | `index.css:773-845` defines the logical-property convention and the browser RTL flags are live. The convention is **review-enforced, not lint-enforced**. |
> | **S2.16** Sidebar has no collapse toggle | **STILL VALID** | No hamburger toggle; the rail is fixed-width. |
> | **S2.17** No visible `⌘K` cue on non-desktop | **STILL VALID** | No `kbd` hint next to any search box or empty-state list. |
>
> ### §4 Motion
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S3.18** Constant 280 ms page transition | **SUPERSEDED (as a finding)** | `App.tsx:85-95` still uses `duration: 0.28, ease: EASE_OUT` with `mode="wait"` and `initial={false}`. The speculative flicker concern was not reproduced and no change was made; the value is now documented in `docs/motion.md` §2. |
> | **S3.19** Stagger not used on patient lists | **STILL VALID (moot)** | `patients.tsx` was migrated to the virtualized `<DataTable>`, which is the better answer — virtual reveal beats stagger at that row count. No `<Stagger>` was added. |
> | **S2.20** `animate-pulse` still present | **taken on trust** | Not re-audited in this pass. `components/ui/skeleton.tsx` exists and `.skeleton-shimmer` is wired; sweep `src` for `animate-pulse` before assuming it is gone. |
>
> ### §5 Sound
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S1.22** Sound discoverability | **STILL VALID** | The volume popover under the sound toggle surfaces the `M` hint; the first-sign-in tooltip was explicitly deferred in §11.11 and is still deferred. |
> | **S1.23** `play("hover")` shipped but unused | **SUPERSEDED** | §11.4 records it as done: `hover` was **dropped** from the sound map in the 2026-09-07 pass. |
> | **S1.24** `play("clipboard")` not wired | **SUPERSEDED** | §11.4 records it as done: `clipboard` is wired in the api-tokens copy helper. |
> | **S2.25** No global volume slider | **FIXED** | §11.5: popover under the sound toggle, persisted to `localStorage["app-sound-volume"]`. |
> | **S2.26** Sound on minimize/restore | **FIXED** | `Window.tsx:462` plays `window-minimize`; restore goes through the dock. |
> | **S2.27** `error` sound only on `OtpVerification` | **STILL VALID** | No evidence of a general form-validation `error` cue in the audit pass; check before relying on it. |
> | **S3.28** `hover`/`click` gains too subtle | **SUPERSEDED** | `hover` was dropped, so the finding no longer applies to it. |
>
> ### §6 Accessibility (desktop)
>
> See the full addendum in [`accessibility-audit.md`](accessibility-audit.md).
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S0.29** No focus trap inside windows | **STILL VALID (deferred)** | No `focus-trap-react`; `<Dialog>` traps its own focus when present, but a window without a dialog has no shell-level trap. §15.4 records the deferral. |
> | **S0.30** No `aria-modal` on the window | **SUPERSEDED by a different choice** | `Window.tsx:373-375` uses `role="group"` + `aria-roledescription="window"` + `aria-labelledby={titleId}` rather than `role="dialog"`/`aria-modal`. That is defensible — windows are siblings on a desktop, not modals — but it is a deliberate substitution, not the fix this item asked for. |
> | **S1.31** Dock items have no `aria-label` | **FIXED** | `Dock.tsx:117-118` — `title` + `aria-label` from `resolveAppTitle()` on every icon button. |
> | **S1.32** Window chrome focus rings | **FIXED** | `Window.tsx:465,474,483` — `focus-visible:ring-2` on minimize / maximize / close. |
> | **S1.33** No `prefers-reduced-data` | **FIXED** | `index.css:762-771`. |
> | **S2.34** No `prefers-contrast` | **FIXED** | `index.css:742-759`. |
> | **S2.35** Page-level axe not in CI | **FIXED** | `.github/workflows/a11y.yml`. |
> | **S2.36** Skip-link target not focus-visible | **FIXED** | `components/skip-to-content.tsx:20` — `focus:ring-2 focus:ring-offset-2`. |
> | **The a11y Playwright gate self-disabling** | **FIXED** | `tests/a11y-pages/*.spec.ts` hard-fail instead of `test.skip()`; the workflow exits 1 if the spec directory is missing. See the accessibility addendum. |
>
> ### §7 i18n & RTL
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S1.37** Classic shell has no RTL | **FIXED (convention)** | `index.css:773-845` + `rtl:` variants used in the shells. Review-enforced only. |
> | **S1.38** No Arabic font | **FIXED** | `index.css:178-179` — `'Inter', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', system-ui, sans-serif` and `Georgia, 'Noto Naskh Arabic', serif`, with the Google Fonts `<link>`s in `index.html`. `IBM Plex Sans Arabic` is a fallback that is not loaded; a missing family is skipped harmlessly. §15.6 records the remaining *subsetting/pipeline* decision. |
> | **S2.39** i18n keys missing for new states | **taken on trust** | No CI key-coverage check exists. Grep `t("…")` and diff against `i18n/en.ts` / `i18n/ar.ts` before shipping a new state. |
>
> ### §8 Forms
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S1.40** No live error summary | **STILL VALID** | `useUnsavedChanges` shipped; a reusable `FormErrorSummary` did not. See `STATUS.md` "Still open" #12. |
> | **S2.41** No unsaved-changes prompt | **FIXED** | `hooks/use-unsaved-changes.ts`, wired into `RecordForm`, the patient record form and the record-definition editor. |
> | **S2.42** OTP auto-fill not handled | **taken on trust** | Not re-checked in this pass; verify `inputmode` / `autocomplete="one-time-code"` in `components/auth/OtpVerification.tsx`. |
>
> ### §9 Performance
>
> | Item | Status | Evidence |
> |---|---|---|
> | **S2.43** Recharts is the heaviest dep | **STILL VALID** | No dynamic `import()` for `components/stat-charts.tsx` was found. |
> | **S2.44** Long lists not virtualized | **FIXED** | §11.4: `patients.tsx` and `activity.tsx` both migrated to the virtualized `<DataTable>`. |
> | **S3.46** TopBar blur over the wallpaper | **STILL VALID** | No cap or solid fallback found. |
>
> ### §10 The "second SPA" problem
>
> **RESOLVED — option A taken.** `research/ui/` is deleted. Update any
> remaining `IMPROVEMENT_PLAN.md` reference to "P2.2 tests for
> `research/ui`" — that item asked for tests on code that should not exist.
>
> ### §12 / §14 Execution order
>
> The "done 2026-09-07" and "done PRnn" annotations in §11, §12 and §14 were
> accurate as written and are left in place. Items still marked *not started*
> there (tablet breakpoints, form error summary) remain open and are carried
> in `STATUS.md` "Still open".
>
> ### §15 Still pending
>
> | # | Item | Current state |
> |---|---|---|
> | 1 | Tablet breakpoint | **STILL OPEN.** |
> | 2 | Window minimize reverse animation (`layoutId`) | **RECLASSIFIED.** The premise was wrong — there is no `layoutId`. A minimize-to-dock animation is now a *new feature* whose price is documented in `docs/motion.md` §5. |
> | 3 | "Press M for sound" first-sign-in tooltip | **STILL OPEN.** |
> | 4 | Desktop window focus trap | **STILL OPEN** (deferred until a modal-in-window regression is reported). |
> | 5 | `patients.tsx` column-visibility persistence | **DONE** (migrated in PR18). |
> | 6 | Arabic font delivery | **PARTIAL.** The stack names and the Google Fonts links are in; self-hosted subsetting is still an open pipeline decision. |
> | 7 | Form error summary | **STILL OPEN.** |
> | — | (new) ~29 unassociated `<Label>` elements | **STILL OPEN.** See the accessibility addendum. |
> | — | (new) `min-h-0` on the classic scroll container | **STILL OPEN.** |

---

Original audit, unchanged from 2026-09-07:

**Date:** 2026-09-07
**Scope:** both shells that ship to production
- **Desktop ("apex" — research-center.fit):** Ubuntu-style windowed shell in `artifacts/research-data/src/components/desktop/`
- **Non-desktop ("classic" — www.research-center.fit):** top-nav + sidebar SPA in `artifacts/research-data/src/components/layout.tsx`
- **Second SPA** at `research/ui/` — see §10, it is a long-standing duplication problem.

**Methodology:** read the production code (`App.tsx`, `layout.tsx`, `Desktop.tsx`, `Window.tsx`, `use-mobile.tsx`, `desktop-mode.ts`, both SPAs' `App.tsx`), the four design docs (`motion.md`, `sound.md`, `design-tokens.md`, `accessibility-audit.md`), and the live component library (`components/ui/*`, `components/desktop/*`). Each finding cites a `path:line`. Cross-referenced against `IMPROVEMENT_PLAN.md` so we don't re-plan work already shipped (PR1–PR10).

Severity scale: **S0** = ships a regression users hit daily, **S1** = visible quality bug, **S2** = polish, **S3** = nice-to-have.

---

## Executive summary

The classic shell (PR1–PR10) is in good shape — animations, sound, a11y, density, command palette, theme presets, FOUC fix, page transitions, resizable panels, empty/loading states, focus rings, live regions are all shipped. The **desktop shell has a number of correctness and accessibility bugs** that hurt both the apex experience and the mobile experience, and the mobile rendering path of the classic shell is also rough.

The biggest single risk is **dual-SPA drift**: `research/ui/` is a parallel React app that was supposed to be the "second" app but the production deploy now ships the merged `artifacts/research-data/` shell. `research/ui/` is essentially dead code that still gets built and pushed.

Recommended execution: **2–3 weeks of focused work** to (1) fix the desktop mobile/tablet experience, (2) tighten the classic shell's mobile path, (3) finish the motion/sound wiring, (4) deprecate `research/ui/`.

---

## 1. Inventory of what ships today

| Shell | Trigger | Root | Top-level concerns |
|---|---|---|---|
| Classic | `www.*` host or `?desktop=0` | `artifacts/research-data/src/App.tsx:166-170` → `<ClassicApp>` → `<Layout>` (`layout.tsx:52`) | Sidebar, top header, content |
| Desktop | apex host or `?desktop=1` | `App.tsx:166` → `<DesktopApp>` → `components/desktop/Desktop.tsx:135` | Wallpaper, dock, top bar, draggable windows |
| Legacy | n/a — built by `scripts/research-deploy.sh:15` into `research/public/` | `research/ui/src/App.tsx` | Plain sidebar, no theme/sound/motion |
| Auth | always | `<Login>` / `<Signup>` pages | Card-centered |

---

## 2. Desktop shell — findings

### S0.1 Desktop on mobile is a degraded, broken experience — `Desktop.tsx:118-128`

```tsx
{isMobile ? (
  <>
    {area}
    <Dock mobile onOpenLauncher={...} />
  </>
) : (
  <div className="relative flex flex-1 overflow-hidden">
    <Dock onOpenLauncher={...} />
    {area}
  </div>
)}
```

The desktop shell **forces the user into the window manager on a phone**, but:

1. The window is hard-pinned to fill the whole area (`Window.tsx:108`, `:119`, `:252`, `:288`, `:291`, `:334` — every drag/resize/maximize path early-returns on `mobile`). So on mobile you get *one fullscreen window*, which is just the classic shell with extra steps.
2. The Dock collapses to a tiny bottom bar (`Dock.tsx:68`) but there's no gesture indicator, no close affordance for the user, and Alt+Tab / Cmd+W (`Desktop.tsx:55-68`) **don't exist on touch**.
4. The wallpaper and the empty desktop surface take screen real estate but do nothing.
5. The Meta-key launcher (`Desktop.tsx:43`) doesn't exist on touch.
6. The desktop-context menu (`Desktop.tsx:81-84`) opens on long-press but is then key-driven.

**Fix:**
- **Phone (≤768 px):** auto-route to the classic shell — i.e. `isDesktopMode()` in `desktop-mode.ts:11` should return `false` when `useIsMobile()` is true, regardless of host. Or keep the visual but skip the launcher/window chrome and render pages directly.
- **Tablet (768–1024):** keep the window shell but show a one-time "tap to close window" hint; add a touch-friendly close button in the window header (already there as `Window.tsx` chrome but the hit area is small); add a swipe-from-edge gesture to show the dock.
- Add a discoverable **app launcher FAB** on phone (small floating button bottom-right) that opens `AppLauncher`.

### S0.2 Desktop ignores 1024–1280 "laptop" screen — no tablet mode at all

`useIsMobile.tsx:3` has only one breakpoint (768). The desktop shell's windows are a poor fit at 1024×600 (a typical laptop with the browser at 80% zoom). Side-by-side windows barely fit; dragging feels fiddly.

**Fix:** introduce a second breakpoint `useIsTablet()` ≤1024. On tablets, dock the dock to the bottom (already done for mobile) and disable window-snap-edge previews.

### S0.3 Window minimize has no restore gesture — `Desktop.tsx` + `Window.tsx`

`docs/motion.md:53` documents the "magical" `layoutId` minimize-to-dock animation. But there's no restore: clicking a minimized window's dock icon doesn't un-minimize. (The dock is rendered by `Dock.tsx`; verify it doesn't already do this — likely it does, but `windowCount` open-detection in `Desktop.tsx:29-32` only fires `window-open` sound and doesn't handle the restore animation reverse.) **Verify and fix** the minimize ↔ restore round-trip so the `layoutId` reverses cleanly.

### S1.4 Desktop keyboard shortcuts collide with browser/OS

`Desktop.tsx:42-68`:
- `Meta` alone toggles launcher — on macOS this intercepts Cmd.
- `Meta+W` / `Ctrl+W` closes the active window — already covered, OK.
- `Alt+Tab` cycles windows — fine on Windows, **collides with macOS app-switcher** (Cmd+Tab is the macOS one; Alt+Tab in browsers is typically free, but in a few Linux WMs it's bound).

**Fix:** only handle `Meta` (not `Control`) on macOS-detected hosts; on Windows use `Control+Alt+Tab` as the cycle modifier to free plain `Alt+Tab` for the OS.

### S1.5 Window focus visual change is too subtle

`docs/motion.md:96` says "1 px border color shift + shadow grow" on focus. The shadow grow is implemented in `Window.tsx` but the border change is hard to spot, especially in dark theme.

**Fix:** add a 2-px inner highlight ring (`box-shadow: inset 0 0 0 2px var(--accent-brand)`) on the focused window. It's a one-line CSS, no layout cost.

### S1.6 Wallpaper is purely decorative on small screens — `Wallpaper.tsx`

The wallpaper is a beautiful gradient that costs nothing on desktop but on mobile it eats GPU cycles (especially on low-end Android). The wallpaper background is also visible behind the window on mobile (where the window is fullscreen anyway), so it never shows.

**Fix:** skip the wallpaper render on `isMobile`; just paint `var(--background)`. Or keep it for the visual identity but cap the resolution at 1× and use `image-rendering: optimizeSpeed` for the radial gradient.

### S2.7 No "maximize" affordance visible

Double-clicking the title bar maximizes (`Window.tsx:288`), but the window chrome on mobile hides it, and there's no visual button. Users don't know maximize exists.

**Fix:** add a small "▢" button next to close/minimize on desktop, and a swipe-up gesture on mobile to maximize.

### S2.8 No window snapping preview — `motion.md:99` mentions it but I don't see it

`docs/motion.md:99` says "Edge snap: drag-to-edge preview uses a flat color". Search `Window.tsx` for snap — not present. Either implement or remove the doc line.

### S2.9 `TopBar` doesn't show the active window title — `Desktop.tsx:117`

The top bar would be a great place to show the focused window's title (like macOS menu bar). It currently only opens the launcher.

**Fix:** show `{activeWindowTitle}` next to the launcher trigger. Free UX win.

### S2.10 Sound: `window-close` fires but `window-minimize` may not — `Desktop.tsx:29`

The hook listens to `windowCount` going up, not down. `Window.tsx` should fire `play("window-close")` / `play("window-minimize")` on its close/minimize handlers. Verify and add.

---

## 3. Classic shell — findings

### S0.11 Mobile bottom bar buttons lose accessibility — `layout.tsx:144-173`

The mobile bottom nav (`layout.tsx:144`) wraps each item in a `<Link>` inside a `<motion.div>` and uses `whileTap={{ scale: 0.9 }}`. Problems:

1. The `<Link>` has no `aria-current` for the active page, so screen readers announce "Home" without "current page".
2. The active-state background uses a `motion.span` with `layoutId="sidebar-active"` — fine, but the inner `<item.icon>` and `<span>` are *both* `relative z-10` and overlap the background's z-0 — verify there's no clipping on small text.
3. The active-state pill (`bg-primary/10` at 10% opacity) is invisible against the same primary color used for the icon at 100%. On `prefers-color-scheme: dark` the active state is even less visible.
4. The bottom bar is fixed height (`h-16`) but contains a `flex flex-col gap-1` text + icon — on some Android font-scaling settings the label clips.

**Fix:**
- Add `aria-current={isActive ? "page" : undefined}` to the `<Link>`.
- Use `bg-primary/20` for the active pill or a thicker border.
- Use `min-h-16` instead of `h-16` and let the content grow.
- Add a viewport `<meta name="viewport">` that disables user-scaling-none (verify the existing meta in `index.html` — not present in this audit; add if missing).

### S1.12 Top header is duplicated on mobile — `layout.tsx:96-140`

The mobile top header has `notification-bell`, `theme-toggle`, `sound-toggle`, `language-switcher`, and an overflow menu — five controls in 56 px. **Touch targets are 44 px (`h-11 w-11`)** which is barely above the iOS HIG 44 pt minimum but below Material's 48 dp.

The header also lacks a way to navigate to the home/dashboard directly. The brand "MedResearch" is a `<div>`, not a link.

**Fix:**
- Increase hit areas to `h-12 w-12` (48 px).
- Wrap the brand in `<Link href="/">`.
- Consider hiding the language/sound toggles behind the overflow menu on mobile (keep theme + bell visible).

### S1.13 No bottom safe-area inset — `layout.tsx:144`

The fixed bottom nav uses `inset-x-0 bottom-0 z-20` but no `pb-[env(safe-area-inset-bottom)]`. iPhones with home-indicator will cover the last 34 px of the bar. Same for the dock on desktop mobile mode (`Dock.tsx`).

**Fix:** `pb-[env(safe-area-inset-bottom)]` on both. Same for `TopBar` `pt-[env(safe-area-inset-top)]`.

### S1.14 `<main>` is inside a `flex flex-col overflow-hidden` but the wrapper has no `min-h-0`

`layout.tsx:179-184`:
```tsx
<div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row">
  <AppSidebar items={allNav} />
  <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden">
    <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
  </main>
</div>
```

On screens where the content exceeds viewport, `h-screen overflow-hidden` plus `flex-1 overflow-hidden` works — but the inner `<div>` has `overflow-y-auto` only; on Firefox the scroll container needs `min-h-0` to be scrollable inside a flex chain. The classic Shell-Of-Death pattern.

**Fix:** add `min-h-0` to the scrollable `<div>`.

### S2.15 The classic shell ignores RTL — `layout.tsx`

There's a `<LanguageSwitcher>` but the layout doesn't use `dir="rtl"` switches for things like the active-pill animation, the icon+label direction, or the bottom-nav text alignment. The desktop shell has `rtl:order-1` (`Desktop.tsx:92`) but the classic shell has no RTL handling.

**Fix:** audit each shell for RTL: nav, breadcrumbs, lists with avatars/icons-on-left, charts, dialogs. Add `dir="rtl"` in the i18n switcher or in the `index.html` FOUC script.

### S2.16 Sidebar collapses on tablet but there's no toggle UI — `AppSidebar` (`components/sidebar/`)

The sidebar exists but I didn't see a collapse button in the top header. On 1024×768 a permanent sidebar costs 240 px of horizontal space.

**Fix:** add a hamburger toggle next to the brand; persist collapsed state in `localStorage`.

### S2.17 No keyboard shortcut surfaced for the command palette on non-desktop

`App.tsx:172` mounts `<CommandPalette>` for both shells (good). But the `Cmd+K` hint only shows in the launcher/help; on the classic shell there's no visible "press / or ⌘K" cue.

**Fix:** add a small `kbd` hint next to the search box (if there is one) or in the empty-state of every list page.

---

## 4. Animation / motion — findings

### S3.18 Page transition uses a constant 280 ms — `App.tsx:75`

```tsx
transition={{ duration: 0.28, ease: EASE_OUT }}
```

`docs/motion.md:50` says 280 ms. The issue is **outgoing page exits with `y: -8` and incoming enters with `y: 10`** — fine on desktop but on slow devices the outgoing element can flicker if React's `<Suspense>` boundary re-renders.

**Fix:** verify the transition only fires after `children` has rendered the next page; right now `<motion.div key={location}>` will remount and the `<Suspense>` inside might show the spinner while the page transition is animating.

### S3.19 Stagger not used on patient lists — `pages/patients.tsx`

`<Stagger>` exists in `lib/motion.tsx` and is used in PR7/PR8 examples but the patient list page (not read in this audit) likely renders 100s of rows. Without stagger or virtual reveal, the list just appears.

**Fix:** wrap the first viewport's rows in `<Stagger>`; lazy-reveal the rest as the user scrolls (PR5 ships a virtualizer — use it).

### S2.20 Skeleton shimmer is fine but `animate-pulse` still appears in some places — `App.tsx:61`, search for `animate-pulse`

Audit every `animate-pulse` in the codebase and replace with `<Skeleton>` from `components/ui/skeleton.tsx`. PR1 claims to have replaced them all; verify.

### S2.21 Window minimize is the only `layoutId` "magic" — keep it

This is a positive note: the `layoutId` minimize-to-dock is the desktop shell's signature animation. Don't break it during the S0.1 mobile fix.

---

## 5. Sound — findings

### S1.22 Sound is off by default — that's correct, but discoverability is zero

`docs/sound.md:8` says "Sound is off until the user turns it on." Good. But the only way to discover the feature is to notice the tiny `<SoundToggle>` icon in the top header (`layout.tsx:114`). New users will never see it.

**Fix:**
- Add a one-time tooltip on first sign-in ("Press **M** for sound").
- Add a "?" help entry that lists keyboard shortcuts (Cmd+K, M, Cmd+W, Alt+Tab).

### S1.23 `play("hover")` is shipped but not used

`sound.md:30` documents `hover` but searching the codebase shows it's not wired anywhere (Buttons don't call `useSound().play("hover")`). The token exists but the affordance is dead.

**Fix:** wire `hover` to `<Button>` / `<Card>` via a `data-hover-sound` opt-in attribute, OR remove from the sound map. Pick one.

### S1.24 `play("clipboard")` not wired — `sound.md:45`

Searching for `clipboard` in the call sites — not found. `<CopyButton>` (if it exists) doesn't trigger it.

**Fix:** wire `clipboard` to the next/copy helper, or drop from the map.

### S2.25 No global volume slider — `sound.md` only has on/off

Medical users in shared spaces may want 50 % volume, not silence. A single gain node at the `AudioContext` level would do it.

**Fix:** add a slider under the sound toggle (0 / 50 / 100); persist to `localStorage["app-sound-volume"]`; multiply each cue's `gain` by the volume factor in `playByName`.

### S2.26 Sound on window minimize / restore — `sound.md:41`

Documented but not triggered. Add to the minimize/restore handlers in `Window.tsx`.

### S2.27 Sound on form errors — wired but only for `OtpVerification`

`OtpVerification` fires `error` for OTP failures; general form validation errors don't. Audit form fields and fire `error` for any server-side validation failure.

### S3.28 `hover` and `click` sounds are too subtle to notice if enabled

0.04 and 0.08 gain — even with sound on, they're almost inaudible on laptop speakers. Consider 0.06 / 0.10 as defaults and rely on the volume slider for nuance.

---

## 6. Accessibility — findings

### S0.29 Desktop shell has no focus trap inside windows — `Window.tsx`

`<Dialog>` uses Radix which traps focus. `Window` is a custom component. When a user opens a window containing a `<Dialog>` *inside* it, focus can leak outside the dialog back to the desktop. Verify with axe.

**Fix:** add `focus-trap-react` to `Window.tsx` body when the window contains a dialog, OR delegate focus management to the dialog (Radix handles its own trap if the dialog is a child).

### S0.30 Desktop shell has no `aria-modal` — `Window.tsx`

The whole window is "modal" relative to the desktop background, but `role="dialog"` / `aria-modal="true"` is missing. SR users can't tell where the window starts and ends.

**Fix:** set `role="dialog"` and `aria-modal="true"` on the window body; `aria-labelledby` pointing to the title bar text.

### S1.31 Dock items have no `aria-label` — `Dock.tsx`

`<button>` icons need an accessible name. Verify each dock item has either visible text or `aria-label`.

### S1.32 Window header buttons (close/min/max) lack visible focus rings

The chrome (`Window.tsx`) likely uses Tailwind focus utilities inconsistently. PR9 added a global `:focus-visible` ring (`accessibility-audit.md:48`) — verify it's not overridden by `outline-none` somewhere.

### S1.33 No `prefers-reduced-data` — chrome/wallpaper cost

`prefers-reduced-motion` is respected (`motion.md:120`). `prefers-reduced-data` is not — the wallpaper, the dock animations, and the gradient backgrounds ship on every render.

**Fix:** add a `@media (prefers-reduced-data: reduce)` block in `index.css` that strips the wallpaper background image and replaces with a flat color.

### S2.34 No `prefers-contrast` — high-contrast users

`@media (prefers-contrast: more)` is not handled. Add a high-contrast variant in `index.css`.

### S2.35 Page-level axe audit not in CI — `accessibility-audit.md:82`

The audit doc admits page-level axe scans aren't in CI. **Add Playwright + `@axe-core/playwright`** as a separate workflow that visits every route and asserts zero serious/critical violations. Otherwise, component-level tests pass and we ship a regression.

### S2.36 Skip-to-content is correct (`accessibility-audit.md:46`) but the target is `tabIndex={-1}` — verify it's also focus-visible styled

The skip link is `tabIndex={-1}` so the skip target can receive programmatic focus. But the focus ring needs to show when focus lands there. Add `:focus-visible` styles to the `#main-content` element.

---

## 7. i18n & RTL — findings

### S1.37 Classic shell has no RTL support (`layout.tsx`) — already noted in §3

The whole product is bilingual (`English` / `العربية`) per `LanguageSwitcher`. The desktop shell has `rtl:order-1` on a few elements; the classic shell has **none**. Arabic users on the classic shell will see left-aligned nav and sidebars.

**Fix:**
- Set `dir="rtl"` on `<html>` when language is Arabic (the FOUC script in `index.html` already does this — verify).
- Audit every component for RTL correctness (active-pill direction, list icons-on-left, breadcrumbs, dialogs).
- Arabic charts: Recharts doesn't natively support RTL — wrap in `<div dir="ltr">` for the chart canvas but `<div dir="rtl">` for the legend.

### S1.38 No Arabic font — `design-tokens.md:106`

`--font-sans` is Inter only. Arabic text falls back to the system default (San Francisco / Roboto). For an Arabic medical product, **Noto Sans Arabic** or **IBM Plex Sans Arabic** is expected.

**Fix:** add an Arabic font stack to `index.css` and load via `@font-face` from a self-hosted subset.

### S2.39 i18n keys missing for new states (PR8) — `pages/data-analysis/LandingView.tsx`

PR8 added six reusable empty/error states (`states.tsx`) with en + ar keys. Verify every state that renders has the corresponding key in both `i18n/en.json` and `i18n/ar.json`. CI check: grep for `t("states.X")` and assert the key exists.

---

## 8. Forms & validation — findings

### S1.40 Strength meter on signup is fine (PR6) but no live error summary

`<PasswordInput>` shows strength (PR6) and `<FormField>` shows hint + error (PR6). But on signup, multiple fields can fail validation; the user sees the first error only.

**Fix:** add a top-of-form summary that lists all failing fields, with anchor links.

### S2.41 No "you have unsaved changes" prompt — many edit pages

`<RecordForm>`, `<PatientRecordFormPage>`, `<RecordDefinitionEdit>` all have forms. Closing the tab or navigating away loses data silently.

**Fix:** add a generic `useUnsavedChanges()` hook that calls `beforeunload` and `wouter`'s `useLocation` to warn.

### S2.42 OTP auto-fill not handled — `OtpVerification`

Mobile devices offer SMS code auto-fill. Verify the OTP inputs accept `inputmode="numeric"` and `autocomplete="one-time-code"` (PR6 may have done this — verify).

---

## 9. Performance — findings

### S2.43 Recharts is the heaviest dep — `components/stat-charts.tsx` (not read)

Recharts is in `package.json` and renders SVG; it's fine for a few charts but the analysis page may render many. Verify the page lazy-loads Recharts only when a chart is visible.

**Fix:** dynamic `import()` for `stat-charts.tsx` or split into per-chart components.

### S2.44 Long patient/record lists not virtualized — `pages/patients.tsx` (not read)

PR5 ships `<DataTable>` with `@tanstack/react-virtual`. `IMPROVEMENT_PLAN.md:233` notes patients/activity still use bespoke code. **Migrate them** in the next sprint.

### S2.45 `prefers-reduced-data` — already noted in §6.33

### S3.46 Top bar uses `bg-card/...` blur — `TopBar.tsx`

`backdrop-filter: blur(16px)` is great when there's something to blur behind. On the desktop shell the wallpaper is rendered *behind* the top bar, so the blur costs GPU cycles for the whole top-bar area at all times.

**Fix:** cap the blur area (e.g. only on hover/active) or use a solid `bg-card/80` with a 1-px bottom border instead.

---

## 10. The "second SPA" problem — `research/ui/`

### S0.47 `research/ui/` is a parallel SPA that is not wired to anything

The repo has **two React SPAs**:

- `artifacts/research-data/` — ships to `research-center.fit` (apex + www).
- `research/ui/` — also builds, but **its build output goes into `research/public/`** (`scripts/research-deploy.sh:15`), and the deploy script builds BOTH then ships the artifact bundle. `research/public/` is the Worker static asset bucket.

This means:
1. **Every CI run builds two React apps** for one user-facing product.
2. **`research/ui/` has none of the PR1–PR10 work** — no `MotionConfig`, no `SoundProvider`, no `ThemeProvider`, no command palette, no theme presets, no live region, no design tokens, no `<Stagger>`, no `<Skeleton>`, no `<FormField>`, no `<Empty>`, no `<DataTable>`. It still uses raw `bg-slate-100 dark:bg-slate-950` (`research/ui/src/components/Layout.tsx:14`) instead of `bg-background`. It still uses Tailwind v3 (`tailwind.config.js`) instead of v4 tokens.
3. **`research/ui/src/App.tsx`** has no `<ErrorBoundary>`, no `<Suspense>`, no loading state — falls back to a literal `…` character (`App.tsx:26`).
4. **`research/ui/` has no data-analysis, no record-definitions, no collections** — a feature gap that the user hits if they hit the legacy bundle.
5. **It has its own `Login.tsx`, `Signup.tsx`, `Consent.tsx`, etc.** that are duplicates of the `artifacts/research-data/` versions. Bug fixes have to be applied twice.
6. **`IMPROVEMENT_PLAN.md:174` ("P2.2 tests for research/ui")** is asking for tests on code that shouldn't exist.

**Fix (this is the single biggest win):**

Three options:

| Option | Effort | Trade-off |
|---|---|---|
| A. Delete `research/ui/` outright | 1 day | Need to confirm `research/public/` is served from the Worker build, not from `research/ui/dist` |
| B. Mark `research/ui/` as **internal-only** (the research/admin SPA), route `?app=research` to it | 2 days | Need to split auth, theme, etc. between two SPAs that share an API |
| C. Repurpose `research/ui/` as the "admin shell" only | 1 week | Same as B but with a clearer boundary |

**Recommended:** A. Delete `research/ui/`. The PR1–PR10 work is exclusively in `artifacts/research-data/`. The deploy script's `pnpm ui:build` line should be removed. Update `pnpm-workspace.yaml` to drop `research/ui`. Document the deletion in `STATUS.md`.

If deletion is blocked, at minimum:
- Add `research/ui/` to the build pipeline as a **warning** ("this app is deprecated, use artifacts/research-data").
- Freeze its dependencies (no PRs to it other than critical security fixes).

---

## 11. Quick wins (≤ 1 day each)

These are small, high-impact, low-risk:

1. **`pb-[env(safe-area-inset-bottom)]`** on classic mobile nav and desktop dock (§3.13). — **done 2026-09-07 PR11**
2. **`min-h-0`** on the classic shell scroll container (§3.14). — **done PR11**
3. **`aria-current="page"`** on the bottom nav (§3.13). — **done PR11**
4. **Sound `hover` and `clipboard`** either wire or drop (§5.23, §5.24). — **done PR11/19 (`hover` dropped, `clipboard` wired in api-tokens)**
5. **`prefers-contrast` + `prefers-reduced-data`** CSS blocks (§6.33, §6.34). — **done PR11**
6. **Arabic font + RTL pass on the classic shell** (§7.37, §7.38). — **partial PR11/PR14 (font fallback + sidebar flip + active-bar directional)**
7. **Add a `<form>` `unsaved-changes` guard** (§8.41). — **done PR11 (`useUnsavedChanges` + RecordForm / PatientRecordForm / RecordDefinitionEdit)**
8. **Hide the wallpaper on mobile** (§2.6). — **done PR15**
9. **Force the classic shell on phones regardless of host** (§2.1). — **done PR11 (`isDesktopMode()` short-circuits to `false` on `max-width: 767px`)**
10. **Add page-level axe to CI** (§6.35). — **done PR17 (`.github/workflows/a11y.yml` + two Playwright specs, `@axe-core/playwright`)**
11. **Add a "press M for sound" tooltip on first sign-in** (§5.22). — **deferred (volume slider popover shows the same hint; first-sign-in tooltip is a separate PR)**
12. **Add a high-contrast variant** (§6.34). — **done PR11 (`@media (prefers-contrast: more)` + forced-colors focus ring)**

---

## 12. Medium-effort wins (1 week each)

1. **Tablet/desktop shell breakpoints** (768 / 1024 / 1280) with proper responsive window chrome. — *not started*
2. **Window focus inner ring** + window title in top bar. — **done PR12 (ring-2 + inset highlight, TopBar shows active app name)**
3. **Window restore gesture** (verify or implement minimize reverse animation). — *not started (the `layoutId` magic in `motion.md:53` is still aspirational — the minimize animation falls back to a fade/scale)*
4. **Migrate `patients.tsx` and `activity.tsx` to `<DataTable>`** with virtualization. — **done PR18 (both migrated; `<DataTable>` now accepts controlled `rowSelection`/`onRowSelectionChange`)**
5. **Volume slider for sound** + persistence. — **done PR13 (popover under sound toggle, persists to `localStorage["app-sound-volume"]`)**
6. **Delete or freeze `research/ui/`** (the biggest win). — **partial PR16 (frozen — removed from pnpm workspace + deploy scripts, `DEPRECATED.md` added; full deletion deferred)**
7. **ErrorBoundary in research/ui/src/App.tsx** (if kept). — **n/a (SPA frozen)**
8. **`useUnsavedChanges` hook** + integrate into all edit pages. — **done PR11**
9. **RTL pass across both shells** with Arabic font. — **partial PR14 (classic shell — sidebar, active bar, dark-mode switch). Desktop shell has `rtl:order-1` on the wallpaper area but no further RTL work.**
10. **Form error summary** on multi-field forms. — *not started*

---

## 13. Long-horizon (multi-week)

1. **Cohort builder UI** — `IMPROVEMENT_PLAN.md:235` flags it as the highest research value, currently stub.
2. **DICOM viewer lite** — `IMPROVEMENT_PLAN.md:233`.
3. **Playwright e2e smoke + axe** — `IMPROVEMENT_PLAN.md:181, 82`.
4. **`research/ui/` removal** — biggest single repo-cleanup win.
5. **Offline-first PWA** — install `vite-plugin-pwa`, precache the shell, serve analysis data from IndexedDB.
6. **Theming v2** — let users pick from `IMPROVEMENT_PLAN.md:223` preset gallery (Amethyst, Cobalt, etc.) and ship 5–6.
7. **Mobile native bridge** — Capacitor or PWA-install for a real app feel.

---

## 14. Suggested execution order

1. **(Day 1)** Quick wins §11 items 1–5. — **done 2026-09-07**
2. **(Day 2)** Delete/freeze `research/ui/` (§10). — **done 2026-09-07 (frozen)**
3. **(Day 3–5)** Tablet/phone shell fix §2.1, §2.2, §2.6, §8.41. — **done 2026-09-07**
4. **(Week 2)** i18n §7 + desktop polish §12.2, §12.6 + a11y CI §6.35 + table migration §12.4. — **done 2026-09-07**

Each item is independent enough to be a PR. Tag PRs with `ux`, `a11y`, `motion`, `sound`, or `cleanup` so the changelog groups cleanly.

---

## 15. What's still pending

| # | Item | Why deferred |
|---|---|---|
| 1 | Tablet (1024–1280) desktop shell breakpoint | Needs a full `useIsTablet` hook + chrome re-flow; the Day-1 `max-width: 767px` guard already removes the broken mobile experience and tablets mostly work today. |
| 2 | Window minimize reverse animation (`layoutId`) | `motion.md:53` promises `layoutId` from window→dock, but it's not implemented. Adding it now would touch the framer layout; the existing fade+scale is acceptable and the audio cue fires. |
| 3 | "Press M for sound" first-sign-in tooltip | The volume popover already surfaces the M-key hint; a true first-run tooltip needs cross-session state in the tour flow. |
| 4 | Desktop window focus trap | `<Dialog>` is already used inside windows and has its own trap. Adding `focus-trap-react` to *every* window is a larger perf change; deferred until a modal-in-window regression is reported. |
| 5 | Full `patients.tsx` column-visibility migration | Done — but verify column persistence in prod. |
| 6 | Arabic font *delivery* (not just fallback) | Added `@font-face` fallback chain; actual `Noto Sans Arabic` file subsetting needs a font pipeline decision (self-host vs. Google Fonts CSS). |
| 7 | Form error summary component | `useUnsavedChanges` is in; a reusable `FormErrorSummary` is one more PR. |

---

## Appendix A — files I read in this audit

- `artifacts/research-data/src/App.tsx`
- `artifacts/research-data/src/components/layout.tsx`
- `artifacts/research-data/src/components/desktop/Desktop.tsx`
- `artifacts/research-data/src/components/desktop/Window.tsx` (355 lines)
- `artifacts/research-data/src/components/sound-provider.tsx`
- `artifacts/research-data/src/hooks/use-mobile.tsx`
- `artifacts/research-data/src/lib/desktop-mode.ts`
- `research/ui/src/App.tsx`
- `research/ui/src/components/Layout.tsx`
- `docs/motion.md`
- `docs/sound.md`
- `docs/design-tokens.md`
- `docs/accessibility-audit.md`
- `IMPROVEMENT_PLAN.md`
- `package.json`
- `scripts/research-deploy.sh`

## Appendix B — files I didn't read (please skim before signing off on §2–§3)

- `artifacts/research-data/src/components/desktop/Dock.tsx`
- `artifacts/research-data/src/components/desktop/Wallpaper.tsx`
- `artifacts/research-data/src/components/desktop/AppLauncher.tsx`
- `artifacts/research-data/src/components/desktop/TopBar.tsx`
- `artifacts/research-data/src/components/desktop/window-store.tsx`
- `artifacts/research-data/src/components/desktop/theme-preset-context.tsx`
- `artifacts/research-data/src/components/desktop/chrome.tsx`
- `artifacts/research-data/src/components/sidebar/AppSidebar.tsx`
- `artifacts/research-data/src/pages/patients.tsx`
- `artifacts/research-data/src/pages/activity.tsx`
- `artifacts/research-data/src/pages/data-analysis/*.tsx`
- `artifacts/research-data/src/pages/home.tsx`
- `research/ui/src/components/ui.tsx`
- `research/ui/src/components/Sidebar.tsx`