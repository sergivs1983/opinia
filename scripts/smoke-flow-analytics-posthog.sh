#!/usr/bin/env bash
set -euo pipefail

BASE_INPUT="${1:-http://localhost:3000}"
BASE="$(printf '%s' "${BASE_INPUT}" | sed -E 's#://localhost([/:]|$)#://127.0.0.1\1#')"
ANALYTICS_SESSION_COOKIE="${ANALYTICS_SESSION_COOKIE:-}"
ANALYTICS_BIZ_ID="${ANALYTICS_BIZ_ID:-}"
POSTHOG_HOST="${POSTHOG_HOST:-https://eu.i.posthog.com}"
POSTHOG_PROJECT_API_KEY="${POSTHOG_PROJECT_API_KEY:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw payload normalized
  raw="$(trim_spaces "$1")"
  if [ -z "$raw" ]; then
    echo ""
    return 1
  fi
  case "$raw" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "$raw" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "$payload")"
    normalized="Cookie: $payload"
  else
    payload="$raw"
    normalized="Cookie: $payload"
  fi
  if [ -z "$payload" ] || ! printf '%s' "$payload" | grep -q '='; then
    return 1
  fi
  printf '%s' "$normalized"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

wait_for_login_ready() {
  local tries=30
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "$code" = "200" ] || [ "$code" = "307" ]; then
      REQ_CODE="$code"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  REQ_CODE="${code:-000}"
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

echo "Flow analytics PostHog smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${REQ_CODE})"
else
  REQ_BODY=""
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request "${BASE}/api/analytics/capture" \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'x-request-id: smoke-analytics-auth-guard' \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","event":"test_event_opinia","mode":"basic"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/analytics/capture sense sessió (401)"
else
  report_fail "POST /api/analytics/capture sense sessió (expected 401)"
fi

echo ""
echo "2) PostHog host capture connectivity (optional)"
if [ -z "${POSTHOG_PROJECT_API_KEY}" ]; then
  report_ok "SKIP host capture (POSTHOG_PROJECT_API_KEY no definit)"
else
  perform_request "${POSTHOG_HOST%/}/capture/" \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"api_key\":\"${POSTHOG_PROJECT_API_KEY}\",\"event\":\"test_event_opinia\",\"distinct_id\":\"smoke-opinia\",\"properties\":{\"source\":\"smoke\"}}"
  if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "204" ]; then
    report_ok "POST ${POSTHOG_HOST%/}/capture/ (HTTP ${REQ_CODE})"
  else
    report_fail "POST ${POSTHOG_HOST%/}/capture/ (expected 200/204)"
  fi
fi

echo ""
echo "3) Functional endpoint->server capture (optional)"
if [ -z "${ANALYTICS_SESSION_COOKIE}" ] || [ -z "${ANALYTICS_BIZ_ID}" ]; then
  report_ok "SKIP functional (defineix ANALYTICS_SESSION_COOKIE + ANALYTICS_BIZ_ID)"
else
  COOKIE_HEADER="$(normalize_cookie_header "${ANALYTICS_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="ANALYTICS_SESSION_COOKIE invàlida"
    report_fail "cookie format"
  else
    perform_request "${BASE}/api/analytics/capture" \
      -X POST \
      -H "${COOKIE_HEADER}" \
      -H 'Content-Type: application/json' \
      -H 'x-request-id: smoke-analytics-functional' \
      -d "{\"biz_id\":\"${ANALYTICS_BIZ_ID}\",\"event\":\"test_event_opinia\",\"mode\":\"basic\",\"properties\":{\"source\":\"smoke\"}}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "POST /api/analytics/capture funcional (200)"
    else
      report_fail "POST /api/analytics/capture funcional (expected 200)"
    fi
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "Analytics PostHog smoke passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
