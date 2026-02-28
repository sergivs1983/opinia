#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"

if ! bash -n "$0" >/dev/null 2>&1; then
  echo "FAIL: sintaxi bash invàlida a $0"
  exit 1
fi

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
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 25 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 260)"
  FAILURES=$((FAILURES + 1))
}

mask_cookie() {
  local value="$1"
  local len="${#value}"
  if [ "$len" -le 12 ]; then
    printf '(masked,len=%s)\n' "$len"
    return
  fi

  local prefix="${value:0:6}"
  local suffix="${value:$((len - 6)):6}"
  printf '%s…%s (len=%s)\n' "$prefix" "$suffix" "$len"
}

weekly_summary_from_stdin() {
  node - <<'JS'
const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8');
try {
  const payload = JSON.parse(raw);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const ids = items
    .map((item) => (item && typeof item.id === 'string' ? item.id : ''))
    .filter(Boolean);
  process.stdout.write(`${ids.length}\n${ids.join(',')}\n`);
} catch {
  process.stdout.write('-1\n\n');
}
JS
}

contains_id_in_csv() {
  local csv="$1"
  local needle="$2"
  local old_ifs="$IFS"
  IFS=','
  for item in $csv; do
    if [ "$item" = "$needle" ]; then
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
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
  process.stdout.write(String(value));
} catch {
  process.stdout.write('');
}
JS
}

echo "Flow D0 functional smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

# 1) Preflight /login 200
perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ]; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
fi

# 2) Required env vars
if [ -z "${FLOW_D0_BIZ_ID:-}" ] || [ -z "${FLOW_D0_SESSION_COOKIE:-}" ]; then
  echo ""
  echo "ERROR: falten variables requerides."
  if [ -z "${FLOW_D0_BIZ_ID:-}" ]; then
    echo " - FLOW_D0_BIZ_ID absent"
  fi
  if [ -z "${FLOW_D0_SESSION_COOKIE:-}" ]; then
    echo " - FLOW_D0_SESSION_COOKIE absent"
  fi
  echo "Exemple:"
  echo "FLOW_D0_BIZ_ID=<uuid> FLOW_D0_SESSION_COOKIE='sb-...=...; ...' $0 ${BASE}"
  exit 1
fi

echo "  [INFO] FLOW_D0_BIZ_ID present"
echo "  [INFO] FLOW_D0_SESSION_COOKIE=$(mask_cookie "${FLOW_D0_SESSION_COOKIE}")"

# 3) GET weekly (initial)
perform_request -X GET "${BASE}/api/recommendations/weekly?biz_id=${FLOW_D0_BIZ_ID}" \
  -H "Cookie: ${FLOW_D0_SESSION_COOKIE}"

if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET weekly inicial (expected 200)"
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi

summary_initial="$(printf '%s' "${REQ_BODY}" | weekly_summary_from_stdin)"
initial_count="$(printf '%s\n' "${summary_initial}" | sed -n '1p')"
initial_ids_csv="$(printf '%s\n' "${summary_initial}" | sed -n '2p')"
initial_first_id="$(printf '%s' "${initial_ids_csv}" | awk -F',' '{print $1}')"

if [ "${initial_count}" = "3" ] && [ -n "${initial_first_id}" ]; then
  report_ok "GET weekly inicial retorna 3 recomanacions"
else
  REQ_BODY="count=${initial_count} ids=${initial_ids_csv}"
  report_fail "GET weekly inicial (expected 3 ids vàlids)"
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi

# 4) POST accepted (replace)
perform_request -X POST "${BASE}/api/recommendations/${initial_first_id}/feedback" \
  -H "Cookie: ${FLOW_D0_SESSION_COOKIE}" \
  -H "Content-Type: application/json" \
  -d '{"status":"accepted"}'

if [ "${REQ_CODE}" = "200" ]; then
  replaced="$(extract_json_field "${REQ_BODY}" "replaced")"
  if [ "${replaced}" = "true" ]; then
    report_ok "POST feedback accepted (HTTP 200, replaced=true)"
  else
    REQ_BODY="replaced=${replaced}"
    report_fail "POST feedback accepted (expected replaced=true)"
  fi
else
  report_fail "POST feedback accepted (expected 200)"
fi

# 5) GET weekly (after accepted)
perform_request -X GET "${BASE}/api/recommendations/weekly?biz_id=${FLOW_D0_BIZ_ID}" \
  -H "Cookie: ${FLOW_D0_SESSION_COOKIE}"

if [ "${REQ_CODE}" != "200" ]; then
  report_fail "GET weekly post-accepted (expected 200)"
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi

summary_after="$(printf '%s' "${REQ_BODY}" | weekly_summary_from_stdin)"
after_count="$(printf '%s\n' "${summary_after}" | sed -n '1p')"
after_ids_csv="$(printf '%s\n' "${summary_after}" | sed -n '2p')"

if [ "${after_count}" = "3" ]; then
  report_ok "GET weekly post-accepted manté 3 recomanacions"
else
  REQ_BODY="count=${after_count} ids=${after_ids_csv}"
  report_fail "GET weekly post-accepted (expected 3)"
fi

if contains_id_in_csv "${after_ids_csv}" "${initial_first_id}"; then
  REQ_BODY="accepted_id=${initial_first_id} after_ids=${after_ids_csv}"
  report_fail "replace real (accepted id encara present)"
else
  report_ok "replace real (accepted id substituït)"
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}Flow D0 functional smoke passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
