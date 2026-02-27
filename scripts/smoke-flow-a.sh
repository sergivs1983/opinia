#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-${BASE:-http://localhost:3000}}"
WORKER_PATH="/api/_internal/google/publish"
WORKER_URL="${BASE}${WORKER_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"

resolve_secret() {
  if [ -n "${INTERNAL_HMAC_SECRET:-}" ]; then
    printf '%s' "${INTERNAL_HMAC_SECRET}"
    return
  fi
  if [ -f "${ENV_FILE}" ]; then
    awk -F= '/^INTERNAL_HMAC_SECRET=/{v=$2} END{print v}' "${ENV_FILE}"
    return
  fi
  printf ''
}

SECRET="$(resolve_secret)"
if [ -z "${SECRET}" ]; then
  echo "ERROR: falta INTERNAL_HMAC_SECRET (.env.local o env)"
  exit 1
fi

GREEN="$(printf '\033[32m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"
PASS="PASS"
FAIL="FAIL"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 20 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

pass() {
  echo "  [${PASS}] $1"
}

fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 240)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1"
  local expected="$2"
  shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    pass "${label} (HTTP ${REQ_CODE})"
  else
    fail "${label} (expected ${expected})"
  fi
}

build_hmac() {
  local path="$1"
  local body="$2"
  OPIN_HMAC_SECRET="${SECRET}" OPIN_HMAC_PATH="${path}" OPIN_HMAC_BODY="${body}" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.OPIN_HMAC_SECRET;
const path = process.env.OPIN_HMAC_PATH;
const body = process.env.OPIN_HMAC_BODY || '';
const ts = Date.now().toString();
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

echo "Flow A smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Health check" "200" "${BASE}/"

echo ""
echo "1) Guard HMAC worker"
check_status "no HMAC -> 401" "401" \
  -X POST "${WORKER_URL}" \
  -H "Content-Type: application/json" \
  -d ''

check_status "bad HMAC -> 401" "401" \
  -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: 1000000000000" \
  -H "x-opin-signature: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" \
  -H "Content-Type: application/json" \
  -d ''

hmac="$(build_hmac "${WORKER_PATH}" '')"
ts="$(printf '%s\n' "${hmac}" | sed -n '1p')"
sig="$(printf '%s\n' "${hmac}" | sed -n '2p')"
perform_request -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: ${ts}" \
  -H "x-opin-signature: ${sig}" \
  -H "Content-Type: application/json" \
  -d ''

if [ "${REQ_CODE}" = "200" ]; then
  pass "valid HMAC -> 200"
elif [ "${REQ_CODE}" = "500" ] && [[ "${REQ_BODY}" == *'"rpc_error"'* ]]; then
  pass "valid HMAC -> 500 rpc_error (placeholder DB)"
else
  fail "valid HMAC -> expected 200 or 500 rpc_error"
fi

echo ""
echo "2) Guard middleware direct cron path"
check_status "direct cron path -> 404" "404" \
  -X POST "${BASE}/api/cron/worker/google/publish" \
  -H "Content-Type: application/json" \
  -d ''

echo ""
echo "3) Guard auth publish endpoints"
check_status "no session replies publish -> 401" "401" \
  -X POST "${BASE}/api/replies/00000000-0000-0000-0000-000000000001/publish" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE}" \
  -d '{"final_content":"test"}'

check_status "no session publish-jobs -> 401" "401" \
  "${BASE}/api/publish-jobs/00000000-0000-0000-0000-000000000001"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All Flow A smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
