# Accessibility audit

**Date:** 2026-09-07 · **Scope:** research-data SPA (`artifacts/research-data/src/`) · **Tooling:** `axe-core` 4.10 + `jest-axe` matchers in `tests/a11y-axe-vitest.test.tsx`.

> ## Remediation status addendum — 2026-10-19
>
> The body of this document below is the **original 2026-09-07 snapshot** and
> is left unedited so the original methodology and reasoning stay readable.
> This addendum is the current state. Every item was checked against the
> source at the cited `file:line` unless marked *taken on trust*.
>
> ### Colour contrast
>
> | Item | Status | Evidence |
> |---|---|---|
> | §1 `--muted-foreground` light contrast ("4.49:1, just under 4.5") | **FIXED** | `artifacts/research-data/src/index.css:127` — `215 16% 44%`, **4.79:1** on `--muted` (was `215 16% 47%` = 4.30:1). Note the original figure of 4.49 was measured against a white `--background`; against the token's real background (`--muted`) it was 4.30. Either way it is now above 4.5. |
> | §1 proposed `215 16% 40%` | **SUPERSEDED** | The shipped value is 44%, not 40%. Measured 4.79:1, which clears AA with margin; 40% would have been visually heavier than intended. |
> | §1 dark-mode muted foreground | unchanged | `index.css:262` — `215 20% 65%` = **5.76:1** on `--muted`. |
> | New: `--input` non-text contrast | **FIXED** | `index.css:163` (light `215 14% 52%` = **3.75:1** on `--background`), `:271` (dark `215 20% 48%` = **3.87:1**). Previously shared with `--border` at 1.19 / 1.21. Clears WCAG 1.4.11. |
> | New: dark `--destructive` | **FIXED (split)** | `index.css:265-268`. `--destructive` is now a *surface* token (`0 62% 42%`, 6.70:1 with white) and a new `--destructive-text` (`0 80% 66%`, **5.61:1** on `--card`) carries error text. The old single value `0 62% 30%` was **1.75:1** on the dark card — that is the regression that made error messages invisible. |
> | New: dark `--primary` | **FIXED (split)** | `index.css:254-258`. `--primary` → `185 65% 30%` (white label 4.12 → **5.33**); new `--primary-text` `185 70% 58%` = **9.89:1** on `--card`. |
> | **Light `--destructive` with white text** | **STILL FAILING — open item** | `index.css:156` — `0 84% 60%` with `#fff` measures **3.78:1**, below the 4.5:1 needed for normal-size text. Do not report light-mode destructive buttons as AA-compliant. Recorded in `STATUS.md` "Still open" #7. |
>
> ### Focus
>
> | Item | Status | Evidence |
> |---|---|---|
> | 1 px focus rings | **FIXED** | `components/ui/button.tsx:8`, `components/ui/input.tsx:11`, `components/ui/checkbox.tsx:26` all moved `focus-visible:ring-1` → `focus-visible:ring-2` with `ring-offset-1 ring-offset-background`. WCAG 2.2 SC **2.4.11 Focus Appearance (AA)**. |
> | 16 px checkboxes below the target-size minimum | **FIXED** | `components/ui/checkbox.tsx:20-26` — visual box stays `h-4 w-4`; the hit area is grown with `after:absolute after:-inset-1.5` (16 + 2×6 = **28 px**) inside a `pointer-events-none h-6 w-6` wrapper. WCAG **2.5.8 Target Size (Minimum, AA)**. |
> | Global `outline: none` on inputs / textareas / selects | **FIXED** | `index.css:481-491` — the suppression rule is gone and replaced by a comment explaining why it must not return: bare `border-input` inputs carry no focus utility and were left with no indicator. |
> | `:focus-visible` `border-radius` shape mutation | **FIXED** | The global rule (`index.css:476-479`) and the auth-screen rule (`index.css:730-733`) no longer set `border-radius`. An outline follows the element's own radius; setting one squared off `rounded-full` avatars and `rounded-2xl` cards while focused. |
> | `prefers-contrast` unhandled | **FIXED** | `index.css:742-759` — overrides `--border`/`--input`/`--muted-foreground` per mode and raises the focus ring to `3px solid CanvasText`. |
> | `prefers-reduced-data` unhandled | **FIXED** | `index.css:762-771` — strips `backdrop-filter` from `.glass-panel` and removes all `radial-gradient`/`linear-gradient` backgrounds. |
> | `color-scheme` undeclared | **FIXED** | `index.css:80` (`color-scheme: light`) and `:226` (`color-scheme: dark`). Without it, native widgets (`<select>` popups, date pickers, scrollbars, autofill) rendered in light appearance while `.dark` was active. |
> | No `@media print` | **FIXED** | `index.css:870-946`. Hides `[data-print="chrome"]` / `[data-print="hidden"]` and every portalled Radix layer, unclips `main` for pagination, repeats `thead`, zeroes animation. **Not a compliance control** — it removes chrome, does not redact PHI or decide what may be printed. |
> | No RTL foundation | **FIXED (documented convention)** | `index.css:773-845`. Logical properties are now mandatory for new code. **Enforced by review only — there is no lint rule**, so a physical utility can still land. |
>
> ### Semantics
>
> | Item | Status | Evidence |
> |---|---|---|
> | Unlabelled `<Label>` elements | **STILL VALID** | Measured 2026-10-19: **48 `<Label` render sites** in `src/**/*.tsx`; 19 are wired to a control via `htmlFor` or a form context, **~29 are not** — and those are siblings, not wrappers, so they are implicitly unassociated. Concentrated in `pages/data-analysis/AnalysisBuilder.tsx` (10 of 13 unwired), `pages/data-analysis/LandingView.tsx` (8 of 8), `pages/data-analysis/VariableSelect.tsx` (2), `pages/ml.tsx` (2), `pages/validation.tsx` (3), `pages/theme-manager.tsx` (3), `pages/record-definition-edit.tsx` (1). The wired helpers are `components/field-row.tsx:74` and `components/ui/form-field.tsx:49` (both `htmlFor`). **This was reported as "53 unlabelled Labels" and is not fixed.** |
> | Nested interactive elements — saved-view menu | **FIXED** | `components/records-toolbar.tsx:145-186`. Each item was a `DropdownMenuItem` wrapping two `<button>`s (apply + delete), unreachable by keyboard because Radix menus trap Tab and activate with Enter/Space via `onSelect`. The item is now the apply action; delete moved into a `DropdownMenuSub`. |
> | Nested interactive elements — notification menu | **FIXED** | `components/notification-bell.tsx:75-104`. Navigation is driven from `onSelect` with `e.preventDefault()` and `useDesktopNav`/`navigate`, not from a nested `<Link>`'s `onClick`. The "mark all" button also sets `onSelect={(e) => e.preventDefault()}`. |
> | `<button>` wrapping the select-all checkbox | **FIXED** | `components/ui/data-table.tsx:302-309`. The `select` column header previously rendered the checkbox inside the sort `<button>`, producing `<button><button role="checkbox">` — invalid nesting and two tab stops. The select column now renders the header in a plain `<span>`. |
> | No `aria-sort` | **FIXED** | `components/ui/data-table.tsx:287-295`. Set on the `<th>` (a column property), not on the inner sort button, which previously only changed `aria-label`. Values: `ascending` / `descending` / `none` / absent when unsortable. |
> | No `aria-rowcount` / `aria-rowindex` | **FIXED** | `components/ui/data-table.tsx:270` (`aria-rowcount={rows.length + 1}`), `:275` (header `aria-rowindex={1}`), `:373` (`aria-rowindex={vr.index + 2}` for virtual rows). Also `aria-colcount`. |
>
> ### Focus management
>
> | Item | Status | Evidence |
> |---|---|---|
> | No focus management on route change | **FIXED** | `components/layout.tsx:71-90` (`useRouteFocus`, called at `:101`) moves focus to `#main-content` on route change, skipping the first render and collapsing in-record navigation (`/patients/123` → `/patients/124`) so focus is not yanked away from the button the user just pressed. Focus moves inside a `requestAnimationFrame`. |
> | Skip-to-content target focus styling | **FIXED** | `components/skip-to-content.tsx:20` uses `focus:ring-2 focus:ring-ring focus:ring-offset-2` alongside `focus:not-sr-only`. |
> | Duplicate `#main-content` ids in the desktop shell | **FIXED** | `components/desktop/Desktop.tsx:166-174` keeps the id only on the focused window's `<main>` and demotes the rest to `main-content-inactive`. |
> | Product tour 14/14 broken | **FIXED** | `hooks/use-product-tour.ts:32-46` replaced `a[href="/…"]` selectors with `[data-tour="<key>"]` (the sidebar renders `<button>`s, so the old selectors never matched and every step silently degraded to a context-free card). Anchors now exist in all three shells: `components/desktop/Dock.tsx:116,215` (`TOUR_KEY` map at `:18-29`), `components/layout.tsx:209`, `components/sidebar/AppSidebar.tsx:184`, plus `notification-bell.tsx:42`, `theme-toggle.tsx:32`, `AppSidebar.tsx:315`, `language-switcher.tsx:21`. A step whose target is absent from the DOM is **dropped** rather than rendered. |
> | ErrorBoundary does not announce the crash | **FIXED** | `components/ErrorBoundary.tsx:66` — the fallback carries `role="alert"`. |
> | OtpVerification does not move focus to the success heading (§5) | **STILL VALID** | `components/auth/OtpVerification.tsx:108` — the auto-advance effect returns early for `status === "verifying" \|\| status === "success"`, and there is no heading ref / `.focus()` on the success transition. All `.focus()` calls in the file target the OTP inputs. |
| OtpVerification heading level is a hardcoded `<h2>` (§2) | **STILL VALID** | No `headingLevel` prop was added. Low impact — the current usage is correct everywhere it ships. |
>
> ### CI gate
>
> | Item | Status | Evidence |
> |---|---|---|
> | Page-level axe not in CI | **FIXED** | `.github/workflows/a11y.yml` (new, untracked in git at the time of writing) runs `@axe-core/playwright` over both shells via a matrix (`shell: [classic, desktop]`) against `tests/a11y-pages/`. Only `serious` and `critical` violations block. |
> | The a11y gate can self-disable | **FIXED** | Previously `test.skip()`ed when the app redirected to `/login` or when the dock was missing, so a broken auth boundary or a desktop-shell regression could never fail CI. Now both specs **hard-fail** (`tests/a11y-pages/a11y-pages-classic.spec.ts:48-59`, `a11y-pages-desktop.spec.ts:29-51`), authenticated routes are given a mocked session via `GET /api/auth/me` rather than a `localStorage` token nothing reads, and the workflow itself exits 1 if `tests/a11y-pages` is missing. |
>
> ### Still open
>
> - ~29 unassociated `<Label>` elements (see above).
> - `aria-describedby` on ad-hoc fields — unchanged; `<FormField>` handles the description slot but hand-rolled fields do not.
> - `<CommandPalette>` focus restoration on close — still needs a manual pass.
> - Light `--destructive` white-label contrast (3.78:1).
> - No page-level axe coverage for the **mockup-sandbox** SPA; the workflow only builds `artifacts/research-data`.
> - No screen-reader smoke in CI. The methodology in §4 is still manual-only.

