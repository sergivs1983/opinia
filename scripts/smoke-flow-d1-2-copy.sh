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

is_inflight_error() {
  local body="$1"
  local err
  err="$(json_field "${body}" "error")"
  [ "${err}" = "in_flight" ] || [ "${err}" = "retry_later" ]
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
    if has_ai_key; then
      perform_request -X POST "${BASE}/api/lito/copy/generate" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\"}"
      gen_code_1="${REQ_CODE}"
      gen_body_1="${REQ_BODY}"

      perform_request -X POST "${BASE}/api/lito/copy/generate" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\"}"
      gen_code_2="${REQ_CODE}"
      gen_body_2="${REQ_BODY}"

      gen_ok_1=0
      gen_ok_2=0
      if [ "${gen_code_1}" = "200" ] || [ "${gen_code_1}" = "409" ]; then
        gen_ok_1=1
      fi
      if [ "${gen_code_2}" = "200" ] || [ "${gen_code_2}" = "409" ]; then
        gen_ok_2=1
      fi

      if [ "${gen_ok_1}" -eq 1 ] && [ "${gen_ok_2}" -eq 1 ]; then
        if [ "${gen_code_1}" = "409" ] && ! is_inflight_error "${gen_body_1}"; then
          REQ_CODE="${gen_code_1}"
          REQ_BODY="${gen_body_1}"
          report_fail "generate idempotent (1a crida 409 sense error in_flight/retry_later)"
        elif [ "${gen_code_2}" = "409" ] && ! is_inflight_error "${gen_body_2}"; then
          REQ_CODE="${gen_code_2}"
          REQ_BODY="${gen_body_2}"
          report_fail "generate idempotent (2a crida 409 sense error in_flight/retry_later)"
        elif [ "${gen_code_1}" != "200" ] && [ "${gen_code_2}" != "200" ]; then
          REQ_CODE="${gen_code_2}"
          REQ_BODY="${gen_body_2}"
          report_fail "generate idempotent (cal almenys una resposta 200)"
        elif [ "${gen_code_1}" = "200" ] && [ "${gen_code_2}" = "200" ]; then
          rem_1="$(json_field "${gen_body_1}" "quota.remaining")"
          rem_2="$(json_field "${gen_body_2}" "quota.remaining")"
          if [ -n "${rem_1}" ] && [ -n "${rem_2}" ] && [ "${rem_1}" != "${rem_2}" ]; then
            REQ_CODE="${gen_code_2}"
            REQ_BODY="${gen_body_2}"
            report_fail "generate idempotent (les dues 200 però quota.remaining difereix)"
          else
            report_ok "generate idempotent (doble crida retorna 200/409 sense duplicar quota)"
          fi
        else
          report_ok "generate idempotent (doble crida retorna 200/409)"
        fi
      else
        REQ_CODE="${gen_code_2}"
        REQ_BODY="${gen_body_2}"
        report_fail "generate idempotent (esperat 200 o 409 a les dues crides)"
      fi

      if [ "${gen_code_1}" = "200" ]; then
        before="$(json_field "${gen_body_1}" "copy.caption_short")"
      elif [ "${gen_code_2}" = "200" ]; then
        before="$(json_field "${gen_body_2}" "copy.caption_short")"
      else
        before=""
      fi
    else
      perform_request -X POST "${BASE}/api/lito/copy/generate" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\"}"
      if [ "${REQ_CODE}" = "503" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"ai_unavailable"'; then
        report_ok "generate sense AI key retorna 503 ai_unavailable"
      else
        report_fail "generate sense AI key (expected 503 ai_unavailable)"
      fi
    fi

    if has_ai_key; then
      if [ -z "${before}" ]; then
        REQ_CODE="${gen_code_2}"
        REQ_BODY="${gen_body_2}"
        report_fail "generate funcional (copy.caption_short buit)"
      fi

      perform_request -X POST "${BASE}/api/lito/copy/refine" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\",\"mode\":\"quick\",\"quick_mode\":\"shorter\"}"
      ref_code_1="${REQ_CODE}"
      ref_body_1="${REQ_BODY}"

      perform_request -X POST "${BASE}/api/lito/copy/refine" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${FLOW_D12_BIZ_ID}\",\"recommendation_id\":\"${FLOW_D12_RECOMMENDATION_ID}\",\"mode\":\"quick\",\"quick_mode\":\"shorter\"}"
      ref_code_2="${REQ_CODE}"
      ref_body_2="${REQ_BODY}"

      ref_ok_1=0
      ref_ok_2=0
      if [ "${ref_code_1}" = "200" ] || [ "${ref_code_1}" = "409" ]; then
        ref_ok_1=1
      fi
      if [ "${ref_code_2}" = "200" ] || [ "${ref_code_2}" = "409" ]; then
        ref_ok_2=1
      fi

      if [ "${ref_ok_1}" -eq 1 ] && [ "${ref_ok_2}" -eq 1 ]; then
        if [ "${ref_code_1}" = "409" ] && ! is_inflight_error "${ref_body_1}"; then
          REQ_CODE="${ref_code_1}"
          REQ_BODY="${ref_body_1}"
          report_fail "refine idempotent (1a crida 409 sense error in_flight/retry_later)"
        elif [ "${ref_code_2}" = "409" ] && ! is_inflight_error "${ref_body_2}"; then
          REQ_CODE="${ref_code_2}"
          REQ_BODY="${ref_body_2}"
          report_fail "refine idempotent (2a crida 409 sense error in_flight/retry_later)"
        elif [ "${ref_code_1}" != "200" ] && [ "${ref_code_2}" != "200" ]; then
          REQ_CODE="${ref_code_2}"
          REQ_BODY="${ref_body_2}"
          report_fail "refine idempotent (cal almenys una resposta 200)"
        elif [ "${ref_code_1}" = "200" ] && [ "${ref_code_2}" = "200" ]; then
          rem_ref_1="$(json_field "${ref_body_1}" "quota.remaining")"
          rem_ref_2="$(json_field "${ref_body_2}" "quota.remaining")"
          if [ -n "${rem_ref_1}" ] && [ -n "${rem_ref_2}" ] && [ "${rem_ref_1}" != "${rem_ref_2}" ]; then
            REQ_CODE="${ref_code_2}"
            REQ_BODY="${ref_body_2}"
            report_fail "refine idempotent (les dues 200 però quota.remaining difereix)"
          else
            report_ok "refine idempotent (doble crida retorna 200/409 sense duplicar quota)"
          fi
        else
          report_ok "refine idempotent (doble crida retorna 200/409)"
        fi
      else
        REQ_CODE="${ref_code_2}"
        REQ_BODY="${ref_body_2}"
        report_fail "refine idempotent (esperat 200 o 409 a les dues crides)"
      fi

      if [ "${ref_code_1}" = "200" ]; then
        after="$(json_field "${ref_body_1}" "copy.caption_short")"
      elif [ "${ref_code_2}" = "200" ]; then
        after="$(json_field "${ref_body_2}" "copy.caption_short")"
      else
        after=""
      fi

      if [ -n "${after}" ]; then
        if [ -n "${before}" ] && [ "${before}" != "${after}" ]; then
          report_ok "refine funcional (200 + caption canviat)"
        else
          report_ok "refine funcional (200)"
        fi
      else
        REQ_CODE="${ref_code_2}"
        REQ_BODY="${ref_body_2}"
        report_fail "refine funcional (caption_short buit)"
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
