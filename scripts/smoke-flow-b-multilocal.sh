#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-${BASE:-http://localhost:3000}}"
TEST_SEED="00000000-0000-0000-0000-000000000000"

PASS="PASS"
FAIL="FAIL"
GREEN="$(printf '\033[32m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"
FAILURES=0

REQ_CODE=""
REQ_BODY=""
REQ_HEADERS=""

perform_request() {
  local resp
  resp="$(curl -sS --max-time 20 -D - -w $'\n%{http_code}' "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_HEADERS="$(printf '%s\n' "$resp" | sed '$d' | sed -n '1,/^\r$/p')"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d' | sed -e '1,/^\r$/d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 240)"
  FAILURES=$((FAILURES + 1))
}

check_unauthorized() {
  local label="$1"
  shift
  perform_request "$@"
  if [ "${REQ_CODE}" = "401" ] && [[ "${REQ_BODY}" == *'"error":"unauthorized"'* ]]; then
    report_ok "${label} (401 unauthorized)"
  else
    report_fail "${label} (expected 401 unauthorized)"
  fi
}

check_no_store() {
  local label="$1"
  if printf '%s' "${REQ_HEADERS}" | tr '[:upper:]' '[:lower:]' | grep -q '^cache-control: no-store'; then
    report_ok "${label} has Cache-Control: no-store"
  else
    report_fail "${label} missing Cache-Control: no-store"
  fi
}

echo "Flow B multi-local smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_unauthorized "GET /api/integrations/google/list (no session)" \
  "${BASE}/api/integrations/google/list"
check_no_store "GET /api/integrations/google/list"

check_unauthorized "GET /api/integrations/google/locations (no session)" \
  "${BASE}/api/integrations/google/locations?seed_integration_id=${TEST_SEED}"
check_no_store "GET /api/integrations/google/locations"

check_unauthorized "POST /api/integrations/google/import-locations (no session)" \
  -X POST "${BASE}/api/integrations/google/import-locations" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE}" \
  -d "{\"seed_integration_id\":\"${TEST_SEED}\",\"location_ids\":[\"locations/123\"]}"
check_no_store "POST /api/integrations/google/import-locations"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All Flow B multi-local smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
