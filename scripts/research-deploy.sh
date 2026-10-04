#!/usr/bin/env bash
# Full production deploy of research-center.fit WITH the local api-server behind
# the persistent, named Cloudflare tunnel `research-api` (api.research-center.fit),
# so the domain gets the FULL feature set
# (records, signup, users, admin, feedback, patients) from Postgres + MinIO.
#
# What it does (end to end):
#   1. Validate the required production inputs (no dev defaults, see below)
#   2. Start Postgres + MinIO via docker compose
#   3. Start an nginx proxy (:8080) that splits traffic:
#        /api -> api-server:4000   (the ONLY proxied path)
#        /    -> 404                (MinIO is never exposed)
#   4. Start the api-server locally (:4000) with MinIO as local S3
#   5. Start the persistent Cloudflare tunnel `research-api`
#      (config: ~/.cloudflared/research-api.yml) which serves
#      api.research-center.fit -> the nginx proxy above
#   6. Build the React SPA (artifacts/research-data) into research/public
#      (staged + atomically swapped)
#   7. Set the Worker secret API_BACKEND_URL = https://api.research-center.fit
#      and deploy the Worker (env: production), which reverse-proxies
#      /api/* -> api.research-center.fit -> tunnel -> api-server
#
# Required environment (this script REFUSES to invent any of it):
#   DATABASE_URL          a NON-localhost Postgres URL. NODE_ENV defaults to
#                         production, and a production api-server must never run
#                         against a local dev database.
#   S3_ACCESS_KEY_ID      MinIO root user (docker-compose passes it to MinIO).
#   S3_SECRET_ACCESS_KEY  MinIO root password. The published `minioadmin`
#                         defaults are rejected.
#   SESSION_SECRET        32+ random bytes. Generated if unset.
#   ADMIN_PASSWORD        optional; a random one is generated if unset.
#
# No ngrok dependency. The tunnel must already be created (cloudflared login
# once, and the research-api tunnel + its ingress live in
# ~/.cloudflared/research-api.yml pointing api.research-center.fit ->
# http://localhost:8080). A DNS CNAME api.research-center.fit ->
# <tunnel-id>.cfargotunnel.com (proxied) must exist in the research-center.fit
# Cloudflare zone.
#
# Prerequisites (one-time, manual):
#   - `cloudflared` installed + `cloudflared login` (Cloudflare account)
#   - `wrangler login` (for the Worker deploy)
#   - Docker installed and running
#   - nginx installed
#
# Tear down later with:  pnpm research:down
set -euo pipefail
# Ignore SIGPIPE: when the launcher's output stream closes early (common in
# CI/tooling wrappers), a bare `echo` would otherwise terminate the script
# with exit code 141. Ignoring it lets the deploy finish. It also keeps
# `cmd | head -c N` pipelines below from failing under `pipefail`.
trap '' PIPE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Ports. ONE scheme is used repo-wide for the api-server (4000); see
# scripts/dev.sh, package.json `dev:apps` and the README ports table.
API_PORT="${API_PORT:-4000}"
MINIO_PORT="${MINIO_PORT:-9000}"
PROXY_PORT="${PROXY_PORT:-8080}"
TUNNEL_CONFIG="${TUNNEL_CONFIG:-$HOME/.cloudflared/research-api.yml}"
TUNNEL_NAME="${TUNNEL_NAME:-research-api}"
KILO="${KILO_DIR:-/tmp/kilo}"
mkdir -p "$KILO"

# ---------------------------------------------------------------------------
# Required production inputs — validated BEFORE anything is started.
# ---------------------------------------------------------------------------
# MinIO holds radiology images, pg_dump archives and backups. The old code
# hardcoded minioadmin/minioadmin (published defaults) for both the root
# credentials and the api-server's S3 client, so anyone who reached the
# container had full read/write access to PHI. Require real credentials.
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID must be set (do not use the minioadmin default)}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY must be set}"
case "${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}" in
  minioadmin:minioadmin)
    echo "ERROR: refusing to start with the default MinIO credentials (minioadmin/minioadmin)." >&2
    echo "       MinIO holds PHI; generate a real root key, e.g." >&2
    echo "         openssl rand -hex 24" >&2
    echo "       and export S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (docker-compose.yml" >&2
    echo "       passes them to MinIO as MINIO_ROOT_USER / MINIO_ROOT_PASSWORD)." >&2
    exit 1
    ;;
