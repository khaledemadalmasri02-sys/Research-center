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

- **OTP length (P1.4):** default is **6 digits** (1 000 000 codes) with
  a 5-attempt lockout and a 5-minute TTL. Brute-force probability per
  session: 5 / 1 000 000 = **0.0005%** for login 2FA; the same math
  applies to signup email verification (10-minute TTL, 5 attempts).
  Override via `OTP_LENGTH` env (range 4-8). Don't set this below 6
  in production without a documented threat-model exception.

  For reference, the previous 4-digit default gave 5 / 10 000 = 0.05%
  per session — borderline acceptable for low-risk flows but
  insufficient for medical data, which is why 6 digits is the new
  default. NIST 800-63B recommends ≥6 digits for one-time
  authentication codes.

- **CORS**: api-server defaults to a closed allowlist
  (`ALLOWED_ORIGINS` must be set). The previous "reflect any origin"
  fallback is removed.
- **Object keys**: prefixed by patient/record ID; never accept
  free-form keys that could collide across patients.
- **Body size**: JSON capped at 1 MB (overridable via
  `JSON_BODY_LIMIT`); large uploads go through multer with per-IP
  rate limits.
- **Per-IP rate limits**: login 10/15min, signup 10/15min, OTP
  send 8/15min, login-OTP verify 8/15min, presigned URL request
  60/15min, upload-file 30/15min, image import 30/15min, dataset
  upload 20/15min, analyze 30/15min, from-query 30/15min. All return
  429 with a `Retry-After` header.

## Dependencies

- `pnpm` enforces `minimumReleaseAge: 1440` (1 day) for supply-chain defense.
- Dependabot is configured at `.github/dependabot.yml`: weekly scan of
  the pnpm workspace and GitHub Actions, grouped PRs (patch+minor
  together, major separate), one open PR per ecosystem.
- `.github/workflows/audit.yml` runs `pnpm audit --prod
  --audit-level=high` weekly and opens an issue with the report on
  failure. The issue is deduped by title over a 30-day window so
  the same finding doesn't produce many tickets.