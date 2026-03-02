#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
ORCH_CAP_SESSION_COOKIE="${ORCH_CAP_SESSION_COOKIE:-}"
ORCH_CAP_BIZ_ID="${ORCH_CAP_BIZ_ID:-}"
ORCH_CAP_MAX_ATTEMPTS="${ORCH_CAP_MAX_ATTEMPTS:-80}"

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

echo "Flow D3.2 orchestrator-cap smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

echo ""
echo "1) Guard auth bàsic"
perform_request -X POST "${BASE}/api/lito/chat" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","message":"Què toca avui?","mode":"orchestrator_safe"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/chat orchestrator_safe sense sessió (401)"
else
  report_fail "POST /api/lito/chat orchestrator_safe sense sessió (expected 401)"
fi

echo ""
echo "2) Cap funcional (opcional)"
if [ -z "${ORCH_CAP_SESSION_COOKIE}" ] || [ -z "${ORCH_CAP_BIZ_ID}" ]; then
  report_ok "SKIP cap test (defineix ORCH_CAP_SESSION_COOKIE i ORCH_CAP_BIZ_ID)"
else
  COOKIE_HEADER="$(normalize_cookie_header "${ORCH_CAP_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="ORCH_CAP_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    HIT_CAP=0
    for attempt in $(seq 1 "${ORCH_CAP_MAX_ATTEMPTS}"); do
      perform_request -X POST "${BASE}/api/lito/chat" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${ORCH_CAP_BIZ_ID}\",\"message\":\"Què toca avui? (${attempt})\",\"mode\":\"orchestrator_safe\"}"

      if [ "${REQ_CODE}" = "200" ]; then
        continue
      fi

      if [ "${REQ_CODE}" = "429" ]; then
        CODE_FIELD="$(json_field "${REQ_BODY}" "code")"
        if [ "${CODE_FIELD}" = "orchestrator_cap_reached" ]; then
          HIT_CAP=1
          break
        fi
        if [ "${CODE_FIELD}" = "rate_limited" ]; then
          sleep 1
          continue
        fi
      fi

      report_fail "response inesperada durant cap loop (attempt=${attempt}, expected 200/429)"
      break
    done

    if [ "${HIT_CAP}" = "1" ]; then
      RESETS_AT="$(json_field "${REQ_BODY}" "resets_at")"
      if [ -n "${RESETS_AT}" ]; then
        report_ok "429 cap inclou resets_at (${RESETS_AT})"
      else
        report_fail "429 cap sense resets_at"
      fi
      report_ok "orchestrator cap reached"
    else
      REQ_CODE="no_cap"
      REQ_BODY="No s'ha assolit orchestrator_cap_reached dins ORCH_CAP_MAX_ATTEMPTS=${ORCH_CAP_MAX_ATTEMPTS}. Pot ser que el biz no tingui cards o que el límit sigui alt."
      report_fail "cap no assolit"
    fi
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All D3.2 orchestrator-cap smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
