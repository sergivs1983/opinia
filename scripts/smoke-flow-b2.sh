#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS="PASS"; FAIL="FAIL"
GREEN="$(printf '\033[32m')"; RED="$(printf '\033[31m')"; RESET="$(printf '\033[0m')"

WORKER_TA_SYNC="${BASE}/api/_internal/tripadvisor/sync"
WORKER_TA_PUB="${BASE}/api/_internal/tripadvisor/publish"
WORKER_BK_SYNC="${BASE}/api/_internal/booking/sync"
WORKER_BK_PUB="${BASE}/api/_internal/booking/publish"
WORKER_GO_PUB="${BASE}/api/_internal/google/publish"

CRON_TA_PUB="${BASE}/api/cron/worker/tripadvisor/publish"
CRON_BK_PUB="${BASE}/api/cron/worker/booking/publish"
CRON_GO_PUB="${BASE}/api/cron/worker/google/publish"

FAILURES=0

check_status() {
  local name="$1"; local want="$2"; shift 2
  local resp http body
  resp="$(curl -s -w $'\n%{http_code}' --max-time 20 "$@" 2>/dev/null || true)"
  http="$(echo "$resp" | tail -1)"
  body="$(echo "$resp" | sed '$d')"

  if [[ "$http" == "$want" ]]; then
    echo -e "  [${PASS}] ${name}  HTTP ${http}"
  else
    echo -e "  [${FAIL}] ${name}  HTTP ${http} (want ${want})"
    echo "         body=$(echo "$body" | head -c 200)"
    FAILURES=$((FAILURES+1))
  fi
}

hmac_headers() {
  # Requires INTERNAL_HMAC_SECRET in env (dev ok), same as Flow A.
  node - <<'JS'
const { createHmac, createHash } = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET || process.env.OPIN_HMAC_SECRET;
if (!secret) { console.error("missing INTERNAL_HMAC_SECRET"); process.exit(2); }
const ts = Date.now().toString();
const method = 'POST';
const pathname = process.env.OPIN_PATH || '/api/_internal/google/publish';
const rawBody = '';
const bodyHex = createHash('sha256').update(rawBody).digest('hex');
const canonical = `${ts}.${method}.${pathname}.${bodyHex}`;
const sig = createHmac('sha256', secret).update(canonical).digest('hex');
console.log(`x-opin-timestamp: ${ts}`);
console.log(`x-opin-signature: ${sig}`);
JS
}

echo "Flow B2 smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"
echo ""

echo "Guard: middleware blocks direct cron path (404)"
check_status "direct cron TA publish → 404" "404" -X POST "${CRON_TA_PUB}" -H "Content-Type: application/json" -d ''
check_status "direct cron BK publish → 404" "404" -X POST "${CRON_BK_PUB}" -H "Content-Type: application/json" -d ''
check_status "direct cron GO publish → 404" "404" -X POST "${CRON_GO_PUB}" -H "Content-Type: application/json" -d ''

echo ""
echo "Guard: HMAC required (401)"
check_status "TA sync no HMAC → 401" "401" -X POST "${WORKER_TA_SYNC}" -H "Content-Type: application/json" -d ''
check_status "TA publish no HMAC → 401" "401" -X POST "${WORKER_TA_PUB}" -H "Content-Type: application/json" -d ''
check_status "BK sync no HMAC → 401" "401" -X POST "${WORKER_BK_SYNC}" -H "Content-Type: application/json" -d ''
check_status "BK publish no HMAC → 401" "401" -X POST "${WORKER_BK_PUB}" -H "Content-Type: application/json" -d ''
check_status "GO publish no HMAC → 401" "401" -X POST "${WORKER_GO_PUB}" -H "Content-Type: application/json" -d ''

echo ""
echo "Workers: valid HMAC (expect 200)"
# Tripadvisor publish
export OPIN_PATH="/api/_internal/tripadvisor/publish"
H="$(hmac_headers)"
TS="$(echo "$H" | grep x-opin-timestamp | awk '{print $2}')"
SIG="$(echo "$H" | grep x-opin-signature  | awk '{print $2}')"
check_status "TA publish HMAC → 200" "200" -X POST "${WORKER_TA_PUB}" \
  -H "x-opin-timestamp: ${TS}" -H "x-opin-signature: ${SIG}" -H "Content-Type: application/json" -d ''

# Booking publish
export OPIN_PATH="/api/_internal/booking/publish"
H="$(hmac_headers)"
TS="$(echo "$H" | grep x-opin-timestamp | awk '{print $2}')"
SIG="$(echo "$H" | grep x-opin-signature  | awk '{print $2}')"
check_status "BK publish HMAC → 200" "200" -X POST "${WORKER_BK_PUB}" \
  -H "x-opin-timestamp: ${TS}" -H "x-opin-signature: ${SIG}" -H "Content-Type: application/json" -d ''

# Google publish
export OPIN_PATH="/api/_internal/google/publish"
H="$(hmac_headers)"
TS="$(echo "$H" | grep x-opin-timestamp | awk '{print $2}')"
SIG="$(echo "$H" | grep x-opin-signature  | awk '{print $2}')"
check_status "GO publish HMAC → 200 (or 500 rpc_error if DB placeholder)" "200" -X POST "${WORKER_GO_PUB}" \
  -H "x-opin-timestamp: ${TS}" -H "x-opin-signature: ${SIG}" -H "Content-Type: application/json" -d '' || true

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [[ "${FAILURES}" -eq 0 ]]; then
  echo -e "${GREEN}All Flow B2 smoke tests passed.${RESET}"
else
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi
