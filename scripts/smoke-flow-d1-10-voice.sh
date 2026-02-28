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
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 320)"
  FAILURES=$((FAILURES + 1))
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
  if (value === undefined || value === null) process.stdout.write('');
  else if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
  else process.stdout.write(String(value));
} catch {
  process.stdout.write('');
}
JS
}

normalize_cookie_header() {
  local raw normalized
  raw="$(printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [ -z "${raw}" ]; then
    echo ""
    return 1
  fi
  case "${raw}" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    normalized="${raw}"
  else
    normalized="Cookie: ${raw}"
  fi
  if ! printf '%s' "${normalized}" | grep -q '='; then
    return 1
  fi
  printf '%s' "${normalized}"
  return 0
}

echo "Flow D1.10 Voice smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guards"
perform_request -X POST "${BASE}/api/lito/voice/prepare" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/voice/prepare sense sessió (401)"
else
  report_fail "POST /api/lito/voice/prepare sense sessió (expected 401)"
fi

perform_request -X POST "${BASE}/api/lito/voice/transcribe" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","transcript_text":"test"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/voice/transcribe sense sessió (401)"
else
  report_fail "POST /api/lito/voice/transcribe sense sessió (expected 401)"
fi

echo ""
echo "2) Functional opcional (LITO_SESSION_COOKIE + LITO_BIZ_ID)"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${LITO_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    report_ok "cookie format validat (redacted)"

    perform_request -X POST "${BASE}/api/lito/voice/transcribe" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${LITO_BIZ_ID}\",\"transcript_text\":\"Avui tanquem a les 18h i fem una story per avisar clients\",\"transcript_lang\":\"ca\"}"

    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "voice transcribe amb sessió (HTTP 200)"
      ACTION_COUNT="$(json_field "${REQ_BODY}" "actions.length")"
      if [ -n "${ACTION_COUNT}" ] && [ "${ACTION_COUNT}" -ge 1 ] 2>/dev/null; then
        report_ok "voice transcribe genera >=1 draft"
      else
        REQ_CODE="shape"
        REQ_BODY="actions.length=${ACTION_COUNT}"
        report_fail "voice transcribe genera >=1 draft"
      fi

      perform_request "${BASE}/api/lito/action-drafts?biz_id=${LITO_BIZ_ID}&limit=5" \
        -H "${COOKIE_HEADER}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "GET /api/lito/action-drafts (HTTP 200)"
      else
        report_fail "GET /api/lito/action-drafts (expected 200)"
      fi
    elif [ "${REQ_CODE}" = "503" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"voice_unavailable"'; then
      report_ok "voice unavailable contract (503 voice_unavailable)"
    else
      report_fail "voice transcribe amb sessió (expected 200 o 503 voice_unavailable)"
    fi
  fi
else
  report_ok "functional SKIP (defineix LITO_SESSION_COOKIE i LITO_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.10 Voice smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
