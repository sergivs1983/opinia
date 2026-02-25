#!/usr/bin/env bash
# check-observability.sh
# Verifies: 1) x-request-id header on API responses (passes even on 503)
#           2) /api/health JSON body has required fields
#           3) no raw PII in direct console.* calls (src/)
#
# Usage:  bash scripts/check-observability.sh [BASE_URL]
#   BASE_URL defaults to http://localhost:3000

set -euo pipefail

PASS=0
FAIL=0

hdr() { printf '\n── %s ──\n' "$1"; }

# ─── 1. x-request-id header (passes regardless of HTTP status) ────────────────
hdr "x-request-id header"
BASE="${1:-${BASE_URL:-http://localhost:3000}}"

RID=$(curl -s -I "${BASE}/api/health" 2>/dev/null \
  | grep -i '^x-request-id:' | head -1 | tr -d '\r\n' || true)

if [[ -n "$RID" ]]; then
  printf '  PASS  %s\n' "$RID"
  PASS=$((PASS + 1))
else
  printf '  FAIL  x-request-id not found in response from %s/api/health\n' "$BASE"
  printf '        Is the dev server running? Run: npm run dev\n'
  FAIL=$((FAIL + 1))
fi

# ─── 2. /api/health JSON body structure ──────────────────────────────────────
hdr "/api/health JSON body"
BODY=$(curl -s "${BASE}/api/health" 2>/dev/null || true)

JSON_OK=1
for field in '"status"' '"db"' '"requestId"'; do
  if ! echo "$BODY" | grep -q "$field"; then
    printf '  FAIL  missing field %s in: %s\n' "$field" "$BODY"
    JSON_OK=0
  fi
done

STATUS_VAL=$(echo "$BODY" | grep -oE '"status"\s*:\s*"[^"]+"' | head -1 || true)
DB_VAL=$(echo "$BODY" | grep -oE '"db"\s*:\s*"[^"]+"' | head -1 || true)

if [[ "$JSON_OK" -eq 1 ]]; then
  printf '  PASS  %s  |  %s\n' "$STATUS_VAL" "$DB_VAL"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi

# ─── 3. Anti-PII static scan ─────────────────────────────────────────────────
hdr "Anti-PII static scan  (src/, excl. logger.ts + request-id.ts)"

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
