#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
LITO_ORCH_COOKIE="${LITO_ORCH_COOKIE:-${LITO_SESSION_COOKIE:-}}"
LITO_ORCH_BIZ_ID="${LITO_ORCH_BIZ_ID:-${LITO_BIZ_ID:-}}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""
LOGIN_CODE=""

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
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 45 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

wait_for_login_ready() {
  local tries=40
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "${code}" = "200" ]; then
      LOGIN_CODE="${code}"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  LOGIN_CODE="${code:-000}"
  return 1
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "$REQ_BODY" | head -c 320)"
  FAILURES=$((FAILURES + 1))
}

has_provider_key() {
  [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]
}

validate_stream_shape() {
  local body="$1"
  if printf '%s' "$body" | grep -q 'event: meta' \
    && printf '%s' "$body" | grep -q 'event: json' \
    && printf '%s' "$body" | grep -q 'event: done'; then
    return 0
  fi
  return 1
}

echo "Flow LITO orchestrator SAFE smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${LOGIN_CODE})"
else
  REQ_CODE="${LOGIN_CODE}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guard"
perform_request -X POST "${BASE}/api/lito/chat" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","message":"què toca avui","mode":"orchestrator_safe"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/chat orchestrator_safe sense sessió (401)"
else
  report_fail "POST /api/lito/chat orchestrator_safe sense sessió (expected 401)"
fi

echo ""
echo "2) Functional stream check (opcional)"
if [ -n "${LITO_ORCH_COOKIE}" ] && [ -n "${LITO_ORCH_BIZ_ID}" ] && has_provider_key; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_ORCH_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_ORCH_COOKIE invàlida"
    report_fail "cookie format"
  else
    perform_request -X POST "${BASE}/api/lito/chat" \
      -H "${COOKIE_HEADER}" \
      -H "Content-Type: application/json" \
      -H "Cache-Control: no-store" \
      -d "{\"biz_id\":\"${LITO_ORCH_BIZ_ID}\",\"message\":\"Què toca avui?\",\"mode\":\"orchestrator_safe\"}"

    if [ "${REQ_CODE}" = "200" ]; then
      if validate_stream_shape "${REQ_BODY}"; then
        report_ok "orchestrator_safe stream (meta+json+done)"
      else
        report_fail "orchestrator_safe stream shape (expected meta/json/done)"
      fi
    else
      report_fail "POST /api/lito/chat orchestrator_safe (expected 200)"
    fi
  fi
else
  report_ok "SKIP functional (defineix cookie/biz i OPENAI_API_KEY o ANTHROPIC_API_KEY)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "Result: PASS"
  exit 0
fi

echo "Result: FAIL (${FAILURES})"
exit 1
