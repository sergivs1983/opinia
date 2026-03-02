#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
RATE_LIMIT_DEV_SESSION_COOKIE="${RATE_LIMIT_DEV_SESSION_COOKIE:-}"
RATE_LIMIT_DEV_BIZ_ID="${RATE_LIMIT_DEV_BIZ_ID:-}"
RATE_LIMIT_DEV_ORG_ID="${RATE_LIMIT_DEV_ORG_ID:-}"
RATE_LIMIT_DEV_ATTEMPTS="${RATE_LIMIT_DEV_ATTEMPTS:-3}"

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

echo "Flow D3.2 DEV rate-limit smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if [ -z "${RATE_LIMIT_DEV_SESSION_COOKIE}" ] || [ -z "${RATE_LIMIT_DEV_BIZ_ID}" ] || [ -z "${RATE_LIMIT_DEV_ORG_ID}" ]; then
  REQ_CODE="env"
  REQ_BODY="Falten RATE_LIMIT_DEV_SESSION_COOKIE, RATE_LIMIT_DEV_BIZ_ID o RATE_LIMIT_DEV_ORG_ID"
  report_fail "Variables obligatòries"
  exit 1
fi

COOKIE_HEADER="$(normalize_cookie_header "${RATE_LIMIT_DEV_SESSION_COOKIE}" || true)"
if [ -z "${COOKIE_HEADER}" ]; then
  REQ_CODE="cookie"
  REQ_BODY="RATE_LIMIT_DEV_SESSION_COOKIE invàlida"
  report_fail "Cookie invàlida"
  exit 1
fi

echo ""
echo "1) Baseline telemetry (abans)"
perform_request "${BASE}/api/telemetry/summary?org_id=${RATE_LIMIT_DEV_ORG_ID}" \
  -H "${COOKIE_HEADER}"
if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET /api/telemetry/summary baseline (expected 200)"
  exit 1
fi
report_ok "GET /api/telemetry/summary baseline (HTTP 200)"
before_count="$(json_field "${REQ_BODY}" "guardrails.rate_limits_last_60m.count")"
if [ -z "${before_count}" ]; then
  REQ_CODE="parse"
  REQ_BODY="${REQ_BODY}"
  report_fail "No s'ha pogut llegir guardrails.rate_limits_last_60m.count"
  exit 1
fi
echo "  baseline.rate_limits_last_60m=${before_count}"

echo ""
echo "2) 429 forçat (query + header variants)"
for attempt in $(seq 1 "${RATE_LIMIT_DEV_ATTEMPTS}"); do
  if [ $((attempt % 2)) -eq 1 ]; then
    perform_request -X POST "${BASE}/api/lito/chat?__force_rate_limit=1" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${RATE_LIMIT_DEV_BIZ_ID}\",\"message\":\"smoke-rate-force-${attempt}\",\"mode\":\"chat\"}"
  else
    perform_request -X POST "${BASE}/api/lito/chat" \
      -H "Content-Type: application/json" \
      -H "x-opinia-force-rate-limit: 1" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${RATE_LIMIT_DEV_BIZ_ID}\",\"message\":\"smoke-rate-force-${attempt}\",\"mode\":\"chat\"}"
  fi

  if [ "${REQ_CODE}" != "429" ]; then
    report_fail "Attempt ${attempt} retorna 429"
    continue
  fi

  code_field="$(json_field "${REQ_BODY}" "code")"
  retry_after="$(json_field "${REQ_BODY}" "retry_after")"
  request_id="$(json_field "${REQ_BODY}" "request_id")"

  if [ "${code_field}" != "rate_limited" ]; then
    report_fail "Attempt ${attempt} retorna code=rate_limited"
    continue
  fi
  if [ -z "${retry_after}" ] || [ "${retry_after}" -lt 1 ] 2>/dev/null; then
    report_fail "Attempt ${attempt} retorna retry_after vàlid"
    continue
  fi
  if [ -z "${request_id}" ]; then
    report_fail "Attempt ${attempt} retorna request_id"
    continue
  fi

  report_ok "Attempt ${attempt} => 429 rate_limited (retry_after=${retry_after})"
done

echo ""
echo "3) Telemetry summary (després)"
perform_request "${BASE}/api/telemetry/summary?org_id=${RATE_LIMIT_DEV_ORG_ID}" \
  -H "${COOKIE_HEADER}"
if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET /api/telemetry/summary after (expected 200)"
else
  report_ok "GET /api/telemetry/summary after (HTTP 200)"
fi

after_count="$(json_field "${REQ_BODY}" "guardrails.rate_limits_last_60m.count")"
if [ -z "${after_count}" ]; then
  REQ_CODE="parse"
  report_fail "No s'ha pogut llegir guardrails.rate_limits_last_60m.count després"
else
  delta=$((after_count - before_count))
  echo "  after.rate_limits_last_60m=${after_count}"
  echo "  delta=${delta} (expected >= ${RATE_LIMIT_DEV_ATTEMPTS})"
  if [ "${delta}" -ge "${RATE_LIMIT_DEV_ATTEMPTS}" ]; then
    report_ok "Rate Limits (última hora) incrementa després dels forçats"
  else
    REQ_CODE="delta"
    REQ_BODY="delta=${delta}, expected>=${RATE_LIMIT_DEV_ATTEMPTS}"
    report_fail "Rate Limits (última hora) no incrementa prou"
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All DEV rate-limit smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
