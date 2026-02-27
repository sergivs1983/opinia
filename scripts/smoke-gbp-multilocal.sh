#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
TEST_BIZ_ID="7ea7fc33-4b79-48f2-b589-63d7f0c8da4f"

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
  local tmp_headers
  tmp_headers="$(mktemp)"
  local resp
  resp="$(curl -sS --max-time 20 -D "${tmp_headers}" -w $'\n%{http_code}' "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
  REQ_HEADERS="$(cat "${tmp_headers}")"
  rm -f "${tmp_headers}"
}

report_ok() {
  local label="$1"
  echo "  [${PASS}] ${label}"
}

report_fail() {
  local label="$1"
  echo "  [${FAIL}] ${label}"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 220)"
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

check_no_store_header() {
  local label="$1"
  if printf '%s' "${REQ_HEADERS}" | tr '[:upper:]' '[:lower:]' | grep -q '^cache-control: no-store'; then
    report_ok "${label} has Cache-Control: no-store"
  else
    report_fail "${label} missing Cache-Control: no-store"
  fi
}

echo "GBP Multi-local smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_unauthorized "GET /api/integrations/google/businesses (no session)" \
  "${BASE}/api/integrations/google/businesses"
check_no_store_header "GET /api/integrations/google/businesses"

check_unauthorized "GET /api/integrations/google/locations (no session)" \
  "${BASE}/api/integrations/google/locations?seed_biz_id=${TEST_BIZ_ID}"
check_no_store_header "GET /api/integrations/google/locations"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All GBP multi-local smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