esac

# A "production" api-server pointed at localhost:5432 (the docker-compose dev
# database with the default postgres/postgres credentials) is how a dev stack
# gets treated as the real system. Require an explicit DATABASE_URL and refuse
# a loopback one while NODE_ENV=production.
: "${DATABASE_URL:?DATABASE_URL must be set explicitly; refusing to default to a local dev database}"
export NODE_ENV="${NODE_ENV:-production}"
if [ "$NODE_ENV" = "production" ] &&
  printf '%s' "$DATABASE_URL" | grep -Eq '@(localhost|127\.0\.0\.1|\[::1\])(:|/|$)'; then
  echo "ERROR: NODE_ENV=production but DATABASE_URL points at localhost:" >&2
  echo "       $DATABASE_URL" >&2
  echo "       Point DATABASE_URL at the real Postgres host. If you really mean a" >&2
  echo "       local run, set NODE_ENV=development explicitly." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Admin credentials: never hardcode, and never leave a plaintext password at
# rest. Prefer ADMIN_PASSWORD from the environment; otherwise reuse the bcrypt
# HASH persisted by a previous run (so the admin login stays stable across
# deploys without storing the password itself); otherwise generate a random
# password, print it once, and keep only its hash. The generated plaintext
# lives in a chmod-600 mktemp file that the EXIT trap shreds — the previous
# version wrote it to the world-readable /tmp/kilo/admin-credentials.txt.
# ---------------------------------------------------------------------------
ADMIN_HASH_FILE="$KILO/admin-password.hash"
ADMIN_PLAINTEXT_FILE=""

cleanup() {
  if [ -n "$ADMIN_PLAINTEXT_FILE" ] && [ -f "$ADMIN_PLAINTEXT_FILE" ]; then
    shred -u "$ADMIN_PLAINTEXT_FILE" 2>/dev/null || rm -f "$ADMIN_PLAINTEXT_FILE"
  fi
}
trap cleanup EXIT

hash_password() {
  node -e "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.argv[1],12))" "$1"
}

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  ADMIN_HASH="$(hash_password "$ADMIN_PASSWORD")"
  printf '%s\n' "$ADMIN_HASH" > "$ADMIN_HASH_FILE"
  chmod 600 "$ADMIN_HASH_FILE"
  unset ADMIN_PASSWORD
  echo "Using admin password from ADMIN_PASSWORD env (only the hash is stored)."
elif [ -n "${ADMIN_HASH:-}" ]; then
  : # explicit ADMIN_HASH already provided via environment
elif [ -s "$ADMIN_HASH_FILE" ]; then
  # Reuse the hash from a previous run so logins stay stable across deploys
  # (otherwise every `pnpm research` would randomize the password).
  ADMIN_HASH="$(cat "$ADMIN_HASH_FILE")"
  echo "Reusing existing admin password (hash: $ADMIN_HASH_FILE)."
  echo "    The password itself is not stored; set ADMIN_PASSWORD=... to change it."
else
  GEN_PASS="$(head -c 32 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 16)"
  ADMIN_HASH="$(hash_password "$GEN_PASS")"
  printf '%s\n' "$ADMIN_HASH" > "$ADMIN_HASH_FILE"
  chmod 600 "$ADMIN_HASH_FILE"
  ADMIN_PLAINTEXT_FILE="$(mktemp "${TMPDIR:-/tmp}/mednexus-admin-pass.XXXXXX")"
  chmod 600 "$ADMIN_PLAINTEXT_FILE"
  printf '%s\n' "$GEN_PASS" > "$ADMIN_PLAINTEXT_FILE"
  echo "Generated admin password. Plaintext copy (deleted on exit): $ADMIN_PLAINTEXT_FILE"
  cat "$ADMIN_PLAINTEXT_FILE"
  unset GEN_PASS
