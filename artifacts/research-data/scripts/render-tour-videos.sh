#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STEPS="welcome dashboard patients collections dataAnalysis feedback moreFeatures myActivity apiTokens sessions notifications theme language admin finish"
OUT="/tmp/kilo/remotion"
mkdir -p "$OUT"

for k in $STEPS; do
  echo "Rendering $k ..."
  pnpm exec remotion render remotion/src/index.ts "$k" "$OUT/$k.mp4" --config remotion/remotion.config.ts
done

mkdir -p public/tour
cp "$OUT"/*.mp4 public/tour/
echo "Done. 15 tour videos written to public/tour/"
