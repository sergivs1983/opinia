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

has_ai_key() {
  if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    return 0
  fi
  return 1
}

echo "Flow D1.2+ copy smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Auth guard"
perform_request -X POST "${BASE}/api/lito/copy/generate" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","recommendation_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/copy/generate sense sessió (401)"
else
  report_fail "POST /api/lito/copy/generate sense sessió (expected 401)"
fi

echo ""
echo "2) Functional opcional (sessió real)"
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

    if has_ai_key; then
      if [ "${REQ_CODE}" = "200" ]; then
        shortCopy="$(json_field "${REQ_BODY}" "copy.caption_short")"
        if [ -n "${shortCopy}" ]; then
          report_ok "generate funcional (200 + copy.caption_short)"
        else
          report_fail "generate funcional (copy.caption_short buit)"
        fi
      else
        report_fail "generate funcional (expected 200)"
      fi
    else
      if [ "${REQ_CODE}" = "503" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"ai_unavailable"'; then
        report_ok "generate sense AI key retorna 503 ai_unavailable"
      else
        report_fail "generate sense AI key (expected 503 ai_unavailable)"
      fi
    fi

    if has_ai_key; then
      before="$(json_field "${REQ_BODY}" "copy.caption_short")"
      perform_request -X POST "${BASE}/api/lito/copy/refine" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\",\"mode\":\"quick\",\"quick_mode\":\"shorter\"}"

      if [ "${REQ_CODE}" = "200" ]; then
        after="$(json_field "${REQ_BODY}" "copy.caption_short")"
        if [ -n "${after}" ]; then
          if [ "${before}" != "${after}" ]; then
            report_ok "refine funcional (200 + caption canviat)"
          else
            report_ok "refine funcional (200)"
          fi
        else
          report_fail "refine funcional (caption_short buit)"
        fi
      else
        report_fail "refine funcional (expected 200)"
      fi
    fi
  fi
else
  report_ok "functional SKIP (defineix FLOW_D12_SESSION_COOKIE + FLOW_D12_BIZ_ID + FLOW_D12_RECOMMENDATION_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.2+ copy smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
