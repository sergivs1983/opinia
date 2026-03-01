#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_7_COOKIE="${D2_7_COOKIE:-}"
D2_7_BIZ_ID="${D2_7_BIZ_ID:-}"

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

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "$REQ_BODY" | head -c 300)"
  FAILURES=$((FAILURES + 1))
}

echo "Flow D2.7 push smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

LOGIN_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${BASE}/login" 2>/dev/null || true)"
if [ "${LOGIN_CODE}" = "200" ]; then
  report_ok "Preflight /login (HTTP 200)"
else
  REQ_CODE="${LOGIN_CODE:-000}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guard"
perform_request -X POST "${BASE}/api/push/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","subscription":{"endpoint":"https://example.invalid/push","keys":{"p256dh":"BExampleP256dhKey0000000000000000000000","auth":"AuthKey0000"}}}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/push/subscribe sense sessió (401)"
else
  report_fail "POST /api/push/subscribe sense sessió (expected 401)"
fi

echo ""
echo "2) Functional subscribe/unsubscribe (opcional)"
if [ -n "${D2_7_COOKIE}" ] && [ -n "${D2_7_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${D2_7_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_7_COOKIE invàlida"
    report_fail "cookie format"
  else
    DUMMY_ENDPOINT="https://push.example.invalid/${D2_7_BIZ_ID}/$(date +%s)"

    perform_request "${BASE}/api/push/status?biz_id=${D2_7_BIZ_ID}" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "GET /api/push/status (200)"
    else
      report_fail "GET /api/push/status (expected 200)"
    fi

    perform_request -X POST "${BASE}/api/push/subscribe" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_7_BIZ_ID}\",\"subscription\":{\"endpoint\":\"${DUMMY_ENDPOINT}\",\"keys\":{\"p256dh\":\"BKgx9VyvQYw1KAlSx_3cP3mWjytjhF8P1ScuWGv4C5yQ3VlgrqkRskI2o7R8J9YJc2YdS8Ww9Xk3zLzX3P2dK1Q\",\"auth\":\"S0VZLWFVVEg\"}}}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "POST /api/push/subscribe (200)"
    else
      report_fail "POST /api/push/subscribe (expected 200)"
    fi

    perform_request -X POST "${BASE}/api/push/unsubscribe" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_7_BIZ_ID}\",\"endpoint\":\"${DUMMY_ENDPOINT}\"}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "POST /api/push/unsubscribe (200)"
    else
      report_fail "POST /api/push/unsubscribe (expected 200)"
    fi
  fi
else
  report_ok "SKIP functional (defineix D2_7_COOKIE i D2_7_BIZ_ID)"
fi

echo ""
echo "3) VAPID env probe"
if [ -n "${VAPID_PUBLIC_KEY:-}" ] && [ -n "${VAPID_PRIVATE_KEY:-}" ] && [ -n "${VAPID_SUBJECT:-}" ]; then
  report_ok "VAPID env detectat (probe)"
else
  report_ok "SKIP send push probe (falten VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "Result: PASS"
  exit 0
fi

echo "Result: FAIL (${FAILURES})"
exit 1
