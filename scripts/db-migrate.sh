#!/bin/bash
# Apply the D1 schema to the PRODUCTION database (mednexus-research).
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"
exec "$(cd "$(dirname "$0")" && pwd)/with-d1-retry.sh"
