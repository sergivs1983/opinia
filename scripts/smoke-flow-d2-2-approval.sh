#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_2_STAFF_COOKIE="${D2_2_STAFF_COOKIE:-}"
D2_2_MANAGER_COOKIE="${D2_2_MANAGER_COOKIE:-}"
D2_2_BIZ_ID="${D2_2_BIZ_ID:-}"
D2_2_ORG_ID="${D2_2_ORG_ID:-}"

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

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1"
  local expected="$2"
  shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    report_ok "${label} (HTTP ${REQ_CODE})"
  else
    report_fail "${label} (expected ${expected})"
  fi
}

echo "Flow D2.2 approval smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${LOGIN_CODE})"
else
  REQ_CODE="${LOGIN_CODE}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200)"
fi

echo ""
echo "1) Auth guard"
check_status "GET /api/social/drafts/inbox sense sessió" "401" \
  "${BASE}/api/social/drafts/inbox?org_id=00000000-0000-0000-0000-000000000000&status=pending&limit=3"

echo ""
echo "2) Functional transitions (opcional)"
if [ -n "${D2_2_STAFF_COOKIE}" ] && [ -n "${D2_2_MANAGER_COOKIE}" ] && [ -n "${D2_2_BIZ_ID}" ] && [ -n "${D2_2_ORG_ID}" ]; then
  STAFF_COOKIE_HEADER="$(normalize_cookie_header "${D2_2_STAFF_COOKIE}" || true)"
  MANAGER_COOKIE_HEADER="$(normalize_cookie_header "${D2_2_MANAGER_COOKIE}" || true)"
  if [ -z "${STAFF_COOKIE_HEADER}" ] || [ -z "${MANAGER_COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_2_STAFF_COOKIE o D2_2_MANAGER_COOKIE invàlida"
    report_fail "cookie format"
  else
    report_ok "cookies validades (redacted)"

    perform_request -X POST "${BASE}/api/social/drafts" \
      -H "Content-Type: application/json" \
      -H "${STAFF_COOKIE_HEADER}" \
      -d "{\"biz_id\":\"${D2_2_BIZ_ID}\",\"channel\":\"instagram\",\"format\":\"post\",\"title\":\"Smoke D2.2\",\"copy_short\":\"copy curt\",\"copy_long\":\"copy llarg smoke\",\"hashtags\":[\"#opinia\"],\"source\":\"lito\"}"
    if [ "${REQ_CODE}" = "201" ] || [ "${REQ_CODE}" = "200" ]; then
      report_ok "create draft (HTTP ${REQ_CODE})"
    else
      report_fail "create draft (expected 201/200)"
    fi

    DRAFT_ID="$(json_field "${REQ_BODY}" "draft.id")"
    if [ -z "${DRAFT_ID}" ]; then
      REQ_CODE="parse"
      REQ_BODY="draft.id missing"
      report_fail "draft_id captured"
    else
      report_ok "draft_id captured"

      perform_request -X POST "${BASE}/api/social/drafts/${DRAFT_ID}/submit" \
        -H "Content-Type: application/json" \
        -H "${STAFF_COOKIE_HEADER}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "submit draft (HTTP 200)"
      else
        report_fail "submit draft (expected 200)"
      fi

      perform_request "${BASE}/api/social/drafts/inbox?org_id=${D2_2_ORG_ID}&biz_id=${D2_2_BIZ_ID}&status=pending&limit=5" \
        -H "${MANAGER_COOKIE_HEADER}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "manager inbox list (HTTP 200)"
      else
        report_fail "manager inbox list (expected 200)"
      fi

      perform_request -X POST "${BASE}/api/social/drafts/${DRAFT_ID}/approve" \
        -H "Content-Type: application/json" \
        -H "${MANAGER_COOKIE_HEADER}" \
        -d '{"copy_long":"copy llarg aprovat"}'
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "approve draft (HTTP 200)"
      else
        report_fail "approve draft (expected 200)"
      fi
    fi
  fi
else
  report_ok "functional transitions SKIP (defineix D2_2_STAFF_COOKIE, D2_2_MANAGER_COOKIE, D2_2_BIZ_ID, D2_2_ORG_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.2 approval smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
