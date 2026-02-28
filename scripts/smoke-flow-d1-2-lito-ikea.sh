#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_D12_BIZ_ID="${FLOW_D12_BIZ_ID:-}"
FLOW_D12_RECOMMENDATION_ID="${FLOW_D12_RECOMMENDATION_ID:-}"
FLOW_D12_SESSION_COOKIE="${FLOW_D12_SESSION_COOKIE:-}"

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
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
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

make_hmac() {
  local path="$1"
  local body="$2"
  OPIN_PATH="$path" OPIN_BODY="$body" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET;
if (!secret) process.exit(2);
const ts = Date.now().toString();
const path = process.env.OPIN_PATH || '';
const rawBody = process.env.OPIN_BODY || '';
const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

echo "Flow D1.2 IKEA smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ]; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guard copy endpoints"
perform_request -X POST "${BASE}/api/lito/copy/generate" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","recommendation_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/copy/generate sense sessió (401)"
else
  report_fail "POST /api/lito/copy/generate sense sessió (expected 401)"
fi

perform_request -X POST "${BASE}/api/lito/copy/refine" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","recommendation_id":"00000000-0000-0000-0000-000000000000","mode":"shorter"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/copy/refine sense sessió (401)"
else
  report_fail "POST /api/lito/copy/refine sense sessió (expected 401)"
fi

echo ""
echo "2) HMAC guard rollup"
perform_request -X POST "${BASE}/api/_internal/insights/rollup" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/_internal/insights/rollup sense HMAC (401)"
else
  report_fail "POST /api/_internal/insights/rollup sense HMAC (expected 401)"
fi

if [ -n "${FLOW_D12_BIZ_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET:-}" ]; then
  body="{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"provider\":\"google_business\",\"range_days\":7}"
  hmac="$(make_hmac "/api/_internal/insights/rollup" "${body}")"
  ts="$(printf '%s\n' "${hmac}" | sed -n '1p')"
  sig="$(printf '%s\n' "${hmac}" | sed -n '2p')"
  perform_request -X POST "${BASE}/api/_internal/insights/rollup" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${ts}" \
    -H "x-opin-signature: ${sig}" \
    -d "${body}"
  if [ "${REQ_CODE}" = "200" ]; then
    report_ok "POST /api/_internal/insights/rollup amb HMAC (200)"
  else
    report_fail "POST /api/_internal/insights/rollup amb HMAC (expected 200)"
  fi
else
  report_ok "rollup funcional SKIP (defineix FLOW_D12_BIZ_ID + INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "3) Functional opcional (sessió real)"
if [ -n "${FLOW_D12_SESSION_COOKIE}" ] && [ -n "${FLOW_D12_BIZ_ID}" ] && [ -n "${FLOW_D12_RECOMMENDATION_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${FLOW_D12_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="FLOW_D12_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request -X POST "${BASE}/api/lito/copy/generate" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\"}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "generate funcional (200)"
      stepsLen="$(json_field "${REQ_BODY}" "steps.length")"
      shortCopy="$(json_field "${REQ_BODY}" "copy_short")"
      if [ "${stepsLen:-0}" -ge 1 ] 2>/dev/null && [ -n "${shortCopy}" ]; then
        report_ok "generate retorna steps + copy"
      else
        report_fail "generate retorna steps + copy"
      fi
    else
      report_fail "generate funcional (expected 200)"
    fi

    perform_request -X POST "${BASE}/api/lito/copy/refine" \
      -H "Content-Type: application/json" \
      -H "${COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\",\"mode\":\"shorter\"}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "refine funcional (200)"
    else
      report_fail "refine funcional (expected 200)"
    fi
  fi
else
  report_ok "functional SKIP (defineix FLOW_D12_SESSION_COOKIE + FLOW_D12_BIZ_ID + FLOW_D12_RECOMMENDATION_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.2 IKEA smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
