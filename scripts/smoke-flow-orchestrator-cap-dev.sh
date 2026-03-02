#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
ORCH_CAP_DEV_SESSION_COOKIE="${ORCH_CAP_DEV_SESSION_COOKIE:-}"
ORCH_CAP_DEV_BIZ_ID="${ORCH_CAP_DEV_BIZ_ID:-}"
ORCH_CAP_DEV_ORG_ID="${ORCH_CAP_DEV_ORG_ID:-}"
ORCH_CAP_DEV_ATTEMPTS="${ORCH_CAP_DEV_ATTEMPTS:-3}"

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
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 360)"
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

echo "Flow D3.2 DEV orchestrator-cap smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if [ -z "${ORCH_CAP_DEV_SESSION_COOKIE}" ] || [ -z "${ORCH_CAP_DEV_BIZ_ID}" ] || [ -z "${ORCH_CAP_DEV_ORG_ID}" ]; then
  REQ_CODE="env"
  REQ_BODY="Falten ORCH_CAP_DEV_SESSION_COOKIE, ORCH_CAP_DEV_BIZ_ID o ORCH_CAP_DEV_ORG_ID"
  report_fail "Variables obligatòries"
  exit 1
fi

COOKIE_HEADER="$(normalize_cookie_header "${ORCH_CAP_DEV_SESSION_COOKIE}" || true)"
if [ -z "${COOKIE_HEADER}" ]; then
  REQ_CODE="cookie"
  REQ_BODY="ORCH_CAP_DEV_SESSION_COOKIE invàlida"
  report_fail "Cookie invàlida"
  exit 1
fi

echo ""
echo "1) Baseline telemetry (abans)"
perform_request "${BASE}/api/telemetry/summary?org_id=${ORCH_CAP_DEV_ORG_ID}" \
  -H "${COOKIE_HEADER}"
if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET /api/telemetry/summary baseline (expected 200)"
  exit 1
fi
report_ok "GET /api/telemetry/summary baseline (HTTP 200)"
before_count="$(json_field "${REQ_BODY}" "guardrails.orchestrator_cap_today.count")"
if [ -z "${before_count}" ]; then
  REQ_CODE="parse"
  report_fail "No s'ha pogut llegir guardrails.orchestrator_cap_today.count"
  exit 1
fi
echo "  baseline.orchestrator_cap_today=${before_count}"

echo ""
echo "2) Cap forçat (query + header variants)"
for attempt in $(seq 1 "${ORCH_CAP_DEV_ATTEMPTS}"); do
  if [ $((attempt % 2)) -eq 1 ]; then
    perform_request -X POST "${BASE}/api/lito/chat?__force_orchestrator_cap=1" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${ORCH_CAP_DEV_BIZ_ID}\",\"message\":\"smoke-cap-force-${attempt}\",\"mode\":\"orchestrator_safe\"}"
  else
    perform_request -X POST "${BASE}/api/lito/chat" \
      -H "Content-Type: application/json" \
      -H "x-opinia-force-orchestrator-cap: 1" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${ORCH_CAP_DEV_BIZ_ID}\",\"message\":\"smoke-cap-force-${attempt}\",\"mode\":\"orchestrator_safe\"}"
  fi

  if [ "${REQ_CODE}" != "429" ]; then
    report_fail "Attempt ${attempt} retorna 429"
    continue
  fi

  code_field="$(json_field "${REQ_BODY}" "code")"
  resets_at="$(json_field "${REQ_BODY}" "resets_at")"
  request_id="$(json_field "${REQ_BODY}" "request_id")"

  if [ "${code_field}" != "orchestrator_cap_reached" ]; then
    report_fail "Attempt ${attempt} retorna code=orchestrator_cap_reached"
    continue
  fi
  if [ -z "${resets_at}" ]; then
    report_fail "Attempt ${attempt} retorna resets_at"
    continue
  fi
  if [ -z "${request_id}" ]; then
    report_fail "Attempt ${attempt} retorna request_id"
    continue
  fi

  report_ok "Attempt ${attempt} => 429 orchestrator_cap_reached"
done

echo ""
echo "3) Telemetry summary (després)"
perform_request "${BASE}/api/telemetry/summary?org_id=${ORCH_CAP_DEV_ORG_ID}" \
  -H "${COOKIE_HEADER}"
if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET /api/telemetry/summary after (expected 200)"
else
  report_ok "GET /api/telemetry/summary after (HTTP 200)"
fi

after_count="$(json_field "${REQ_BODY}" "guardrails.orchestrator_cap_today.count")"
if [ -z "${after_count}" ]; then
  REQ_CODE="parse"
  report_fail "No s'ha pogut llegir guardrails.orchestrator_cap_today.count després"
else
  delta=$((after_count - before_count))
  echo "  after.orchestrator_cap_today=${after_count}"
  echo "  delta=${delta} (expected >= ${ORCH_CAP_DEV_ATTEMPTS})"
  if [ "${delta}" -ge "${ORCH_CAP_DEV_ATTEMPTS}" ]; then
    report_ok "Orchestrator Cap (avui) incrementa després dels forçats"
  else
    REQ_CODE="delta"
    REQ_BODY="delta=${delta}, expected>=${ORCH_CAP_DEV_ATTEMPTS}"
    report_fail "Orchestrator Cap (avui) no incrementa prou"
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All DEV orchestrator-cap smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
