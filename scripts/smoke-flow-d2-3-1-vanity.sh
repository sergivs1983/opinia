#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
D2_3_1_SESSION_COOKIE="${D2_3_1_SESSION_COOKIE:-}"
D2_3_1_BIZ_ID="${D2_3_1_BIZ_ID:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw payload normalized
  raw="$(trim_spaces "$1")"
  if [ -z "$raw" ]; then
    echo ""
    return 1
  fi
  case "$raw" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "$raw" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "$payload")"
    normalized="Cookie: $payload"
  else
    payload="$raw"
    normalized="Cookie: $payload"
  fi
  if [ -z "$payload" ] || ! printf '%s' "$payload" | grep -q '='; then
    return 1
  fi
  printf '%s' "$normalized"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

wait_for_login_ready() {
  local tries=30
  local code=""
  while [ "$tries" -gt 0 ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE}/login" 2>/dev/null || true)"
    if [ "$code" = "200" ] || [ "$code" = "307" ]; then
      REQ_CODE="$code"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  REQ_CODE="${code:-000}"
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
const input = process.env.JSON_INPUT || '';
try {
  const j = JSON.parse(input);
  const ok =
    j &&
    typeof j === 'object' &&
    typeof j.published_count === 'number' &&
    typeof j.goal === 'number' &&
    typeof j.remaining === 'number' &&
    typeof j.is_completed === 'boolean' &&
    typeof j.week_start_utc === 'string' &&
    typeof j.week_end_utc === 'string';
  process.stdout.write(ok ? 'ok' : 'bad');
} catch {
  process.stdout.write('bad');
}
JS
}

echo "Flow D2.3.1 vanity smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

if wait_for_login_ready; then
  report_ok "Preflight /login (HTTP ${REQ_CODE})"
else
  REQ_BODY=""
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request "${BASE}/api/social/stats/weekly"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/social/stats/weekly sense sessió (401)"
else
  report_fail "GET /api/social/stats/weekly sense sessió (expected 401)"
fi

echo ""
echo "2) Functional (opcional amb sessió)"
if [ -n "${D2_3_1_SESSION_COOKIE}" ] && [ -n "${D2_3_1_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${D2_3_1_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="D2_3_1_SESSION_COOKIE invàlida"
    report_fail "cookie format"
  else
    perform_request "${BASE}/api/social/stats/weekly?biz_id=${D2_3_1_BIZ_ID}" -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      shape="$(validate_shape "${REQ_BODY}")"
      if [ "${shape}" = "ok" ]; then
        report_ok "weekly stats shape (HTTP 200)"
      else
        report_fail "weekly stats shape (missing fields)"
      fi
    else
      report_fail "weekly stats funcional (expected 200)"
    fi
  fi
else
  report_ok "functional SKIP (defineix D2_3_1_SESSION_COOKIE + D2_3_1_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D2.3.1 vanity smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
