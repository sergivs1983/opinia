#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_5_CRON_SECRET="${D2_5_CRON_SECRET:-}"
D2_5_EXPECT_MISSING_INTERNAL="${D2_5_EXPECT_MISSING_INTERNAL:-0}"

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
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 300)"
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

echo "Flow D2.5 cron smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Guard cron secret (404)"
perform_request "${BASE}/api/cron/social-reminders"
if [ "${REQ_CODE}" = "404" ]; then
  report_ok "GET /api/cron/social-reminders sense x-cron-secret (404)"
else
  report_fail "GET /api/cron/social-reminders sense x-cron-secret (expected 404)"
fi

perform_request "${BASE}/api/cron/signals-run"
if [ "${REQ_CODE}" = "404" ]; then
  report_ok "GET /api/cron/signals-run sense x-cron-secret (404)"
else
  report_fail "GET /api/cron/signals-run sense x-cron-secret (expected 404)"
fi

echo ""
echo "2) Cron runner behavior with x-cron-secret"
if [ -z "${D2_5_CRON_SECRET}" ]; then
  report_ok "SKIP (defineix D2_5_CRON_SECRET per provar 503/200)"
else
  if [ "${D2_5_EXPECT_MISSING_INTERNAL}" = "1" ]; then
    perform_request "${BASE}/api/cron/social-reminders" \
      -H "x-cron-secret: ${D2_5_CRON_SECRET}"
    if [ "${REQ_CODE}" = "503" ] && [ "$(json_field "${REQ_BODY}" "code")" = "cron_unavailable" ]; then
      report_ok "GET /api/cron/social-reminders amb secret però sense INTERNAL_HMAC_SECRET (503 cron_unavailable)"
    else
      report_fail "GET /api/cron/social-reminders missing internal secret (expected 503 cron_unavailable)"
    fi
  else
    perform_request "${BASE}/api/cron/social-reminders" \
      -H "x-cron-secret: ${D2_5_CRON_SECRET}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "GET /api/cron/social-reminders amb secret (200)"
    else
      report_fail "GET /api/cron/social-reminders amb secret (expected 200)"
    fi

    perform_request "${BASE}/api/cron/signals-run" \
      -H "x-cron-secret: ${D2_5_CRON_SECRET}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "GET /api/cron/signals-run amb secret (200)"
    else
      report_fail "GET /api/cron/signals-run amb secret (expected 200)"
    fi
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.5 cron smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
