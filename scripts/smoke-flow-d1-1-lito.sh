#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"
LITO_BIZ_ID="${LITO_BIZ_ID:-}"
LITO_RECOMMENDATION_ID="${LITO_RECOMMENDATION_ID:-}"

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
  if [ -z "${raw}" ]; then
    echo ""
    return 1
  fi
  case "${raw}" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "${payload}")"
    normalized="Cookie: ${payload}"
  else
    normalized="Cookie: ${raw}"
    payload="${raw}"
  fi
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then
    return 1
  fi
  printf '%s' "${normalized}"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 25 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
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

json_field() {
  local json="$1"
  local path="$2"
  JSON_INPUT="$json" JSON_PATH="$path" node - <<'JS'
const input = process.env.JSON_INPUT || '';
const path = process.env.JSON_PATH || '';
try {
  const data = JSON.parse(input);
  const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), data);
  if (value === undefined || value === null) {
    process.stdout.write('');
  } else if (typeof value === 'object') {
    process.stdout.write(JSON.stringify(value));
  } else {
    process.stdout.write(String(value));
  }
} catch {
  process.stdout.write('');
}
JS
}

echo "Flow D1.1 LITO smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Preflight /login" "200" "${BASE}/login"

perform_request -i "${BASE}/dashboard/lito"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /dashboard/lito (HTTP ${REQ_CODE})"
else
  report_fail "Preflight /dashboard/lito (expected 200/307)"
fi

perform_request -i "${BASE}/dashboard/lito/chat"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /dashboard/lito/chat (HTTP ${REQ_CODE})"
else
  report_fail "Preflight /dashboard/lito/chat (expected 200/307)"
fi

echo ""
echo "1) Auth guards"
check_status "POST /api/lito/threads sense sessió" "401" \
  -X POST "${BASE}/api/lito/threads" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","title":"Smoke"}'

check_status "GET /api/lito/messages sense sessió" "401" \
  "${BASE}/api/lito/messages?thread_id=00000000-0000-0000-0000-000000000000"

check_status "POST /api/lito/messages sense sessió" "401" \
  -X POST "${BASE}/api/lito/messages" \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"00000000-0000-0000-0000-000000000000","content":"hola"}'

echo ""
echo "2) Functional (opcional amb LITO_SESSION_COOKIE + LITO_BIZ_ID)"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${LITO_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request -X POST "${BASE}/api/lito/threads" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${LITO_BIZ_ID}\"}"

    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
      report_ok "create/open thread (HTTP ${REQ_CODE})"
    else
      report_fail "create/open thread (expected 200/201)"
    fi

    THREAD_ID="$(json_field "${REQ_BODY}" "thread.id")"
    if [ -z "${THREAD_ID}" ]; then
      THREAD_ID="$(json_field "${REQ_BODY}" "thread_id")"
    fi
    if [ -z "${THREAD_ID}" ]; then
      REQ_CODE="parse"
      report_fail "thread id missing"
    else
      report_ok "thread id captured"

      perform_request -X POST "${BASE}/api/lito/messages" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"thread_id\":\"${THREAD_ID}\",\"content\":\"Necessito una guia ràpida\"}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "send message (HTTP 200)"
      else
        report_fail "send message (expected 200)"
      fi

      MSG_COUNT="$(json_field "${REQ_BODY}" "messages.length")"
      ROLE_0="$(json_field "${REQ_BODY}" "messages.0.role")"
      ROLE_1="$(json_field "${REQ_BODY}" "messages.1.role")"
      if [ "${MSG_COUNT:-0}" -eq 2 ] 2>/dev/null; then
        report_ok "messages length == 2"
      else
        report_fail "messages length == 2"
      fi
      if [ "${ROLE_0}" = "user" ] && [ "${ROLE_1}" = "assistant" ]; then
        report_ok "message roles user+assistant"
      else
        report_fail "message roles user+assistant"
      fi

      if [ -n "${LITO_RECOMMENDATION_ID}" ]; then
        perform_request -X POST "${BASE}/api/lito/threads" \
          -H "Content-Type: application/json" \
          -H "${COOKIE_HEADER}" \
          -d "{\"biz_id\":\"${LITO_BIZ_ID}\",\"recommendation_id\":\"${LITO_RECOMMENDATION_ID}\",\"format\":\"post\",\"hook\":\"Smoke recommendation\"}"
        if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
          report_ok "create/open recommendation thread #1 (HTTP ${REQ_CODE})"
        else
          report_fail "create/open recommendation thread #1 (expected 200/201)"
        fi
        REC_THREAD_ID_1="$(json_field "${REQ_BODY}" "thread.id")"

        perform_request -X POST "${BASE}/api/lito/threads" \
          -H "Content-Type: application/json" \
          -H "${COOKIE_HEADER}" \
          -d "{\"biz_id\":\"${LITO_BIZ_ID}\",\"recommendation_id\":\"${LITO_RECOMMENDATION_ID}\",\"format\":\"post\",\"hook\":\"Smoke recommendation\"}"
        if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
          report_ok "create/open recommendation thread #2 (HTTP ${REQ_CODE})"
        else
          report_fail "create/open recommendation thread #2 (expected 200/201)"
        fi
        REC_THREAD_ID_2="$(json_field "${REQ_BODY}" "thread.id")"

        if [ -n "${REC_THREAD_ID_1}" ] && [ -n "${REC_THREAD_ID_2}" ] && [ "${REC_THREAD_ID_1}" = "${REC_THREAD_ID_2}" ]; then
          report_ok "same recommendation_id reuses same thread id"
        else
          REQ_CODE="mismatch"
          REQ_BODY="thread#1=${REC_THREAD_ID_1} thread#2=${REC_THREAD_ID_2}"
          report_fail "same recommendation_id reuses same thread id"
        fi
      else
        report_ok "thread idempotency SKIP (defineix LITO_RECOMMENDATION_ID)"
      fi
    fi
  fi
else
  report_ok "functional SKIP (defineix LITO_SESSION_COOKIE i LITO_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.1 LITO smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
