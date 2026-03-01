#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_D19_ORG_ID="${FLOW_D19_ORG_ID:-00000000-0000-0000-0000-000000000000}"
FLOW_D19_BIZ_ID="${FLOW_D19_BIZ_ID:-}"
FLOW_D19_RECOMMENDATION_ID="${FLOW_D19_RECOMMENDATION_ID:-}"
FLOW_D19_SESSION_COOKIE="${FLOW_D19_SESSION_COOKIE:-}"

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

report_skip() {
  echo "  [SKIP] $1"
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

echo "Flow D1.9 trial smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request "${BASE}/api/billing/trial?org_id=${FLOW_D19_ORG_ID}"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/billing/trial sense sessió (401)"
else
  report_fail "GET /api/billing/trial sense sessió (expected 401)"
fi

echo ""
echo "2) Functional opcional (sessió real)"
if [ -n "${FLOW_D19_SESSION_COOKIE}" ] && [ -n "${FLOW_D19_ORG_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${FLOW_D19_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="FLOW_D19_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request "${BASE}/api/billing/trial?org_id=${FLOW_D19_ORG_ID}" -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "GET /api/billing/trial amb sessió (200)"
      TRIAL_STATE="$(json_field "${REQ_BODY}" "trial_state")"
      TRIAL_CAP="$(json_field "${REQ_BODY}" "cap")"
      TRIAL_USED="$(json_field "${REQ_BODY}" "used_estimate")"

      if [ -n "${FLOW_D19_BIZ_ID}" ] && [ -n "${FLOW_D19_RECOMMENDATION_ID}" ]; then
        if [ "${TRIAL_STATE}" = "ended" ]; then
          perform_request -X POST "${BASE}/api/lito/copy/generate" \
            -H "Content-Type: application/json" \
            -H "${COOKIE_HEADER}" \
            -d "{\"biz_id\":\"${FLOW_D19_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D19_RECOMMENDATION_ID}\"}"
          if [ "${REQ_CODE}" = "402" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"trial_ended"'; then
            report_ok "generate bloquejat amb trial_ended (402)"
          else
            report_fail "generate trial ended (expected 402 trial_ended)"
          fi
        elif [ "${TRIAL_STATE}" = "active" ] && [ -n "${TRIAL_CAP}" ] && [ -n "${TRIAL_USED}" ] && [ "${TRIAL_USED}" -ge "${TRIAL_CAP}" ]; then
          perform_request -X POST "${BASE}/api/lito/copy/generate" \
            -H "Content-Type: application/json" \
            -H "${COOKIE_HEADER}" \
            -d "{\"biz_id\":\"${FLOW_D19_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D19_RECOMMENDATION_ID}\"}"
          if [ "${REQ_CODE}" = "402" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"trial_cap_reached"'; then
            report_ok "generate bloquejat amb trial_cap_reached (402)"
          else
            report_fail "generate trial cap reached (expected 402 trial_cap_reached)"
          fi
        else
          report_skip "estat trial no forçat (per provar 402 posa trial ended o used>=cap)"
        fi
      else
        report_skip "funcional generate SKIP (defineix FLOW_D19_BIZ_ID i FLOW_D19_RECOMMENDATION_ID)"
      fi
    else
      report_fail "GET /api/billing/trial amb sessió (expected 200)"
    fi
  fi
else
  report_skip "functional SKIP (defineix FLOW_D19_SESSION_COOKIE + FLOW_D19_ORG_ID)"
fi

echo ""
if [ "${FAILURES}" -gt 0 ]; then
  echo "Resultat: ${FAILURES} prova(es) en FAIL"
  exit 1
fi

echo "Resultat: PASS"
