#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_6_SESSION_COOKIE="${D2_6_SESSION_COOKIE:-}"
D2_6_ORG_ID="${D2_6_ORG_ID:-}"
D2_6_BIZ_ID="${D2_6_BIZ_ID:-}"

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
  local raw payload
  raw="$(trim_spaces "$1")"
  if [ -z "${raw}" ]; then
    return 1
  fi
  case "${raw}" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
  else
    payload="${raw}"
  fi
  payload="$(trim_spaces "${payload}")"
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then
    return 1
  fi
  printf 'Cookie: %s' "${payload}"
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "${resp}" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "${resp}" | sed '$d')"
}

wait_for_login_ready() {
  local tries=35
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "${code}" = "200" ] || [ "${code}" = "307" ]; then
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
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 320)"
  FAILURES=$((FAILURES + 1))
}

validate_shape() {
  JSON_INPUT="$1" node - <<'JS'
const input = process.env.JSON_INPUT || '{}';
try {
  const data = JSON.parse(input);
  const ok =
    data &&
    typeof data === 'object' &&
    data.ok === true &&
    typeof data.org_rollup === 'object' &&
    Array.isArray(data.locals) &&
    typeof data.rankings === 'object' &&
    Array.isArray(data.rankings.top) &&
    Array.isArray(data.rankings.bottom);
  process.stdout.write(ok ? 'ok' : 'bad');
} catch {
  process.stdout.write('bad');
}
JS
}

echo "Flow D2.6 enterprise smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${LOGIN_CODE})"
else
  REQ_CODE="${LOGIN_CODE:-000}"
  REQ_BODY=""
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request "${BASE}/api/enterprise/overview?org_id=00000000-0000-0000-0000-000000000000&range=30&channel=all"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/enterprise/overview sense sessió (401)"
else
  report_fail "GET /api/enterprise/overview sense sessió (expected 401)"
fi

echo ""
echo "2) Functional (opcional amb sessió)"
if [ -n "${D2_6_SESSION_COOKIE}" ] && [ -n "${D2_6_ORG_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${D2_6_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_6_SESSION_COOKIE invàlida"
    report_fail "cookie format"
  else
    report_ok "session cookie validada (redacted)"

    perform_request "${BASE}/api/enterprise/overview?org_id=${D2_6_ORG_ID}&range=30&channel=all" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      SHAPE="$(validate_shape "${REQ_BODY}")"
      if [ "${SHAPE}" = "ok" ]; then
        report_ok "overview org shape (HTTP 200)"
      else
        report_fail "overview org shape (missing fields)"
      fi
    else
      report_fail "overview org (expected 200)"
    fi

    if [ -n "${D2_6_BIZ_ID}" ]; then
      perform_request "${BASE}/api/enterprise/overview?org_id=${D2_6_ORG_ID}&biz_id=${D2_6_BIZ_ID}&range=30&channel=instagram" \
        -H "${COOKIE_HEADER}"
      if [ "${REQ_CODE}" = "200" ]; then
        report_ok "overview biz filter (HTTP 200)"
      else
        report_fail "overview biz filter (expected 200)"
      fi
    else
      report_ok "biz filter SKIP (defineix D2_6_BIZ_ID)"
    fi
  fi
else
  report_ok "functional SKIP (defineix D2_6_SESSION_COOKIE + D2_6_ORG_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.6 enterprise smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
