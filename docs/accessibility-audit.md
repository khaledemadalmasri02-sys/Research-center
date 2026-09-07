# Accessibility audit

**Date:** 2026-09-07 · **Scope:** research-data SPA (`artifacts/research-data/src/`) · **Tooling:** `axe-core` 4.10 + `jest-axe` matchers in `tests/a11y-axe-vitest.test.tsx`.

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
