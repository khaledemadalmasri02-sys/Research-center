#!/bin/bash
# Apply the D1 schema to the PRODUCTION database (mednexus-research).
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)/research"
pnpm exec wrangler d1 execute mednexus-research --env production --remote --file=./schema.sql