---

Original audit, unchanged from 2026-09-07:

This is a *snapshot* audit. The automated tests run in CI on every push; this document is the human-readable write-up of the methodology, the patterns that were found, and the remediation rules the team has agreed to follow going forward.

## Methodology

1. **Component-level axe scans.** Every interactive primitive that ships to a user (`Button`, `Input`, `OtpVerification`, `ThemeToggle`, modal dialogs, sidebar) renders under jsdom and is scanned with `axe.run(container)`. The test files assert `toHaveNoViolations()` for the WCAG 2.1 AA rules that `axe-core` covers out of the box (color contrast, ARIA, label, name, role, focus order, etc.).
2. **Manual review of the page shells.** Page-level audits (`/`, `/patients`, `/records`, `/auth`, `/admin`, …) need a real browser because they depend on focus management across the full DOM, the layout grid, and route changes. Those are run with `axe.run()` from the browser devtools on the dev server before each release.
3. **Keyboard-only walk-through.** Every interactive control is tab-reachable, focusable elements have a visible focus ring, and the tab order matches the visual order. We use `Tab`, `Shift+Tab`, `Enter`, `Space`, arrow keys, and `Esc` to verify the page.
4. **Screen reader smoke.** VoiceOver on macOS and NVDA on Windows are run on the auth, patient, and record pages. We check that headings, landmarks, form fields, and live regions are announced correctly.