fi

# Idempotent: stop only what this script owns. Previously this used broad
# `pkill -f` patterns ("tsx artifacts/api-server/src/index.ts" matched ANY
# api-server on the box, including another checkout's dev server) plus a blanket
# `rm -f $KILO/*.pid` that deleted unrelated pidfiles. Now: recorded PIDs first,
# then the exact listen port.
stop_pidfile() {
  local file="$1" label="$2" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "    stopping $label (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}
stop_port() {
  local port="$1" label="$2"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "$port/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -i "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [ -z "$pids" ] || kill $pids 2>/dev/null || true
  else
    echo "    WARN: neither fuser nor lsof found; cannot free port $port ($label)"
  fi
}
stop_pidfile "$KILO/api-server.pid" api-server
stop_pidfile "$KILO/cloudflared.pid" cloudflared
stop_pidfile "$KILO/nginx-proxy.pid" nginx-proxy
stop_port "$PROXY_PORT" nginx-proxy
stop_port "$API_PORT" api-server
sleep 1

echo "==> Preflight checks"
command -v cloudflared >/dev/null 2>&1 || { echo "ERROR: cloudflared not found. Install: https://developers.cloudflare.com/cloudflared/"; exit 1; }
command -v nginx >/dev/null 2>&1 || { echo "ERROR: nginx not found."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found."; exit 1; }
[ -f "$TUNNEL_CONFIG" ] || { echo "ERROR: tunnel config not found: $TUNNEL_CONFIG"; exit 1; }

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
echo "    using: $DC"

# 1. Start database + object storage
echo "==> Starting docker (Postgres + MinIO)"
$DC up -d
for i in $(seq 1 60); do
  if $DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1; then break; fi
  sleep 1
done
$DC exec -T postgres pg_isready -U postgres -d mednexus >/dev/null 2>&1 || { echo "ERROR: Postgres did not become ready."; exit 1; }

# 2. Start nginx proxy ($PROXY_PORT: /api -> $API_PORT, everything else -> 404)
echo "==> Starting nginx proxy ($PROXY_PORT: /api -> $API_PORT, / -> 404)"
cat > "$KILO/nginx-proxy.conf" <<NGINX
worker_processes 1;
daemon on;
pid $KILO/nginx-proxy.pid;
error_log $KILO/nginx-proxy-error.log warn;
events { worker_connections 1024; }
http {
  access_log $KILO/nginx-proxy-access.log;
  client_max_body_size 0;
  proxy_request_buffering off;
  upstream apisrv { server 127.0.0.1:$API_PORT; }
  server {
    listen $PROXY_PORT;
    location ~ ^/api(/|\$) {
      proxy_pass http://apisrv;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
    }
    # ---- MinIO / S3 API is deliberately NOT proxied -------------------------
    # WHY: this bucket holds PHI (radiology images, patient documents) plus
    # database dumps and backups. The old `location / { proxy_pass http://minio;
    # }` published the S3 API unauthenticated to the whole internet via
    # api.research-center.fit -> Cloudflare tunnel -> this nginx: anyone could
    # list buckets and read/write objects. There is no legitimate client here
    # either — the SPA gets presigned URLs from the api-server, and the
    # api-server talks to MinIO over loopback with the S3 SDK.
    # So: hard 404, no proxy_pass, no `upstream minio` block. Do not "restore"
    # this by adding an upstream; publish MinIO on a private network or via
    # presigned URLs only.
    location / {
      return 404 "Not Found\n";
    }
  }
}
NGINX
nginx -c "$KILO/nginx-proxy.conf" -p "$KILO/" 2>&1
sleep 1

# 3. Start the persistent Cloudflare tunnel (api.research-center.fit -> localhost:8080)
echo "==> Starting Cloudflare tunnel ($TUNNEL_NAME -> $PROXY_PORT via nginx)"
setsid nohup cloudflared tunnel --config "$TUNNEL_CONFIG" run "$TUNNEL_NAME" > "$KILO/cloudflared.log" 2>&1 &
echo $! > "$KILO/cloudflared.pid"
for i in $(seq 1 30); do
  if grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null; then break; fi
  sleep 1
done
grep -q "Registered tunnel connection" "$KILO/cloudflared.log" 2>/dev/null || echo "WARN: tunnel not yet registered (see $KILO/cloudflared.log)"

# 4. Start api-server locally, MinIO as local S3.
#    NODE_ENV and DATABASE_URL were validated at the top of this script.
echo "==> Starting api-server on :$API_PORT (S3 via local MinIO:$MINIO_PORT)"
export PORT="$API_PORT"
export DATABASE_URL
# Strong session secret: from env if provided, otherwise a fresh random value.
export SESSION_SECRET="${SESSION_SECRET:-$(head -c 64 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 48)}"
# Strict CORS: only these origins may call the API (also activates the CSRF
# Origin guard). Override with ALLOWED_ORIGINS for other domains.
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://research-center.fit,https://www.research-center.fit,https://api.research-center.fit}"
export APP_USERNAME="admin"
export APP_PASSWORD_HASH="$ADMIN_HASH"
export S3_ENDPOINT="http://localhost:$MINIO_PORT"
# Validated (non-default) at the top of this script; reused here so the
# api-server and MinIO share the same root credentials.
export S3_ACCESS_KEY_ID
export S3_SECRET_ACCESS_KEY
export S3_BUCKET="mednexus"
export S3_FORCE_PATH_STYLE="true"
export S3_SIGNED_URL_EXPIRES_SECONDS="300"
# LEGACY read-path prefixes. Keep in sync with artifacts/api-server/.env.example
# (the documented source of truth) and STORAGE.md; override via the
# environment when the live bucket uses different historical prefixes.
export PUBLIC_OBJECT_SEARCH_PATHS="${PUBLIC_OBJECT_SEARCH_PATHS:-/mednexus}"
export PRIVATE_OBJECT_DIR="${PRIVATE_OBJECT_DIR:-/objects}"
# Outbound email via Brevo: load the SMTP credentials from the api-server's own
# .env. Without these, sendEmail() silently no-ops (returns false) and OTP /
# notification emails are never sent. Only the SMTP_* lines are sourced so we
# don't clobber PORT / DATABASE_URL already exported above.
set -a
# `set +u` while sourcing: a placeholder such as
# MAIL_UNSUBSCRIBE_LOOKUP_TOKEN=<32-byte random> would otherwise abort the whole
# deploy under `set -u`.
set +u
. <(grep -E '^(SMTP_|UNSUBSCRIBE_STATUS_TOKEN|MAIL_)' artifacts/api-server/.env 2>/dev/null || true)
set -u
set +a
setsid nohup pnpm exec tsx artifacts/api-server/src/index.ts > "$KILO/api-server.log" 2>&1 &
echo $! > "$KILO/api-server.pid"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/api/healthz" >/dev/null 2>&1 || { echo "ERROR: api-server did not start (see $KILO/api-server.log)"; exit 1; }

# 5. Install workspace deps ONCE, at the repo root, against the committed
#    lockfile. The previous `cd artifacts/research-data && pnpm install` ran
#    inside a workspace package, which makes pnpm re-resolve and re-link the
#    WHOLE workspace on every build and can silently mutate pnpm-lock.yaml.
echo "==> Installing workspace deps (root, --frozen-lockfile)"
pnpm install --frozen-lockfile

# 6. Build the legacy SPA (artifacts/research-data -> research/public).
#    This is the production UI/UX. It now ALSO includes the new feature modules
#    (consent, deidentify, coding, cohort, validation, dicom, export, studies,
#    ml, reports, gdpr, ingest, search) surfaced via the "More features" page.
echo "==> Building frontend (artifacts/research-data -> research/public)"
( cd artifacts/research-data && BASE_PATH=/ pnpm run build )

echo "==> Publishing build into research/public (staged, then atomic swap)"
# Publish atomically. The old sequence was `rm -rf research/public/assets` then
# `cp -r`, so a crash (or a full disk) mid-copy left the Worker serving a
# half-deleted asset directory — i.e. a blank SPA in production. Now the new
# tree is copied to a staging dir first and only swapped in once the copy has
# fully succeeded; rename(2) is atomic within a filesystem, so a reader sees
# either the whole old tree or the whole new one. The previous assets/ tree is
# deleted only after the swap.
#
# The staging dirs live in research/ (not research/public/) so a half-written
# build is never reachable through the Worker's ASSETS binding, while staying
# on the same filesystem as the target so the swap is a rename.
SRC_DIST="artifacts/research-data/dist/public"
STAGE="research/.publish-stage.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$SRC_DIST/." "$STAGE/"
# Swap every top-level entry the build produced: directories (assets/, tour/)
# are replaced by rename, files by rename over the live file.
shopt -s nullglob dotglob
for entry in "$STAGE"/*; do
  name="$(basename "$entry")"
  if [ -d "$entry" ]; then
    rm -rf "research/.publish-prev.$$-$name"
    if [ -e "research/public/$name" ]; then
      mv "research/public/$name" "research/.publish-prev.$$-$name"
    fi
    mv "$entry" "research/public/$name"
    rm -rf "research/.publish-prev.$$-$name"
  else
    cp "$entry" "research/.publish-tmp.$$-$name"
    mv "research/.publish-tmp.$$-$name" "research/public/$name"
  fi
done
shopt -u nullglob dotglob
rm -rf "$STAGE"

# 7. Apply the D1 schema (idempotent CREATE TABLE IF NOT EXISTS) and point the
#    Worker at the tunnel, then deploy. The schema bootstrap is also re-run
#    lazily on the Worker's first request, but applying it here keeps the
#    database in lockstep with the source-controlled schema.sql (so tables
#    like email_unsubscribes exist on the first hit rather than the first
#    request creating them).
echo "==> Applying D1 schema migration (with retry on transient auth)"
"$ROOT/scripts/with-d1-retry.sh"

echo "==> Setting Worker secret API_BACKEND_URL = https://api.research-center.fit"
# No `pnpm install` here: step 5 already installed the whole workspace from the
# frozen lockfile, so research/node_modules is present.
( cd research && \
  printf '%s' "https://api.research-center.fit" | pnpm exec wrangler secret put --env production API_BACKEND_URL && \
  pnpm exec wrangler deploy --env production )

# 7b. Optional: also set UNSUBSCRIBE_STATUS_TOKEN on the Worker so the
#     api-server's pre-send unsubscribe guard can authenticate against
#     /api/unsubscribe/status. Sourced from the api-server's own .env (same
#     pattern as the SMTP_* lines above). If unset, the Worker serves the
#     status endpoint unauthenticated — fine for dev, not recommended in
#     production.
if [ -n "${UNSUBSCRIBE_STATUS_TOKEN:-}" ]; then
  echo "==> Setting Worker secret UNSUBSCRIBE_STATUS_TOKEN (from env)"
  ( cd research && \
    printf '%s' "$UNSUBSCRIBE_STATUS_TOKEN" | pnpm exec wrangler secret put --env production UNSUBSCRIBE_STATUS_TOKEN )
else
  echo "==> Skipping UNSUBSCRIBE_STATUS_TOKEN (not set). To enable pre-send"
  echo "    unsubscribe enforcement, add to artifacts/api-server/.env:"
  echo "      UNSUBSCRIBE_STATUS_TOKEN=<32-byte random>"
  echo "      MAIL_UNSUBSCRIBE_LOOKUP_URL=https://research-center.fit"
  echo "      MAIL_UNSUBSCRIBE_LOOKUP_TOKEN=<same 32-byte random>"
fi

echo ""
echo "==> DONE. research-center.fit proxies /api -> https://api.research-center.fit -> local api-server."
echo "    Note: nginx returns 404 for every non-/api path — the object store is"
echo "    intentionally not exposed through the tunnel."
echo "    Logs: $KILO/{cloudflared,nginx-proxy,api-server}.log"
echo "    Stop everything later with:  pnpm research:down"