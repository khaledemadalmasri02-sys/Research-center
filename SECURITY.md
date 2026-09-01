# Security Policy

## Reporting a vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Email `security@research-center.fit` (or `khaledemadalmasri02-sys` via GitHub private disclosure) with:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- The commit hash / branch where you observed it.

We will acknowledge within 2 business days and aim to triage within 5.

## Supported versions

Only the latest commit on `main` receives security updates. Older commits may contain issues already addressed.

## Data handling

This repository powers a **medical research data platform**. The following are enforced:

1. **No PHI in git.** Files under `attached_assets/` other than synthetic fixtures under `attached_assets/fixtures/` are blocked by `.gitignore`. Real patient data, medical images, or any non-public files must NEVER be committed. See `attached_assets/README.md`.
2. **No real secrets in git.** `.env`, `.env.*` (except `.env.example`), `*.replit`, `*.dev.vars`, and `research/.env` are git-ignored. `gitleaks` (see `.gitleaks.toml`) runs on every CI push and weekly on full history.
3. **Pre-commit hook.** Install with `git config core.hooksPath .githooks` to scan staged changes before commit.
4. **Rotate on exposure.** If a real secret leaks, rotate it at the provider **first**, then scrub history.

## Cryptographic defaults

- Passwords hashed with **bcrypt** (cost ≥ 10).
- Sessions signed with `SESSION_SECRET` (≥ 32 random bytes in production).
- CSRF: double-submit cookie at the Worker + Origin guard at the api-server.
- Cookies: `HttpOnly`, `SameSite=Lax` for same-origin flows (Strict for admin routes), `Secure` in production.

## Threat-model notes

- **4-digit OTP**: accepted because of 5-attempt lockout and 5-minute expiry (see `routes/auth.ts`). If you raise the lockout threshold, raise `OTP_LENGTH` to 6.
- **CORS**: api-server defaults to a closed allowlist (`ALLOWED_ORIGINS` must be set). The previous "reflect any origin" fallback is removed.
- **Object keys**: prefixed by patient/record ID; never accept free-form keys that could collide across patients.

## Dependencies

- `pnpm` enforces `minimumReleaseAge: 1440` (1 day) for supply-chain defense.
- GitHub Dependabot + scheduled `pnpm audit` are configured (P1.10).