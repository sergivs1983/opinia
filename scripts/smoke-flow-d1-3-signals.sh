#!/usr/bin/env bash
# Flow D1.3 Signals PRO smoke test
# Usage:
#   ./scripts/smoke-flow-d1-3-signals.sh [BASE_URL]
#
# Optional env vars:
#   INTERNAL_HMAC_SECRET      — enables HMAC-signed rollup call
#   FLOW_D13_BIZ_ID           — biz_id UUID for rollup + signals tests
#   LITO_SESSION_COOKIE       — session cookie for auth'd signals call
set -euo pipefail

BASE="${1:-http://localhost:3000}"
INTERNAL_HMAC_SECRET="${INTERNAL_HMAC_SECRET:-}"
FLOW_D13_BIZ_ID="${FLOW_D13_BIZ_ID:-}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

# ── Helpers ───────────────────────────────────────────────────────────────────

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw normalized payload
  raw="$(trim_spaces "$1")"
  if [ -z "${raw}" ]; then echo ""; return 1; fi
  case "${raw}" in *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;; esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "${payload}")"
    normalized="Cookie: ${payload}"
  else
    normalized="Cookie: ${raw}"
    payload="${raw}"
  fi
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then return 1; fi
  printf '%s' "${normalized}"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 25 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok()   { echo "  [${PASS}] $1"; }
report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1" expected="$2"; shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    report_ok "${label} (HTTP ${REQ_CODE})"
  else
    report_fail "${label} (expected ${expected})"
  fi
}

json_field() {
  local json="$1" path="$2"
  JSON_INPUT="$json" JSON_PATH="$path" node - <<'JS'
const input = process.env.JSON_INPUT || '';
const path  = process.env.JSON_PATH  || '';
try {
  const data  = JSON.parse(input);
  const value = path.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), data);
  if (value === undefined || value === null) process.stdout.write('');
  else if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
  else process.stdout.write(String(value));
} catch { process.stdout.write(''); }
JS
}

make_hmac() {
  local path="$1" body="$2"
  OPIN_PATH="$path" OPIN_BODY="$body" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET;
if (!secret) process.exit(2);
const ts       = Date.now().toString();
const path     = process.env.OPIN_PATH  || '';
const rawBody  = process.env.OPIN_BODY  || '';
const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig      = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo "Flow D1.3 Signals PRO smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

# 0) Preflight
check_status "Preflight /login" "200" "${BASE}/login"

echo ""
echo "1) HMAC guard — POST /api/_internal/insights/rollup sense HMAC → 401"
perform_request -X POST "${BASE}/api/_internal/insights/rollup" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "rollup sense HMAC (HTTP 401)"
else
  report_fail "rollup sense HMAC (expected 401)"
fi

echo ""
echo "2) HMAC valid — POST /api/_internal/insights/rollup amb HMAC"
if [ -n "${FLOW_D13_BIZ_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET}" ]; then
  YESTERDAY="$(node -e "const d=new Date();d.setUTCDate(d.getUTCDate()-1);process.stdout.write(d.toISOString().slice(0,10))")"
  BODY="{\"biz_id\":\"${FLOW_D13_BIZ_ID}\",\"provider\":\"google_business\",\"day\":\"${YESTERDAY}\"}"
  HMAC_OUT="$(make_hmac "/api/_internal/insights/rollup" "${BODY}")"
  TS="$(printf '%s\n' "${HMAC_OUT}" | sed -n '1p')"
  SIG="$(printf '%s\n' "${HMAC_OUT}" | sed -n '2p')"
  perform_request -X POST "${BASE}/api/_internal/insights/rollup" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${TS}" \
    -H "x-opin-signature: ${SIG}" \
    -d "${BODY}"
  if [ "${REQ_CODE}" = "200" ]; then
    OK_VAL="$(json_field "${REQ_BODY}" "ok")"
    PROCESSED="$(json_field "${REQ_BODY}" "processed")"
    if [ "${OK_VAL}" = "true" ]; then
      report_ok "rollup amb HMAC (200, ok=true, processed=${PROCESSED})"
    else
      report_fail "rollup amb HMAC (200 però ok!=true)"
    fi
  else
    report_fail "rollup amb HMAC (expected 200)"
  fi
else
  report_ok "rollup HMAC SKIP (defineix FLOW_D13_BIZ_ID i INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "3) Auth guard — GET /api/lito/signals sense sessió → 401"
check_status "signals sense sessió" "401" \
  "${BASE}/api/lito/signals?biz_id=00000000-0000-0000-0000-000000000000"

echo ""
echo "4) Funcional signals (opcional amb LITO_SESSION_COOKIE + FLOW_D13_BIZ_ID)"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${FLOW_D13_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request "${BASE}/api/lito/signals?biz_id=${FLOW_D13_BIZ_ID}" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      OK_VAL="$(json_field "${REQ_BODY}" "ok")"
      SIGNALS_RAW="$(json_field "${REQ_BODY}" "signals")"
      COUNT="$(node -e "
        const s = process.env.SIG_RAW;
        try { const a = JSON.parse(s); process.stdout.write(String(a.length)); } catch { process.stdout.write('0'); }
      " SIG_RAW="${SIGNALS_RAW}")"
      if [ "${OK_VAL}" = "true" ] && [ "${COUNT:-0}" -ge 1 ] 2>/dev/null; then
        report_ok "GET signals (200, ok=true, signals=${COUNT})"
      else
        report_fail "GET signals (200 però ok!=true o signals buit)"
      fi
    else
      report_fail "GET signals (expected 200)"
    fi
  fi
else
  report_ok "signals funcional SKIP (defineix LITO_SESSION_COOKIE i FLOW_D13_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.3 Signals PRO smoke tests passed."
  exit 0
fi
echo "${FAILURES} test(s) failed."
exit 1
