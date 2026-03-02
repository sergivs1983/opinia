#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
GBP_REVIEWS_BIZ_ID="${GBP_REVIEWS_BIZ_ID:-}"
INTERNAL_HMAC_SECRET="${INTERNAL_HMAC_SECRET:-}"

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

make_hmac() {
  local path="$1"
  local body="$2"
  OPIN_PATH="$path" OPIN_BODY="$body" INTERNAL_HMAC_SECRET="$INTERNAL_HMAC_SECRET" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET || '';
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

wait_for_login_ready() {
  local tries=40
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "${code}" = "200" ]; then
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  REQ_CODE="${code:-000}"
  REQ_BODY=""
  return 1
}

echo "Flow GBP Reviews READ smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guards"
perform_request "${BASE}/api/lito/action-cards?biz_id=00000000-0000-0000-0000-000000000000"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/lito/action-cards sense sessió (401)"
else
  report_fail "GET /api/lito/action-cards sense sessió (expected 401)"
fi

perform_request -X POST "${BASE}/api/lito/reviews/drafts" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","review_id":"00000000-0000-0000-0000-000000000000","response_text":"test"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/reviews/drafts sense sessió (401)"
else
  report_fail "POST /api/lito/reviews/drafts sense sessió (expected 401)"
fi

echo ""
echo "2) HMAC guard worker"
perform_request -X POST "${BASE}/api/_internal/gbp/reviews/sync" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/_internal/gbp/reviews/sync sense HMAC (401)"
else
  report_fail "POST /api/_internal/gbp/reviews/sync sense HMAC (expected 401)"
fi

echo ""
echo "3) Functional intern (opcional)"
if [ -n "${GBP_REVIEWS_BIZ_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET}" ]; then
  BODY="{\"biz_id\":\"${GBP_REVIEWS_BIZ_ID}\"}"
  HMAC_LINES="$(make_hmac "/api/_internal/gbp/reviews/sync" "${BODY}")"
  TS="$(printf '%s\n' "${HMAC_LINES}" | head -n 1)"
  SIG="$(printf '%s\n' "${HMAC_LINES}" | tail -n 1)"

  perform_request -X POST "${BASE}/api/_internal/gbp/reviews/sync" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${TS}" \
    -H "x-opin-signature: ${SIG}" \
    -d "${BODY}"

  if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "ok")" = "true" ]; then
    report_ok "worker GBP reviews amb HMAC (200, ok=true)"
  else
    report_fail "worker GBP reviews amb HMAC (expected 200 + ok=true)"
  fi
else
  report_ok "functional SKIP (defineix GBP_REVIEWS_BIZ_ID i INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All GBP Reviews smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
