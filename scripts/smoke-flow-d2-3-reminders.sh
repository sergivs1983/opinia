#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_3_OWNER_COOKIE="${D2_3_OWNER_COOKIE:-}"
D2_3_STAFF_COOKIE="${D2_3_STAFF_COOKIE:-}"
D2_3_BIZ_ID="${D2_3_BIZ_ID:-}"
D2_3_DRAFT_ID="${D2_3_DRAFT_ID:-}"
D2_3_ASSIGNED_USER_ID="${D2_3_ASSIGNED_USER_ID:-}"
INTERNAL_HMAC_SECRET="${INTERNAL_HMAC_SECRET:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""
LOGIN_CODE=""

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw normalized payload
  raw="$(trim_spaces "$1")"
  if [ -z "${raw}" ]; then
    echo ""
    return 1
  fi
  case "${raw}" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac

  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "${payload}")"
    normalized="Cookie: ${payload}"
  else
    payload="${raw}"
    normalized="Cookie: ${payload}"
  fi

  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then
    return 1
  fi

  printf '%s' "${normalized}"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

wait_for_login_ready() {
  local tries=40
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "${code}" = "200" ]; then
      LOGIN_CODE="${code}"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  LOGIN_CODE="${code:-000}"
  return 1
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
  if (value === undefined || value === null) {
    process.stdout.write('');
  } else if (typeof value === 'object') {
    process.stdout.write(JSON.stringify(value));
  } else {
    process.stdout.write(String(value));
  }
} catch {
  process.stdout.write('');
}
JS
}

generate_hmac_headers() {
  local body="$1"
  local path="$2"
  local method="$3"

  BODY_INPUT="$body" HMAC_PATH="$path" HMAC_METHOD="$method" INTERNAL_HMAC_SECRET="$INTERNAL_HMAC_SECRET" node - <<'JS'
const crypto = require('crypto');
const body = process.env.BODY_INPUT || '';
const path = process.env.HMAC_PATH || '';
const method = (process.env.HMAC_METHOD || 'POST').toUpperCase();
const secret = process.env.INTERNAL_HMAC_SECRET || '';
const ts = Date.now().toString();
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
const canonical = `${ts}.${method}.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}`);
JS
}

echo "Flow D2.3 reminders smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${LOGIN_CODE})"
else
  REQ_CODE="${LOGIN_CODE}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guards"
perform_request -X POST "${BASE}/api/social/schedules" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","draft_id":"00000000-0000-0000-0000-000000000000","platform":"instagram","scheduled_at":"2026-03-01T10:00:00.000Z","assigned_user_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/social/schedules sense sessió (401)"
else
  report_fail "POST /api/social/schedules sense sessió (expected 401)"
fi

perform_request -X POST "${BASE}/api/_internal/social/reminders/run" \
  -H "Content-Type: application/json" \
  -d '{}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/_internal/social/reminders/run sense HMAC (401)"
else
  report_fail "POST /api/_internal/social/reminders/run sense HMAC (expected 401)"
fi

