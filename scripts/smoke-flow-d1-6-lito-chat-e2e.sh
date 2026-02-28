#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"
LITO_BIZ_ID="${LITO_BIZ_ID:-}"

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
    payload="${raw}"
    normalized="Cookie: ${payload}"
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

echo "Flow D1.6 LITO chat E2E smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${LOGIN_CODE})"
else
  REQ_CODE="${LOGIN_CODE}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guards"
check_status "POST /api/lito/threads sense sessió" "401" \
  -X POST "${BASE}/api/lito/threads" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","title":"Smoke D1.6 E2E"}'

check_status "POST /api/lito/threads/<id>/messages sense sessió" "401" \
  -X POST "${BASE}/api/lito/threads/00000000-0000-0000-0000-000000000000/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"hola"}'

echo ""
echo "2) Functional E2E (opcional amb LITO_SESSION_COOKIE + LITO_BIZ_ID)"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${LITO_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    report_ok "cookie/header format validat (redacted)"

    perform_request -X POST "${BASE}/api/lito/threads" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${LITO_BIZ_ID}\",\"title\":\"Smoke E2E thread\"}"
    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
      report_ok "create/open thread (HTTP ${REQ_CODE})"
    else
      report_fail "create/open thread (expected 200/201)"
    fi

    THREAD_ID="$(json_field "${REQ_BODY}" "thread.id")"
    if [ -z "${THREAD_ID}" ]; then
      REQ_CODE="parse"
      REQ_BODY="thread.id missing"
      report_fail "thread_id missing"
    else
      report_ok "thread_id captured"

      perform_request -X POST "${BASE}/api/lito/threads/${THREAD_ID}/messages" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d '{"content":"Prova E2E canònic"}'
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "canonical send (HTTP 200)"
      else
        report_fail "canonical send (expected 200)"
      fi
      CANONICAL_ROLE0="$(json_field "${REQ_BODY}" "messages.0.role")"
      CANONICAL_CONTENT0="$(json_field "${REQ_BODY}" "messages.0.content")"
      CANONICAL_ID0="$(json_field "${REQ_BODY}" "messages.0.id")"
      if [ -n "${CANONICAL_ID0}" ] && [ "${CANONICAL_ROLE0}" = "user" ] && [ -n "${CANONICAL_CONTENT0}" ]; then
        report_ok "canonical payload shape valid"
      else
        REQ_CODE="shape"
        REQ_BODY="$(printf 'id=%s role=%s content_len=%s' "${CANONICAL_ID0}" "${CANONICAL_ROLE0}" "${#CANONICAL_CONTENT0}")"
        report_fail "canonical payload shape valid"
      fi

      perform_request -X POST "${BASE}/api/lito/messages" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"thread_id\":\"${THREAD_ID}\",\"content\":\"Prova E2E compat\"}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "compat send wrapper (HTTP 200)"
      else
        report_fail "compat send wrapper (expected 200)"
      fi
    fi
  fi
else
  report_ok "functional E2E SKIP (defineix LITO_SESSION_COOKIE i LITO_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.6 LITO chat E2E smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1