The automated tests catch ~60% of issues. The remaining 40% (color contrast in custom themes, focus traps in modals, screen reader announcement of dynamic content) are caught by the manual checks.

## Findings (P3.4, audited 2026-09-07)

The audit was deliberately scoped to the components already touched by P2.2 (the new vitest component tests). It found **no serious or critical axe violations** in the scanned components, but it surfaced three classes of issue to keep an eye on:

### 1. Color contrast for the "muted" foreground text — *partial fix needed*

`text-muted-foreground` resolves to `hsl(215 16% 47%)` in the default light theme. On the default `bg-background` (`hsl(0 0% 100%)`) that is **4.49:1**, just under the 4.5:1 WCAG AA threshold for normal text. Bold weight passes (4.5:1), regular weight fails by 0.01.

**Action:** bumped `--muted-foreground` to `hsl(215 16% 40%)` (~5.4:1) in the next theme revision. Tracked in P3.2 (dark mode + system preference). For now, every new component that uses `text-muted-foreground` should be reviewed and the copy should be checked at regular weight.

### 2. OtpVerification success-heading level

The component uses `<h2>` for the "Verified!" heading. On pages that already have an `<h1>` (e.g. `/auth`, which renders a Card with an `<h1>`), this is correct. But when OtpVerification is mounted as the only heading on the page (rare today, possible in the future), the heading level skips. The fix is to make the heading level a prop (`headingLevel?: 1 | 2 | 3`, default 2) and document the cases. **No change in this PR** — the current usage is correct everywhere it ships.

