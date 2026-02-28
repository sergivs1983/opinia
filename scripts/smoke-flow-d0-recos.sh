#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"

PASS="PASS"
FAIL="FAIL"
GREEN="$(printf '\033[32m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 20 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 240)"
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

extract_json_field() {
  local json="$1"
  local expr="$2"
  JSON_INPUT="$json" JSON_EXPR="$expr" node - <<'JS'
const input = process.env.JSON_INPUT || '';
const expr = process.env.JSON_EXPR || '';
try {
  const data = JSON.parse(input);
  const value = expr.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), data);
  if (value === undefined || value === null) {
    process.stdout.write('');
    process.exit(0);
  }
  if (typeof value === 'object') {
    process.stdout.write(JSON.stringify(value));
    process.exit(0);
  }
  process.stdout.write(String(value));
} catch {
  process.stdout.write('');
}
JS
}

echo "Flow D0 smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

check_status "Health check localhost" "200" "${BASE}/"

echo ""
echo "1) Contracte: biz_id obligatori"
check_status "GET /api/recommendations/weekly sense biz_id" "400" "${BASE}/api/recommendations/weekly"

echo ""
echo "2) Contracte: auth obligatòria"
check_status "GET /api/recommendations/weekly sense sessió" "401" "${BASE}/api/recommendations/weekly?biz_id=00000000-0000-0000-0000-000000000000"

echo ""
echo "3) Contracte feedback sense sessió"
check_status "POST /api/recommendations/:id/feedback sense sessió" "401" \
  -X POST "${BASE}/api/recommendations/00000000-0000-0000-0000-000000000000/feedback" \
  -H "Content-Type: application/json" \
  -d '{"status":"dismissed"}'

echo ""
echo "4) Funcional (opcional, només amb creds de sessió)"
if [ -n "${FLOW_D0_SESSION_COOKIE:-}" ] && [ -n "${FLOW_D0_BIZ_ID:-}" ]; then
  perform_request -X GET "${BASE}/api/recommendations/weekly?biz_id=${FLOW_D0_BIZ_ID}" \
    -H "Cookie: ${FLOW_D0_SESSION_COOKIE}"
  if [ "${REQ_CODE}" != "200" ]; then
    report_fail "weekly funcional inicial (expected 200)"
  else
    items_count="$(extract_json_field "${REQ_BODY}" "items.length")"
    if [ "${items_count}" = "3" ]; then
      report_ok "weekly funcional inicial retorna 3"
      first_id="$(extract_json_field "${REQ_BODY}" "items.0.id")"
      if [ -n "${first_id}" ]; then
        perform_request -X POST "${BASE}/api/recommendations/${first_id}/feedback" \
          -H "Content-Type: application/json" \
          -H "Cookie: ${FLOW_D0_SESSION_COOKIE}" \
          -d '{"status":"accepted"}'
        if [ "${REQ_CODE}" != "200" ]; then
          report_fail "feedback accepted funcional (expected 200)"
        else
          replaced="$(extract_json_field "${REQ_BODY}" "replaced")"
          if [ "${replaced}" != "true" ]; then
            report_fail "feedback accepted funcional (expected replaced=true)"
          else
            report_ok "feedback accepted funcional (HTTP 200, replaced=true)"
          fi
          perform_request -X GET "${BASE}/api/recommendations/weekly?biz_id=${FLOW_D0_BIZ_ID}" \
            -H "Cookie: ${FLOW_D0_SESSION_COOKIE}"
          if [ "${REQ_CODE}" != "200" ]; then
            report_fail "weekly funcional post-accepted (expected 200)"
          else
            items_count_after="$(extract_json_field "${REQ_BODY}" "items.length")"
            if [ "${items_count_after}" = "3" ]; then
              ids_after="$(extract_json_field "${REQ_BODY}" "items.0.id"),$(extract_json_field "${REQ_BODY}" "items.1.id"),$(extract_json_field "${REQ_BODY}" "items.2.id")"
              if printf '%s' "${ids_after}" | grep -q "${first_id}"; then
                report_fail "weekly funcional post-accepted (id anterior encara present)"
              else
                report_ok "weekly funcional post-accepted manté 3 i reemplaça ID"
              fi
            else
              report_fail "weekly funcional post-accepted (expected 3 items)"
            fi
          fi
        fi
      else
        report_fail "weekly funcional sense id de recomanació inicial"
      fi
    else
      report_fail "weekly funcional inicial (expected 3 items)"
    fi
  fi
else
  report_ok "funcional opcional SKIP (defineix FLOW_D0_SESSION_COOKIE + FLOW_D0_BIZ_ID)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All Flow D0 smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
