#!/usr/bin/env bash
# check-observability.sh
# Verifies: 1) x-request-id header on API responses
#           2) no raw PII in direct console.* calls (src/)
#
# Usage:  bash scripts/check-observability.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:3000

set -euo pipefail

PASS=0
FAIL=0

hdr() { printf '\n── %s ──\n' "$1"; }

# ─── 1. x-request-id live header check ───────────────────────────────────────
hdr "x-request-id header"
BASE="${1:-${BASE_URL:-http://localhost:3000}}"

RID=$(curl -s -I "${BASE}/api/health" 2>/dev/null \
  | grep -i '^x-request-id:' | head -1 | tr -d '\r\n' || true)

if [[ -n "$RID" ]]; then
  printf '  PASS  %s\n' "$RID"
  PASS=$((PASS + 1))
else
  printf '  WARN  x-request-id not found in response from %s/api/health\n' "$BASE"
  printf '        Is the dev server running? Run: npm run dev\n'
  FAIL=$((FAIL + 1))
fi

# ─── 2. Anti-PII static scan ─────────────────────────────────────────────────
hdr "Anti-PII static scan  (src/, excl. logger.ts + request-id.ts)"

# Look for PII key names on the same line as a direct console.* call.
# The log singleton sanitises before calling console.*; raw console calls bypass this.
PII_HITS=$(grep -rn --include='*.ts' --include='*.tsx' \
  --exclude='logger.ts' --exclude='request-id.ts' \
  -E 'console\.(log|warn|error|info).*("review_text"|"email"|"access_token"|"refresh_token"|"api_key"|"password"|"secret"|"jwt")' \
  src/ 2>/dev/null || true)

if [[ -z "$PII_HITS" ]]; then
  printf '  PASS  No raw PII in direct console.* calls\n'
  PASS=$((PASS + 1))
else
  printf '  FAIL  PII found in direct console.* calls:\n'
  printf '%s\n' "$PII_HITS" | sed 's/^/        /'
  FAIL=$((FAIL + 1))
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
hdr "Result"
printf '  passed=%d  failed=%d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