echo ""
echo "2) Staff guard (opcional)"
if [ -n "${D2_3_STAFF_COOKIE}" ] && [ -n "${D2_3_BIZ_ID}" ] && [ -n "${D2_3_DRAFT_ID}" ] && [ -n "${D2_3_ASSIGNED_USER_ID}" ]; then
  STAFF_COOKIE_HEADER="$(normalize_cookie_header "${D2_3_STAFF_COOKIE}" || true)"
  if [ -z "${STAFF_COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_3_STAFF_COOKIE invàlida"
    report_fail "staff cookie format"
  else
    perform_request -X POST "${BASE}/api/social/schedules" \
      -H "Content-Type: application/json" \
      -H "${STAFF_COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_3_BIZ_ID}\",\"draft_id\":\"${D2_3_DRAFT_ID}\",\"platform\":\"instagram\",\"scheduled_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"assigned_user_id\":\"${D2_3_ASSIGNED_USER_ID}\"}"
    if [ "${REQ_CODE}" = "404" ] || [ "${REQ_CODE}" = "403" ]; then
      report_ok "staff create schedule blocked (${REQ_CODE})"
    else
      report_fail "staff create schedule blocked (expected 404/403)"
    fi
  fi
else
  report_ok "staff guard SKIP (defineix D2_3_STAFF_COOKIE + D2_3_BIZ_ID + D2_3_DRAFT_ID + D2_3_ASSIGNED_USER_ID)"
fi

echo ""
echo "3) Functional E2E (opcional)"
if [ -n "${D2_3_OWNER_COOKIE}" ] && [ -n "${D2_3_BIZ_ID}" ] && [ -n "${D2_3_DRAFT_ID}" ] && [ -n "${D2_3_ASSIGNED_USER_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET}" ]; then
  OWNER_COOKIE_HEADER="$(normalize_cookie_header "${D2_3_OWNER_COOKIE}" || true)"
  if [ -z "${OWNER_COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_3_OWNER_COOKIE invàlida"
    report_fail "owner cookie format"
  else
    report_ok "owner cookie validada (redacted)"
    SCHEDULE_AT_FUTURE="$(date -u -v+10M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)"

    perform_request -X POST "${BASE}/api/social/schedules" \
      -H "Content-Type: application/json" \
      -H "${OWNER_COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_3_BIZ_ID}\",\"draft_id\":\"${D2_3_DRAFT_ID}\",\"platform\":\"instagram\",\"scheduled_at\":\"${SCHEDULE_AT_FUTURE}\",\"assigned_user_id\":\"${D2_3_ASSIGNED_USER_ID}\"}"
    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
      report_ok "create schedule for publish flow (HTTP ${REQ_CODE})"
    else
      report_fail "create schedule for publish flow (expected 200/201)"
    fi
    PUBLISH_SCHEDULE_ID="$(json_field "${REQ_BODY}" "schedule.id")"

    if [ -z "${PUBLISH_SCHEDULE_ID}" ]; then
      REQ_CODE="parse"
      REQ_BODY="schedule.id missing"
      report_fail "capture publish schedule id"
    else
      report_ok "publish schedule id capturat"

      perform_request -X POST "${BASE}/api/social/schedules/${PUBLISH_SCHEDULE_ID}/publish" \
        -H "Content-Type: application/json" \
        -H "${OWNER_COOKIE_HEADER}" \
        -d '{}'
      if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "schedule.status")" = "published" ]; then
        report_ok "publish schedule (status=published)"
      else
        report_fail "publish schedule (expected 200 + published)"
      fi

      perform_request -X POST "${BASE}/api/social/schedules/${PUBLISH_SCHEDULE_ID}/publish" \
        -H "Content-Type: application/json" \
        -H "${OWNER_COOKIE_HEADER}" \
        -d '{}'
      if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "idempotent")" = "true" ]; then
        report_ok "publish idempotent second call"
      else
        report_fail "publish idempotent second call (expected 200 idempotent=true)"
      fi
    fi

    perform_request -X POST "${BASE}/api/social/schedules" \
      -H "Content-Type: application/json" \
      -H "${OWNER_COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_3_BIZ_ID}\",\"draft_id\":\"${D2_3_DRAFT_ID}\",\"platform\":\"instagram\",\"scheduled_at\":\"${SCHEDULE_AT_FUTURE}\",\"assigned_user_id\":\"${D2_3_ASSIGNED_USER_ID}\"}"
    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
      report_ok "create schedule for cancel flow (HTTP ${REQ_CODE})"
    else
      report_fail "create schedule for cancel flow (expected 200/201)"
    fi
    CANCEL_SCHEDULE_ID="$(json_field "${REQ_BODY}" "schedule.id")"

    if [ -z "${CANCEL_SCHEDULE_ID}" ]; then
      REQ_CODE="parse"
      REQ_BODY="cancel schedule.id missing"
      report_fail "capture cancel schedule id"
    else
      perform_request -X POST "${BASE}/api/social/schedules/${CANCEL_SCHEDULE_ID}/cancel" \
        -H "Content-Type: application/json" \
        -H "${OWNER_COOKIE_HEADER}" \
        -d '{}'
      if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "schedule.status")" = "cancelled" ]; then
        report_ok "cancel schedule (status=cancelled)"
      else
        report_fail "cancel schedule (expected 200 + cancelled)"
      fi

      perform_request -X POST "${BASE}/api/social/schedules/${CANCEL_SCHEDULE_ID}/cancel" \
        -H "Content-Type: application/json" \
        -H "${OWNER_COOKIE_HEADER}" \
        -d '{}'
      if [ "${REQ_CODE}" = "200" ] && [ "$(json_field "${REQ_BODY}" "idempotent")" = "true" ]; then
        report_ok "cancel idempotent second call"
      else
        report_fail "cancel idempotent second call (expected 200 idempotent=true)"
      fi
    fi

    SCHEDULE_AT_PAST="$(date -u -v-26H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-26 hours' +%Y-%m-%dT%H:%M:%SZ)"
    perform_request -X POST "${BASE}/api/social/schedules" \
      -H "Content-Type: application/json" \
      -H "${OWNER_COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_3_BIZ_ID}\",\"draft_id\":\"${D2_3_DRAFT_ID}\",\"platform\":\"instagram\",\"scheduled_at\":\"${SCHEDULE_AT_PAST}\",\"assigned_user_id\":\"${D2_3_ASSIGNED_USER_ID}\"}"
    if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "201" ]; then
      report_ok "create schedule for missed flow (HTTP ${REQ_CODE})"
    else
      report_fail "create schedule for missed flow (expected 200/201)"
    fi
    MISSED_SCHEDULE_ID="$(json_field "${REQ_BODY}" "schedule.id")"

    RUN_BODY="{\"now\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
    HMAC_LINES="$(generate_hmac_headers "${RUN_BODY}" "/api/_internal/social/reminders/run" "POST")"
    HMAC_TS="$(printf '%s\n' "${HMAC_LINES}" | head -n 1)"
    HMAC_SIG="$(printf '%s\n' "${HMAC_LINES}" | tail -n 1)"

    perform_request -X POST "${BASE}/api/_internal/social/reminders/run" \
      -H "Content-Type: application/json" \
      -H "x-opin-timestamp: ${HMAC_TS}" \
      -H "x-opin-signature: ${HMAC_SIG}" \
      -d "${RUN_BODY}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "internal reminders run (HTTP 200)"
    else
      report_fail "internal reminders run (expected 200)"
    fi

    if [ -n "${MISSED_SCHEDULE_ID}" ]; then
      perform_request "${BASE}/api/social/schedules?biz_id=${D2_3_BIZ_ID}&limit=200" \
        -H "${OWNER_COOKIE_HEADER}"
      if [ "${REQ_CODE}" = "200" ]; then
        MISSED_STATUS="$(JSON_INPUT="${REQ_BODY}" TARGET_ID="${MISSED_SCHEDULE_ID}" node - <<'JS'
const body = process.env.JSON_INPUT || '{}';
const target = process.env.TARGET_ID || '';
try {
  const payload = JSON.parse(body);
  const item = Array.isArray(payload.items) ? payload.items.find((row) => row && row.id === target) : null;
  process.stdout.write(item && typeof item.status === 'string' ? item.status : '');
} catch {
  process.stdout.write('');
}
JS
)"
        if [ "${MISSED_STATUS}" = "missed" ]; then
          report_ok "missed state applied by runner"
        else
          REQ_CODE="assert"
          REQ_BODY="expected missed, got ${MISSED_STATUS:-<empty>}"
          report_fail "missed state applied by runner"
        fi
      else
        report_fail "list schedules after runner (expected 200)"
      fi
    fi

    perform_request "${BASE}/api/social/notifications?biz_id=${D2_3_BIZ_ID}&limit=10" \
      -H "${OWNER_COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      report_ok "notifications list (HTTP 200)"
    else
      report_fail "notifications list (expected 200)"
    fi
  fi
else
  report_ok "functional SKIP (defineix D2_3_OWNER_COOKIE, D2_3_BIZ_ID, D2_3_DRAFT_ID, D2_3_ASSIGNED_USER_ID i INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.3 reminders smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