### 3. Decorative gradients on the OtpVerification frame

The "rainbow-glow frame ring" is a `conic-gradient` pseudo-element with `aria-hidden="true"`. Screen readers correctly ignore it. Visually, it animates by default; `prefers-reduced-motion` (already detected via `useReducedMotion()`) freezes it. Confirmed working with VoiceOver + reduced-motion on.

### 4. Live regions for crash reports and OTP errors

- `OtpVerification` has an `aria-live="assertive"` region below the boxes for the "Incorrect code" message and the "A new code has been sent" confirmation. ✓
- The crash reporter's `ErrorBoundary` does not announce the crash to screen readers. The error fallback is rendered statically; a screen reader user who triggers a crash gets a silent failure. **Action:** add an `aria-live="assertive"` + visually-hidden "An error occurred. Please reload the page." text inside the fallback. Tracked under the FOUC/theme work in P3.5.

### 5. Focus management after a successful OTP verify

`OtpVerification` clears the boxes and re-focuses the first input on failure. On success, it switches the heading to "Verified!" but does **not** move focus to the heading. A screen reader user will hear the new heading only if they navigate forward. **Action:** add a ref to the heading and call `.focus()` when `status` transitions to "success" — same React effect pattern as the existing auto-verify effect.

### 6. Skip-to-content link

A `<SkipLink>` already exists in the tree (`src/components/skip-to-content.tsx` per the untracked-tree). It is rendered as the first child of the body and reveals on focus, jumping to `#main-content`. The main content area sets `id="main-content"` and `tabIndex={-1}` so the link target can receive programmatic focus. Confirmed working with keyboard.

### 7. Live announcer for sound effects

The SoundProvider announces "Completed" / "Error" / "Notification" via `useLiveAnnouncer` for high-signal sounds. This is the right pattern for SR users — the chirp is informative but the announcement is the real signal. Confirmed.

## Rules for new components

Going forward, every new component must satisfy:

- **Every interactive element** (`<button>`, `<a>`, `<input>`, custom controls) has an accessible name. Either visible text, `aria-label`, or `aria-labelledby`.
- **Form fields** are paired with a `<Label htmlFor>` or wrapped in `<FormField>` (which sets the `for` automatically).
- **Buttons with only an icon** have an `aria-label` or a visually-hidden text alternative.
- **Modals** use Radix `<Dialog>`, which handles focus trap, escape, and `aria-modal`. Custom modal components must replicate this or use Radix.
- **Animations** respect `prefers-reduced-motion`. Use the `useReducedMotion` hook from `framer-motion` (already mocked in test setup).
- **Live regions** are used for any async state change the user needs to know about (form errors, success messages, status changes).
- **Color is never the only signal.** Status badges have a shape or text label in addition to color.
- **No `tabIndex` > 0.** Tab order follows the document order. Use `tabIndex={-1}` only for programmatically focusable elements that should not be in the tab order (modal content, headings reached by skip link).

## Running the audit locally

```bash
cd artifacts/research-data
pnpm test:a11y
```

This runs `vitest run --config vitest.config.ts tests/a11y` which picks up the `*-vitest.test.tsx` files. The a11y tests are the files prefixed with `a11y-` and live next to the rest of the vitest suite. They run in jsdom so the full render pipeline is exercised without needing a browser.

## Adding a new component to the audit

1. Write the component with the rules above.
2. Add a test in `tests/a11y-<name>-vitest.test.tsx` that renders the component and asserts `await axe(container)` has no violations.
3. If the component has dynamic states (success / error / loading), render each state in a separate test and assert each is clean.
4. If the component uses a Radix primitive (Dialog, AlertDialog, Popover, etc.), the Radix wrapper handles most of the a11y for you — assert only the rendered output.

## Known gaps

- The page-level (not component-level) audit is not in CI yet. The plan is to add a Playwright e2e step that loads each route with `@axe-core/playwright` and asserts zero serious/critical violations. Tracked under P3.4 follow-ups.
- `aria-describedby` is rarely set on form fields. The `<FormField>` component handles the description slot, but ad-hoc form fields that need a hint do not. Code review should catch these; a test helper could enforce it.
- The `<CommandPalette>` (untracked tree) is keyboard-driven. The `cmdk` library handles most of the a11y, but a manual pass is needed to confirm focus is restored to the trigger on close.
- Reduced-motion is respected for animations, but the SoundProvider's auto-mute on `prefers-reduced-motion` is a behaviour change, not a UI change. Some users want the sounds off without it being a global default. A per-component `prefersReducedMotion` opt-out could be added later.
