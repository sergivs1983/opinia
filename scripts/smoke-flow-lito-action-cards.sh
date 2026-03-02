#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
LITO_ACTION_CARDS_COOKIE="${LITO_ACTION_CARDS_COOKIE:-}"
LITO_ACTION_CARDS_BIZ_ID="${LITO_ACTION_CARDS_BIZ_ID:-}"

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
  if [ -z "$raw" ]; then
    return 1
  fi
  case "$raw" in
    *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
  esac
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "$raw" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
  else
    payload="$raw"
  fi
  payload="$(trim_spaces "$payload")"
  if [ -z "$payload" ] || ! printf '%s' "$payload" | grep -q '='; then
    return 1
  fi
  printf 'Cookie: %s' "$payload"
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
  echo "         BODY=$(printf '%s' "$REQ_BODY" | head -c 300)"
  FAILURES=$((FAILURES + 1))
}

validate_shape() {
  local json="$1"
  JSON_INPUT="$json" node - <<'JS'
const input = process.env.JSON_INPUT || '';
try {
  const payload = JSON.parse(input);
  const requiredTop = ['ok', 'generated_at', 'mode', 'cards', 'queue_count'];
  for (const key of requiredTop) {
    if (!(key in payload)) {
      console.error(`missing_top_key:${key}`);
      process.exit(1);
    }
  }
  if (!Array.isArray(payload.cards)) {
    console.error('cards_not_array');
    process.exit(1);
  }
  const card = payload.cards[0];
  if (card) {
    const requiredCard = ['id', 'type', 'priority', 'severity', 'title', 'subtitle', 'primary_cta', 'refs'];
    for (const key of requiredCard) {
      if (!(key in card)) {
        console.error(`missing_card_key:${key}`);
        process.exit(1);
      }
    }
  }
  process.exit(0);
} catch (error) {
  console.error('invalid_json');
  process.exit(1);
}
JS
}

echo "Flow LITO Action Cards smoke — ${BASE}"
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
perform_request "${BASE}/api/lito/action-cards?biz_id=00000000-0000-0000-0000-000000000000"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "GET /api/lito/action-cards sense sessió (401)"
else
  report_fail "GET /api/lito/action-cards sense sessió (expected 401)"
fi

echo ""
echo "2) Functional shape check (opcional)"
if [ -n "${LITO_ACTION_CARDS_COOKIE}" ] && [ -n "${LITO_ACTION_CARDS_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_ACTION_CARDS_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_ACTION_CARDS_COOKIE invàlida"
    report_fail "cookie format"
  else
    perform_request "${BASE}/api/lito/action-cards?biz_id=${LITO_ACTION_CARDS_BIZ_ID}" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      if validate_shape "${REQ_BODY}"; then
        report_ok "GET /api/lito/action-cards amb sessió (shape OK)"
      else
        report_fail "GET /api/lito/action-cards shape (expected keys)"
      fi
    else
      report_fail "GET /api/lito/action-cards amb sessió (expected 200)"
    fi
  fi
else
  report_ok "SKIP functional (defineix LITO_ACTION_CARDS_COOKIE i LITO_ACTION_CARDS_BIZ_ID)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "Result: PASS"
  exit 0
fi

echo "Result: FAIL (${FAILURES})"
exit 1
