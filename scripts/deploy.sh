#!/bin/bash
# Build the frontend and deploy the research Cloudflare Worker to research-center.fit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Install workspace deps ONCE, at the repo root, against the committed
# lockfile. The previous `( cd artifacts/research-data && pnpm install )` ran
# inside a workspace package, which makes pnpm re-resolve and re-link the WHOLE
# workspace on every build/deploy and can silently rewrite pnpm-lock.yaml.
# `--frozen-lockfile` makes a stale lockfile a hard error instead.
echo "==> Installing workspace deps (root, --frozen-lockfile)"
pnpm install --frozen-lockfile

echo "==> Building frontend (BASE_PATH=/)"
( cd artifacts/research-data && BASE_PATH=/ pnpm run build )

echo "==> Publishing build into research/public (staged, then atomic swap)"
# Publish atomically. The old sequence was `rm -rf research/public/assets` then
# `cp -r`, so a crash (or a full disk) mid-copy left the Worker serving a
# half-deleted asset directory — a blank SPA in production. Now the new tree is
# copied to a staging dir first and only swapped in once the copy has fully
# succeeded; rename(2) is atomic within a filesystem, so a reader sees either
# the whole old tree or the whole new one. The previous assets/ tree is deleted
# only after the swap.
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

echo "==> Applying D1 schema migration (with retry on transient auth)"
"$ROOT/scripts/with-d1-retry.sh"

# No `pnpm install` here: the root install above already covered research/.
echo "==> Deploying worker (env: production)"
( cd research && pnpm exec wrangler deploy --env production )

echo "==> Done. Live at https://research-center.fit/"