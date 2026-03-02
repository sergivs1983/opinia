#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
RATE_LIMIT_SESSION_COOKIE="${RATE_LIMIT_SESSION_COOKIE:-}"
RATE_LIMIT_BIZ_ID="${RATE_LIMIT_BIZ_ID:-}"
RATE_LIMIT_MAX_ATTEMPTS="${RATE_LIMIT_MAX_ATTEMPTS:-300}"

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
  if [ -z "${raw}" ]; then
    return 1
  fi
  case "${raw}" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
  else
    payload="${raw}"
  fi
  payload="$(trim_spaces "${payload}")"
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then
    return 1
  fi
  printf 'Cookie: %s' "${payload}"
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "${resp}" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "${resp}" | sed '$d')"
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

json_field() {
  local json="$1" path="$2"
  JSON_INPUT="$json" JSON_PATH="$path" node - <<'JS'
const input = process.env.JSON_INPUT || '{}';
const path = process.env.JSON_PATH || '';
try {
  const parsed = JSON.parse(input);
  const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), parsed);
  if (value === undefined || value === null) process.stdout.write('');
  else if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
  else process.stdout.write(String(value));
} catch {
  process.stdout.write('');
}
JS
}

echo "Flow D3.2 rate-limit smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

echo ""
echo "1) Guard auth bàsic"
perform_request -X POST "${BASE}/api/lito/chat" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","message":"smoke","mode":"chat"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/chat sense sessió (401)"
else
  report_fail "POST /api/lito/chat sense sessió (expected 401)"
fi

echo ""
echo "2) Burst funcional (opcional)"
if [ -z "${RATE_LIMIT_SESSION_COOKIE}" ] || [ -z "${RATE_LIMIT_BIZ_ID}" ]; then
  report_ok "SKIP burst (defineix RATE_LIMIT_SESSION_COOKIE i RATE_LIMIT_BIZ_ID)"
else
  COOKIE_HEADER="$(normalize_cookie_header "${RATE_LIMIT_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="RATE_LIMIT_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    HIT_429=0
    for attempt in $(seq 1 "${RATE_LIMIT_MAX_ATTEMPTS}"); do
      perform_request -X POST "${BASE}/api/lito/chat" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${RATE_LIMIT_BIZ_ID}\",\"message\":\"smoke-rate-${attempt}\",\"mode\":\"chat\"}"

      if [ "${REQ_CODE}" = "200" ]; then
        continue
      fi

      if [ "${REQ_CODE}" = "429" ]; then
        HIT_429=1
        break
      fi

      report_fail "request inesperada durant burst (attempt=${attempt}, expected 200/429)"
      break
    done

    if [ "${HIT_429}" = "1" ]; then
      CODE_FIELD="$(json_field "${REQ_BODY}" "code")"
      RETRY_AFTER="$(json_field "${REQ_BODY}" "retry_after")"
      if [ "${CODE_FIELD}" = "rate_limited" ]; then
        report_ok "429 retorna code=rate_limited"
      else
        report_fail "429 sense code=rate_limited"
      fi
      if [ -n "${RETRY_AFTER}" ] && [ "${RETRY_AFTER}" -ge 1 ] 2>/dev/null; then
        report_ok "429 inclou retry_after (${RETRY_AFTER})"
      else
        report_fail "429 sense retry_after vàlid"
      fi
    else
      REQ_CODE="no_429"
      REQ_BODY="No s'ha arribat al límit dins RATE_LIMIT_MAX_ATTEMPTS=${RATE_LIMIT_MAX_ATTEMPTS}"
      report_fail "burst no arriba a 429"
    fi
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All D3.2 rate-limit smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
