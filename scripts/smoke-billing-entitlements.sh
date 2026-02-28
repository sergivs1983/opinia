#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_BILLING_ORG_ID="${FLOW_BILLING_ORG_ID:-}"
FLOW_BILLING_COOKIE="${FLOW_BILLING_COOKIE:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
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
  local raw
  raw="$(printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [ -z "$raw" ]; then
    return 1
  fi
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    printf '%s' "$raw"
    return 0
  fi
  printf 'Cookie: %s' "$raw"
}

echo "Billing entitlements smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

perform_request "${BASE}/api/billing/entitlements?org_id=00000000-0000-0000-0000-000000000000"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/billing/entitlements sense sessió (401)"
else
  report_fail "GET /api/billing/entitlements sense sessió (expected 401)"
fi

echo ""
echo "Functional (opcional amb FLOW_BILLING_COOKIE + FLOW_BILLING_ORG_ID)"
if [ -n "${FLOW_BILLING_COOKIE}" ] && [ -n "${FLOW_BILLING_ORG_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${FLOW_BILLING_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="FLOW_BILLING_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request "${BASE}/api/billing/entitlements?org_id=${FLOW_BILLING_ORG_ID}" -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      plan_code="$(json_field "${REQ_BODY}" "plan_code")"
      drafts_limit="$(json_field "${REQ_BODY}" "entitlements.lito_drafts_limit")"
      if [ -n "${plan_code}" ] && [ -n "${drafts_limit}" ]; then
        report_ok "GET /api/billing/entitlements amb sessió (plan=${plan_code}, limit=${drafts_limit})"
      else
        report_fail "GET /api/billing/entitlements manca plan_code o lito_drafts_limit"
      fi
    else
      report_fail "GET /api/billing/entitlements amb sessió (expected 200)"
    fi

    perform_request -X POST "${BASE}/api/billing/staff-ai-paused" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"org_id\":\"${FLOW_BILLING_ORG_ID}\",\"paused\":false}"

    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "404" ]; then
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "POST /api/billing/staff-ai-paused (owner/manager)"
      else
        report_ok "POST /api/billing/staff-ai-paused SKIP (usuari sense permís owner/manager)"
      fi
    else
      report_fail "POST /api/billing/staff-ai-paused (expected 200/404)"
    fi
  fi
else
  report_ok "functional SKIP (defineix FLOW_BILLING_COOKIE i FLOW_BILLING_ORG_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All billing entitlement smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
