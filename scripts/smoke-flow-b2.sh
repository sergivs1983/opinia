#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"

if [ -z "${INTERNAL_HMAC_SECRET:-}" ]; then
  echo "ERROR: falta INTERNAL_HMAC_SECRET"
  echo "Exemple: INTERNAL_HMAC_SECRET=... ./scripts/smoke-flow-b2.sh ${BASE}"
  exit 1
fi

PASS="PASS"
FAIL="FAIL"
GREEN="$(printf '\033[32m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 20 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  local label="$1"
  echo "  [${PASS}] ${label}"
}

report_fail() {
  local label="$1"
  echo "  [${FAIL}] ${label}"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 240)"
  FAILURES=$((FAILURES + 1))
}

make_hmac() {
  local path="$1"
  local body="$2"
  OPIN_PATH="$path" OPIN_BODY="$body" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET;
if (!secret) {
  process.exit(2);
}
const ts = Date.now().toString();
const path = process.env.OPIN_PATH || '';
const rawBody = process.env.OPIN_BODY || '';
const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

check_status() {
  local label="$1"
  local expected="$2"
  shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    report_ok "${label} (HTTP ${REQ_CODE})"
  else
    report_fail "${label} (expected ${expected})"
  fi
}

check_stub_200() {
  local label="$1"
  local path="$2"
  local body=""
  local hmac ts sig
  hmac="$(make_hmac "${path}" "${body}")"
  ts="$(printf '%s\n' "${hmac}" | sed -n '1p')"
  sig="$(printf '%s\n' "${hmac}" | sed -n '2p')"

  perform_request -X POST "${BASE}${path}" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${ts}" \
    -H "x-opin-signature: ${sig}" \
    -d "${body}"

  if [ "${REQ_CODE}" = "200" ] && [[ "${REQ_BODY}" == *'"stub":true'* ]]; then
    report_ok "${label} (HTTP 200 + stub=true)"
  else
    report_fail "${label} (expected HTTP 200 + stub=true)"
  fi
}

check_google_valid_hmac() {
  local label="$1"
  local path="/api/_internal/google/publish"
  local body=""
  local hmac ts sig
  hmac="$(make_hmac "${path}" "${body}")"
  ts="$(printf '%s\n' "${hmac}" | sed -n '1p')"
  sig="$(printf '%s\n' "${hmac}" | sed -n '2p')"

  perform_request -X POST "${BASE}${path}" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${ts}" \
    -H "x-opin-signature: ${sig}" \
    -d "${body}"

  if [ "${REQ_CODE}" = "200" ]; then
    report_ok "${label} (HTTP 200)"
    return
  fi

  if [ "${REQ_CODE}" = "500" ] && [[ "${REQ_BODY}" == *'"rpc_error"'* ]]; then
    report_ok "${label} (HTTP 500 + rpc_error placeholder)"
    return
  fi

  report_fail "${label} (expected 200 or 500 rpc_error)"
}

echo "Flow B2 smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Health check localhost" "200" "${BASE}/"

echo ""
echo "1) Direct cron path blocked by middleware (404)"
check_status "cron TA sync" "404" -X POST "${BASE}/api/cron/worker/tripadvisor/sync" -H "Content-Type: application/json" -d ''
check_status "cron TA publish" "404" -X POST "${BASE}/api/cron/worker/tripadvisor/publish" -H "Content-Type: application/json" -d ''
check_status "cron BK sync" "404" -X POST "${BASE}/api/cron/worker/booking/sync" -H "Content-Type: application/json" -d ''
check_status "cron BK publish" "404" -X POST "${BASE}/api/cron/worker/booking/publish" -H "Content-Type: application/json" -d ''
check_status "cron GO publish" "404" -X POST "${BASE}/api/cron/worker/google/publish" -H "Content-Type: application/json" -d ''

echo ""
echo "2) Internal routes without HMAC return 401"
check_status "internal TA sync no HMAC" "401" -X POST "${BASE}/api/_internal/tripadvisor/sync" -H "Content-Type: application/json" -d ''
check_status "internal TA publish no HMAC" "401" -X POST "${BASE}/api/_internal/tripadvisor/publish" -H "Content-Type: application/json" -d ''
check_status "internal BK sync no HMAC" "401" -X POST "${BASE}/api/_internal/booking/sync" -H "Content-Type: application/json" -d ''
check_status "internal BK publish no HMAC" "401" -X POST "${BASE}/api/_internal/booking/publish" -H "Content-Type: application/json" -d ''
check_status "internal GO publish no HMAC" "401" -X POST "${BASE}/api/_internal/google/publish" -H "Content-Type: application/json" -d ''

echo ""
echo "3) Valid HMAC on Tripadvisor/Booking stubs returns 200 + stub:true"
check_stub_200 "internal TA sync valid HMAC" "/api/_internal/tripadvisor/sync"
check_stub_200 "internal TA publish valid HMAC" "/api/_internal/tripadvisor/publish"
check_stub_200 "internal BK sync valid HMAC" "/api/_internal/booking/sync"
check_stub_200 "internal BK publish valid HMAC" "/api/_internal/booking/publish"

echo ""
echo "4) Valid HMAC on Google publish returns 200 or 500 rpc_error"
check_google_valid_hmac "internal GO publish valid HMAC"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All Flow B2 smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
