#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_D21_BIZ_ID="${FLOW_D21_BIZ_ID:-}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"
LITO_STAFF_SESSION_COOKIE="${LITO_STAFF_SESSION_COOKIE:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw normalized payload
  raw="$(trim_spaces "$1")"
  if [ -z "${raw}" ]; then echo ""; return 1; fi
  case "${raw}" in *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;; esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "${payload}")"
    normalized="Cookie: ${payload}"
  else
    normalized="Cookie: ${raw}"
    payload="${raw}"
  fi
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then return 1; fi
  printf '%s' "${normalized}"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() { echo "  [${PASS}] $1"; }
report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1" expected="$2"
  shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    report_ok "${label} (HTTP ${REQ_CODE})"
  else
    report_fail "${label} (expected ${expected})"
  fi
}

echo "Flow D2.1 backfill smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Preflight /login" "200" "${BASE}/login"

echo ""
echo "1) Auth guard: POST /api/lito/signals-pro/backfill sense sessió -> 401"
check_status "backfill sense sessió" "401" \
  -X POST "${BASE}/api/lito/signals-pro/backfill" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","day_from":"2026-02-15","day_to":"2026-02-28"}'

echo ""
echo "2) Staff role guard (opcional): 403/404"
if [ -n "${LITO_STAFF_SESSION_COOKIE}" ] && [ -n "${FLOW_D21_BIZ_ID}" ]; then
  STAFF_COOKIE_HEADER="$(normalize_cookie_header "${LITO_STAFF_SESSION_COOKIE}" || true)"
  if [ -z "${STAFF_COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_STAFF_SESSION_COOKIE invàlida"
    report_fail "cookie staff invàlida"
  else
    perform_request -X POST "${BASE}/api/lito/signals-pro/backfill" \
      -H "${STAFF_COOKIE_HEADER}" \
      -H "Content-Type: application/json" \
      -d "{\"biz_id\":\"${FLOW_D21_BIZ_ID}\",\"day_from\":\"2026-02-15\",\"day_to\":\"2026-02-28\"}"

    if [ "${REQ_CODE}" = "403" ] || [ "${REQ_CODE}" = "404" ]; then
      report_ok "staff guard (HTTP ${REQ_CODE})"
    else
      report_fail "staff guard (expected 403 or 404)"
    fi
  fi
else
  report_ok "staff guard SKIP (defineix LITO_STAFF_SESSION_COOKIE i FLOW_D21_BIZ_ID)"
fi

echo ""
echo "3) Functional owner/manager (opcional): 200"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${FLOW_D21_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie owner/manager invàlida"
  else
    TODAY="$(date -u +%F)"
    FROM_DAY="$(date -u -v-13d +%F 2>/dev/null || node -e "const d=new Date();d.setUTCDate(d.getUTCDate()-13);process.stdout.write(d.toISOString().slice(0,10));")"

    perform_request -X POST "${BASE}/api/lito/signals-pro/backfill" \
      -H "${COOKIE_HEADER}" \
      -H "Content-Type: application/json" \
      -d "{\"biz_id\":\"${FLOW_D21_BIZ_ID}\",\"day_from\":\"${FROM_DAY}\",\"day_to\":\"${TODAY}\"}"

    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "backfill owner/manager (HTTP 200)"
    else
      report_fail "backfill owner/manager (expected 200)"
    fi
  fi
else
  report_ok "backfill funcional SKIP (defineix LITO_SESSION_COOKIE i FLOW_D21_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.1 backfill smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
