#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
BRAND_BRAIN_BIZ_ID="${BRAND_BRAIN_BIZ_ID:-}"
BRAND_BRAIN_OWNER_COOKIE="${BRAND_BRAIN_OWNER_COOKIE:-}"
BRAND_BRAIN_STAFF_COOKIE="${BRAND_BRAIN_STAFF_COOKIE:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw payload
  raw="$(trim_spaces "$1")"
  if [ -z "$raw" ]; then
    return 1
  fi
  case "$raw" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "$raw" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
  else
    payload="$raw"
  fi
  payload="$(trim_spaces "$payload")"
  if [ -z "$payload" ] || ! printf '%s' "$payload" | grep -q '='; then
    return 1
  fi
  printf 'Cookie: %s' "$payload"
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

wait_for_login_ready() {
  local tries=40
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "${code}" = "200" ]; then
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  REQ_CODE="${code:-000}"
  REQ_BODY=""
  return 1
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 320)"
  FAILURES=$((FAILURES + 1))
}

validate_memory_shape() {
  local json="$1"
  JSON_INPUT="$json" node - <<'JS'
const input = process.env.JSON_INPUT || '';
try {
  const payload = JSON.parse(input);
  if (!payload || payload.ok !== true) process.exit(1);
  if (!payload.memory || typeof payload.memory !== 'object') process.exit(1);
  const required = ['brand_voice', 'policies', 'business_facts'];
  for (const key of required) {
    if (!(key in payload.memory)) process.exit(1);
  }
  process.exit(0);
} catch {
  process.exit(1);
}
JS
}

echo "Flow Brand Brain smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guard"
perform_request "${BASE}/api/business-memory?biz_id=00000000-0000-0000-0000-000000000000"
if [ "${REQ_CODE}" = "401" ] || [ "${REQ_CODE}" = "404" ]; then
  report_ok "GET /api/business-memory sense sessió (401/404)"
else
  report_fail "GET /api/business-memory sense sessió (expected 401/404)"
fi

echo ""
echo "2) Functional checks (opcional)"
if [ -n "${BRAND_BRAIN_BIZ_ID}" ] && [ -n "${BRAND_BRAIN_OWNER_COOKIE}" ]; then
  OWNER_COOKIE_HEADER="$(normalize_cookie_header "${BRAND_BRAIN_OWNER_COOKIE}" || true)"
  if [ -z "${OWNER_COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="BRAND_BRAIN_OWNER_COOKIE invàlida"
    report_fail "owner cookie format"
  else
    perform_request "${BASE}/api/business-memory?biz_id=${BRAND_BRAIN_BIZ_ID}" \
      -H "${OWNER_COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ] && validate_memory_shape "${REQ_BODY}"; then
      report_ok "GET /api/business-memory amb owner (200 + shape)"
    else
      report_fail "GET /api/business-memory amb owner (expected 200 + shape)"
    fi
  fi

  if [ -n "${BRAND_BRAIN_STAFF_COOKIE}" ]; then
    STAFF_COOKIE_HEADER="$(normalize_cookie_header "${BRAND_BRAIN_STAFF_COOKIE}" || true)"
    if [ -z "${STAFF_COOKIE_HEADER}" ]; then
      REQ_CODE="cookie"
      REQ_BODY="BRAND_BRAIN_STAFF_COOKIE invàlida"
      report_fail "staff cookie format"
    else
      perform_request -X PUT "${BASE}/api/business-memory?biz_id=${BRAND_BRAIN_BIZ_ID}" \
        -H "${STAFF_COOKIE_HEADER}" \
        -H "Content-Type: application/json" \
        -d '{"brand_voice":{"tone":["proper"]}}'
      if [ "${REQ_CODE}" = "403" ] || [ "${REQ_CODE}" = "404" ]; then
        report_ok "PUT /api/business-memory amb staff (403/404)"
      else
        report_fail "PUT /api/business-memory amb staff (expected 403/404)"
      fi
    fi
  else
    report_ok "staff PUT SKIP (defineix BRAND_BRAIN_STAFF_COOKIE)"
  fi

  if [ -n "${OWNER_COOKIE_HEADER:-}" ]; then
    perform_request -X PUT "${BASE}/api/business-memory?biz_id=${BRAND_BRAIN_BIZ_ID}" \
      -H "${OWNER_COOKIE_HEADER}" \
      -H "Content-Type: application/json" \
      -d '{"brand_voice":{"tone":["proper","clar"],"formality":"mixt","keywords":["barri"]},"policies":{"never_mention":["descompte ocult"]},"business_facts":{"current_offers":["Menu migdia"]}}'
    if [ "${REQ_CODE}" = "200" ] && validate_memory_shape "${REQ_BODY}"; then
      report_ok "PUT /api/business-memory amb owner/manager (200 + shape)"
    else
      report_fail "PUT /api/business-memory amb owner/manager (expected 200 + shape)"
    fi
  fi
else
  report_ok "functional SKIP (defineix BRAND_BRAIN_BIZ_ID i BRAND_BRAIN_OWNER_COOKIE)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Brand Brain smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
