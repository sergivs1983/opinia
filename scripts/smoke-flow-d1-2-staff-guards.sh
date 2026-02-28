#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_D12_STAFF_COOKIE="${FLOW_D12_STAFF_COOKIE:-}"
FLOW_D12_STAFF_BIZ_ID="${FLOW_D12_STAFF_BIZ_ID:-}"
FLOW_D12_STAFF_RECOMMENDATION_ID="${FLOW_D12_STAFF_RECOMMENDATION_ID:-}"

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
  local raw="$1"
  raw="$(printf '%s' "${raw}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [ -z "${raw}" ]; then
    echo ""
    return 1
  fi
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    printf '%s' "${raw}"
    return 0
  fi
  printf 'Cookie: %s' "${raw}"
  return 0
}

is_inflight_error() {
  local err
  err="$(json_field "$1" "error")"
  [ "${err}" = "in_flight" ] || [ "${err}" = "retry_later" ]
}

echo "Flow D1.2 staff guards smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request -X POST "${BASE}/api/lito/copy/generate" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","recommendation_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/copy/generate sense sessió (401)"
else
  report_fail "POST /api/lito/copy/generate sense sessió (expected 401)"
fi

echo ""
echo "2) Functional opcional (requereix cookie staff)"
if [ -n "${FLOW_D12_STAFF_COOKIE}" ] && [ -n "${FLOW_D12_STAFF_BIZ_ID}" ] && [ -n "${FLOW_D12_STAFF_RECOMMENDATION_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${FLOW_D12_STAFF_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="FLOW_D12_STAFF_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request -X POST "${BASE}/api/lito/copy/generate" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${FLOW_D12_STAFF_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_STAFF_RECOMMENDATION_ID}\"}"
    gen_code_1="${REQ_CODE}"
    gen_body_1="${REQ_BODY}"

    perform_request -X POST "${BASE}/api/lito/copy/generate" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${FLOW_D12_STAFF_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_STAFF_RECOMMENDATION_ID}\"}"
    gen_code_2="${REQ_CODE}"
    gen_body_2="${REQ_BODY}"

    if [ "${gen_code_1}" = "200" ] && [ "${gen_code_2}" = "200" ]; then
      rem1="$(json_field "${gen_body_1}" "quota.remaining")"
      rem2="$(json_field "${gen_body_2}" "quota.remaining")"
      if [ -n "${rem1}" ] && [ -n "${rem2}" ] && [ "${rem1}" = "${rem2}" ]; then
        report_ok "Idempotència generate (dues 200 amb mateixa quota)"
      else
        REQ_CODE="${gen_code_2}"
        REQ_BODY="${gen_body_2}"
        report_fail "Idempotència generate (dues 200 però quota diferent)"
      fi
    elif [ "${gen_code_1}" = "200" ] && [ "${gen_code_2}" = "409" ] && is_inflight_error "${gen_body_2}"; then
      report_ok "Idempotència generate (200 + 409 in_flight/retry_later)"
    elif [ "${gen_code_1}" = "409" ] && is_inflight_error "${gen_body_1}"; then
      report_ok "Idempotència generate (409 in_flight/retry_later)"
    else
      REQ_CODE="${gen_code_2}"
      REQ_BODY="${gen_body_2}"
      report_fail "Idempotència generate (esperat 200/409 coherent)"
    fi

    rate_limited=0
    for i in $(seq 1 14); do
      perform_request -X POST "${BASE}/api/lito/copy/refine" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_STAFF_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_STAFF_RECOMMENDATION_ID}\",\"mode\":\"custom\",\"instruction\":\"staff-limit-${i}-$(date +%s)\"}"
      if [ "${REQ_CODE}" = "429" ] && [ "$(json_field "${REQ_BODY}" "error")" = "staff_daily_limit" ]; then
        rate_limited=1
        break
      fi
    done

    if [ "${rate_limited}" -eq 1 ]; then
      report_ok "Rate limit staff (429 staff_daily_limit)"
    else
      report_fail "Rate limit staff (esperat 429 staff_daily_limit en <=14 intents)"
    fi

    perform_request -X POST "${BASE}/api/recommendations/${FLOW_D12_STAFF_RECOMMENDATION_ID}/feedback" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d '{"status":"published"}'
    if [ "${REQ_CODE}" = "403" ]; then
      report_ok "Publish mark bloquejat per staff (403)"
    else
      report_fail "Publish mark bloquejat per staff (expected 403)"
    fi
  fi
else
  report_ok "functional SKIP (defineix FLOW_D12_STAFF_COOKIE + FLOW_D12_STAFF_BIZ_ID + FLOW_D12_STAFF_RECOMMENDATION_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.2 staff guard smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
