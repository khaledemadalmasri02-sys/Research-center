# Contributing to MedResearch Data Collection

## Prerequisites

- **Node.js 22.6+** (`package.json` `engines.node` is `>=22.6`)
- pnpm (CI uses 11)
- Docker, for Postgres + MinIO and for the Testcontainers-backed
  api-server test suite

`pnpm install` also runs the root `prepare` script, which sets
`git config core.hooksPath .githooks`. That is what installs the
pre-commit hook — you do not need to run `git config` yourself, and a
clone that has not run `pnpm install` has no hook.

## Development Workflow

1. **Fork the repo** and create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Run the typecheck** before committing:
   ```bash
   pnpm run typecheck
   ```

3. **Run the test suites.** `pnpm test` at the root runs **only**
   research-data and the Worker — the api-server and `@workspace/stats`
   suites have to be invoked explicitly:
   ```bash
   pnpm --filter @workspace/research-data test
   pnpm --filter research-worker test
   pnpm --filter @workspace/api-server test     # needs Docker (Testcontainers)
   pnpm --filter @workspace/stats test
   # or all four, in dependency order:
   pnpm run verify
   ```

4. **Commit with a clear message**:
   - Prefix with the relevant area: `P0.1:`, `P1.2:`, etc.
   - Reference the improvement plan: `See IMPROVEMENT_PLAN.md #XX`

5. **Push and open a PR** against `main`.

## Code Style

- Follow the existing code style in each package.
- `pnpm run lint` and `pnpm run format` — the pre-commit hook runs
  `prettier --check`, `eslint` and `gitleaks protect --staged` on staged
  files, and an OpenAPI codegen drift check when `lib/api-spec/**` or
  `lib/api-client-react/src/generated/**` are staged.
- Ensure `pnpm run typecheck` passes.

## Security

- **Never commit real credentials**. If you accidentally commit a secret:
  1. Revoke it immediately (Brevo dashboard, MinIO, etc.).
  2. Run the history scrub (same as P0.1+0.2).
  3. Add the pattern to `.gitleaks.toml` allowlist if it's a dev default.
  4. Notify the team.

- **Do not trust a doc claim about a control.** Several controls in this
  repo were documented and not running (the Worker's CSRF guard, the
  login-OTP rate limit, the "no PHI in crash reports" claim, the object ACL
  on the read path). Before you rely on a security property — or before you
  delete the code that implements it — open the file and confirm it. If a
  doc is wrong, fix the doc, and record the gap in
  `SECURITY.md` §"Known gaps" or `STATUS.md` §"Still open".

- **Rate limits are per-IP, and the per-IP key is `clientIp()`**, which
  honours `X-Forwarded-For` only from `TRUSTED_PROXY_CIDRS`. Two env vars
  that the code reads are documented nowhere: `TRUSTED_PROXY_CIDRS` and
  `ERASURE_SECRET`. Add them to the right `.env.example` if you touch them.

## Adding New Features

1. Add the feature to `IMPROVEMENT_PLAN.md` (or a `plan-*.md` decision
   record).
2. Update `STATUS.md` with the new item and its priority.
3. Add tests (vitest for research-data, the Worker and the api-server;
   `tsx --test` for `lib/stats`).
4. If it is a Worker D1 route, add it to `D1_ROUTE_MOUNTS` in
   `research/src/index.ts` — that array is what registers both
   `app.route()` **and** the CSRF guard. A route mounted by hand misses
   CSRF protection.
5. If it is an api-server route, apply auth **inside the route file** and
   add it to the allowlist in
   `artifacts/api-server/test/route-auth-policy.test.ts`. Do not write
   `router.use(requireAuth, someRouter)` — see the block comment at the top
   of `artifacts/api-server/src/routes/index.ts`.
6. **No state-changing endpoint may be a `GET`.** `SameSite=Lax` permits a
   top-level cross-site navigation, so a mutating GET is a CSRF write
   primitive reachable from an `<img src>` on any origin.
7. Update `CHANGELOG.md` under `[Unreleased]`, grouped by area.

## Documentation

- Keep `README.md`, `STATUS.md`, `CHANGELOG.md`, `SECURITY.md` and
  `STORAGE.md` in sync with the code.
- **Env vars go in the `.env.example` that owns the group**, and nowhere
  else:

  | File | Owns |
  | --- | --- |
  | `.env.example` (root) | `docker-compose.yml` interpolation, deploy-script inputs, and the object-store prefixes |
  | `artifacts/api-server/.env.example` | everything the api-server reads |
  | `research/.env.example` | Worker bindings/secrets |
  | `artifacts/research-data/.env.example` | the Vite dev server |

- Update `STORAGE.md` if storage conventions or read-path authorisation
  change.
- Update `docs/design-tokens.md` from the values in
  `artifacts/research-data/src/index.css`, and re-measure any contrast
  ratio you claim.
- When you add a semantic colour, decide up front whether it needs a
  surface/text split like `--primary-text` / `--destructive-text`.
- `docs/ui-ux-audit.md` and `docs/accessibility-audit.md` carry dated
  per-item addenda. Add a dated entry; do not rewrite the original audit.

## Questions?

Open an issue or discussion in the repository.