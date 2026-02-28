#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0

FLOW_D1_COOKIE="${FLOW_D1_COOKIE:-}"
FLOW_D1_BIZ_ID="${FLOW_D1_BIZ_ID:-}"

REQ_CODE=""
REQ_BODY=""

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

echo "Flow D1.1 smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Preflight /login" "200" "${BASE}/login"

echo ""
echo "1) Auth guard"
check_status "POST /api/lito/threads sense sessió" "401" \
  -X POST "${BASE}/api/lito/threads" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'

echo ""
echo "2) Functional (opcional amb FLOW_D1_COOKIE + FLOW_D1_BIZ_ID)"
if [ -n "${FLOW_D1_COOKIE}" ] && [ -n "${FLOW_D1_BIZ_ID}" ]; then
  perform_request -X POST "${BASE}/api/lito/threads" \
    -H "Content-Type: application/json" \
    -H "Cookie: ${FLOW_D1_COOKIE}" \
    -d "{\"biz_id\":\"${FLOW_D1_BIZ_ID}\",\"title\":\"Smoke D1.1 thread\"}"

  if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
    report_ok "create thread (HTTP ${REQ_CODE})"
  else
    report_fail "create thread (expected 200/201)"
  fi

  THREAD_ID="$(json_field "${REQ_BODY}" "thread.id")"
  if [ -z "${THREAD_ID}" ]; then
    REQ_CODE="parse"
    REQ_BODY="${REQ_BODY}"
    report_fail "thread.id missing in create response"
  else
    report_ok "thread.id captured (${THREAD_ID})"

    perform_request -X POST "${BASE}/api/lito/threads/${THREAD_ID}/messages" \
      -H "Content-Type: application/json" \
      -H "Cookie: ${FLOW_D1_COOKIE}" \
      -d '{"role":"user","content":"Test smoke D1.1"}'
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "post user message (HTTP 200)"
    else
      report_fail "post user message (expected 200)"
    fi

    perform_request -X GET "${BASE}/api/lito/threads?biz_id=${FLOW_D1_BIZ_ID}&limit=20" \
      -H "Cookie: ${FLOW_D1_COOKIE}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "list threads (HTTP 200)"
    else
      report_fail "list threads (expected 200)"
    fi

    perform_request -X GET "${BASE}/api/lito/threads/${THREAD_ID}/messages?limit=200" \
      -H "Cookie: ${FLOW_D1_COOKIE}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "get messages (HTTP 200)"
    else
      report_fail "get messages (expected 200)"
    fi

    MSG_COUNT="$(json_field "${REQ_BODY}" "messages.length")"
    if [ -z "${MSG_COUNT}" ]; then MSG_COUNT="0"; fi
    if [ "${MSG_COUNT}" -ge 1 ] 2>/dev/null; then
      report_ok "messages length >= 1"
    else
      report_fail "messages length >= 1"
    fi

    FIRST_ROLE="$(json_field "${REQ_BODY}" "messages.0.role")"
    if [ "${FIRST_ROLE}" = "user" ] || printf '%s' "${REQ_BODY}" | grep -q '"role":"user"'; then
      report_ok "at least one user role message present"
    else
      report_fail "missing user role message"
    fi
  fi
else
  report_ok "functional SKIP (defineix FLOW_D1_COOKIE i FLOW_D1_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.1 smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
