#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
FLOW_D21_BIZ_ID="${FLOW_D21_BIZ_ID:-}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"
INTERNAL_HMAC_SECRET="${INTERNAL_HMAC_SECRET:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

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

report_ok() { echo "  [${PASS}] $1"; }
report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1" expected="$2"
  shift 2
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

make_hmac() {
  local path="$1" body="$2"
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

echo "Flow D2.1 Signals PRO smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Preflight /login" "200" "${BASE}/login"

echo ""
echo "1) Auth guard: GET /api/lito/signals-pro sense sessió -> 401"
check_status "signals-pro sense sessió" "401" \
  "${BASE}/api/lito/signals-pro?biz_id=00000000-0000-0000-0000-000000000000"

echo ""
echo "2) HMAC guard: POST /api/_internal/signals/run sense signatura -> 401"
perform_request -X POST "${BASE}/api/_internal/signals/run" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","provider":"google_business"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "signals worker sense HMAC (HTTP 401)"
else
  report_fail "signals worker sense HMAC (expected 401)"
fi

echo ""
echo "3) Funcional intern (opcional): HMAC valid"
if [ -n "${FLOW_D21_BIZ_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET}" ]; then
  BODY="{\"biz_id\":\"${FLOW_D21_BIZ_ID}\",\"provider\":\"google_business\",\"range_days\":7}"
  HMAC_OUT="$(make_hmac "/api/_internal/signals/run" "${BODY}")"
  TS="$(printf '%s\n' "${HMAC_OUT}" | sed -n '1p')"
  SIG="$(printf '%s\n' "${HMAC_OUT}" | sed -n '2p')"

  perform_request -X POST "${BASE}/api/_internal/signals/run" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${TS}" \
    -H "x-opin-signature: ${SIG}" \
    -d "${BODY}"

  if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "ok")" = "true" ]; then
    report_ok "signals worker amb HMAC (200, ok=true)"
  else
    report_fail "signals worker amb HMAC (expected 200 + ok=true)"
  fi
else
  report_ok "signals worker funcional SKIP (defineix FLOW_D21_BIZ_ID i INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "4) Funcional públic (opcional): GET signals-pro amb sessió"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${FLOW_D21_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request "${BASE}/api/lito/signals-pro?biz_id=${FLOW_D21_BIZ_ID}&range_days=7" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      SIGNALS_RAW="$(json_field "${REQ_BODY}" "signals")"
      COUNT="$(node -e "const s=process.argv[1]||'[]';try{const a=JSON.parse(s);process.stdout.write(String(a.length));}catch{process.stdout.write('0');}" "${SIGNALS_RAW}")"
      if [ "${COUNT:-0}" -ge 1 ] 2>/dev/null; then
        report_ok "signals-pro amb sessió (200, signals=${COUNT})"
      else
        report_fail "signals-pro amb sessió (signals buit)"
      fi
    else
      report_fail "signals-pro amb sessió (expected 200)"
    fi
  fi
else
  report_ok "signals-pro funcional SKIP (defineix LITO_SESSION_COOKIE i FLOW_D21_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.1 signals-pro smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
