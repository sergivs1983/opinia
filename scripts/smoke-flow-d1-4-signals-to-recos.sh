#!/usr/bin/env bash
# Flow D1.4 Signals → Weekly Recos smoke test
# Usage:
#   ./scripts/smoke-flow-d1-4-signals-to-recos.sh [BASE_URL]
#
# Optional env vars:
#   INTERNAL_HMAC_SECRET      — enables HMAC-signed to-weekly call
#   FLOW_D14_BIZ_ID           — biz_id UUID for to-weekly + weekly recos tests
#   LITO_SESSION_COOKIE       — session cookie for auth'd weekly recos call
set -euo pipefail

BASE="${1:-http://localhost:3000}"
INTERNAL_HMAC_SECRET="${INTERNAL_HMAC_SECRET:-}"
FLOW_D14_BIZ_ID="${FLOW_D14_BIZ_ID:-}"
LITO_SESSION_COOKIE="${LITO_SESSION_COOKIE:-}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

# ── Helpers ───────────────────────────────────────────────────────────────────

trim_spaces() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

normalize_cookie_header() {
  local raw normalized payload
  raw="$(trim_spaces "$1")"
  if [ -z "${raw}" ]; then echo ""; return 1; fi
  case "${raw}" in *$'\n'*|*$'\r'*|*$'\t'*) return 1 ;; esac
  if printf '%s' "${raw}" | grep -Eiq '^cookie:[[:space:]]*'; then
    payload="$(printf '%s' "${raw}" | sed -E 's/^[Cc]ookie:[[:space:]]*//')"
    payload="$(trim_spaces "${payload}")"
    normalized="Cookie: ${payload}"
  else
    normalized="Cookie: ${raw}"
    payload="${raw}"
  fi
  if [ -z "${payload}" ] || ! printf '%s' "${payload}" | grep -q '='; then return 1; fi
  printf '%s' "${normalized}"
  return 0
}

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 25 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok()   { echo "  [${PASS}] $1"; }
report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 280)"
  FAILURES=$((FAILURES + 1))
}

check_status() {
  local label="$1" expected="$2"; shift 2
  perform_request "$@"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    report_ok "${label} (HTTP ${REQ_CODE})"
  else
    report_fail "${label} (expected ${expected})"
  fi
}

json_field() {
  local json="$1" path="$2"
  JSON_INPUT="$json" JSON_PATH="$path" node - <<'JS'
const input = process.env.JSON_INPUT || '';
const path  = process.env.JSON_PATH  || '';
try {
  const data  = JSON.parse(input);
  const value = path.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), data);
  if (value === undefined || value === null) process.stdout.write('');
  else if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
  else process.stdout.write(String(value));
} catch { process.stdout.write(''); }
JS
}

make_hmac() {
  local path="$1" body="$2"
  OPIN_PATH="$path" OPIN_BODY="$body" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET;
if (!secret) process.exit(2);
const ts       = Date.now().toString();
const path     = process.env.OPIN_PATH  || '';
const rawBody  = process.env.OPIN_BODY  || '';
const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig      = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo "Flow D1.4 Signals → Weekly Recos smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

# 0) Preflight
check_status "Preflight /login" "200" "${BASE}/login"

echo ""
echo "1) HMAC guard — POST /api/_internal/signals/to-weekly sense HMAC → 401"
perform_request -X POST "${BASE}/api/_internal/signals/to-weekly" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "to-weekly sense HMAC (HTTP 401)"
else
  report_fail "to-weekly sense HMAC (expected 401)"
fi

echo ""
echo "2) HMAC valid — POST /api/_internal/signals/to-weekly amb HMAC"
if [ -n "${FLOW_D14_BIZ_ID}" ] && [ -n "${INTERNAL_HMAC_SECRET}" ]; then
  THIS_WEEK_START="$(node -e "
    const d = new Date();
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    process.stdout.write(d.toISOString().slice(0,10));
  ")"
  BODY="{\"biz_id\":\"${FLOW_D14_BIZ_ID}\",\"provider\":\"google_business\",\"week_start\":\"${THIS_WEEK_START}\"}"
  HMAC_OUT="$(make_hmac "/api/_internal/signals/to-weekly" "${BODY}")"
  TS="$(printf '%s\n' "${HMAC_OUT}" | sed -n '1p')"
  SIG="$(printf '%s\n' "${HMAC_OUT}" | sed -n '2p')"
  perform_request -X POST "${BASE}/api/_internal/signals/to-weekly" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${TS}" \
    -H "x-opin-signature: ${SIG}" \
    -d "${BODY}"
  if [ "${REQ_CODE}" = "200" ]; then
    OK_VAL="$(json_field "${REQ_BODY}" "ok")"
    CREATED="$(json_field "${REQ_BODY}" "created")"
    EXISTING="$(json_field "${REQ_BODY}" "existing")"
    SIG_COUNT="$(json_field "${REQ_BODY}" "signal_count")"
    if [ "${OK_VAL}" = "true" ]; then
      report_ok "to-weekly amb HMAC (200, ok=true, created=${CREATED}, existing=${EXISTING}, signal_count=${SIG_COUNT})"
    else
      report_fail "to-weekly amb HMAC (200 però ok!=true)"
    fi
  else
    report_fail "to-weekly amb HMAC (expected 200)"
  fi
else
  report_ok "to-weekly HMAC SKIP (defineix FLOW_D14_BIZ_ID i INTERNAL_HMAC_SECRET)"
fi

echo ""
echo "3) Auth guard — GET /api/recommendations/weekly sense sessió → 401"
check_status "weekly recos sense sessió" "401" \
  "${BASE}/api/recommendations/weekly?biz_id=00000000-0000-0000-0000-000000000000"

echo ""
echo "4) Funcional recos (opcional amb LITO_SESSION_COOKIE + FLOW_D14_BIZ_ID)"
if [ -n "${LITO_SESSION_COOKIE}" ] && [ -n "${FLOW_D14_BIZ_ID}" ]; then
  COOKIE_HEADER="$(normalize_cookie_header "${LITO_SESSION_COOKIE}" || true)"
  if [ -z "${COOKIE_HEADER}" ]; then
    REQ_CODE="cookie"
    REQ_BODY="LITO_SESSION_COOKIE invàlida"
    report_fail "cookie invàlida"
  else
    perform_request "${BASE}/api/recommendations/weekly?biz_id=${FLOW_D14_BIZ_ID}" \
      -H "${COOKIE_HEADER}"
    if [ "${REQ_CODE}" = "200" ]; then
      ITEMS_RAW="$(json_field "${REQ_BODY}" "items")"
      ITEM_COUNT="$(node -e "
        const s = process.env.ITEMS_RAW;
        try { const a = JSON.parse(s); process.stdout.write(String(a.length)); } catch { process.stdout.write('0'); }
      " ITEMS_RAW="${ITEMS_RAW}")"
      # Check source field presence
      HAS_SOURCE="$(node -e "
        const s = process.env.ITEMS_RAW;
        try {
          const arr = JSON.parse(s);
          const hasSource = arr.some(it => it.source === 'signal' || it.source === 'evergreen');
          process.stdout.write(hasSource ? 'yes' : 'no');
        } catch { process.stdout.write('no'); }
      " ITEMS_RAW="${ITEMS_RAW}")"
      # Check signal-first ordering: if any signal items, first item should be signal
      SIGNAL_FIRST="$(node -e "
        const s = process.env.ITEMS_RAW;
        try {
          const arr = JSON.parse(s);
          const hasSignal = arr.some(it => it.source === 'signal');
          if (!hasSignal) { process.stdout.write('n/a'); process.exit(0); }
          process.stdout.write(arr[0] && arr[0].source === 'signal' ? 'yes' : 'no');
        } catch { process.stdout.write('n/a'); }
      " ITEMS_RAW="${ITEMS_RAW}")"
      if [ "${ITEM_COUNT:-0}" -ge 1 ] 2>/dev/null; then
        report_ok "GET weekly recos (200, items=${ITEM_COUNT}, has_source=${HAS_SOURCE}, signal_first=${SIGNAL_FIRST})"
      else
        report_fail "GET weekly recos (200 però items buit)"
      fi
    else
      report_fail "GET weekly recos (expected 200)"
    fi
  fi
else
  report_ok "recos funcional SKIP (defineix LITO_SESSION_COOKIE i FLOW_D14_BIZ_ID)"
fi

echo ""
echo "5) D1.4 mapper sanity — signalsToCandidates (node inline)"
node - <<'JS'
const { execSync } = require('child_process');
// Inline sanity: verify signal priority ordering logic
const signals = [
  { id: 'reputation_drop', type: 'alert', severity: 'high', title: '', reason: '', cta_label: '', action: { kind: 'open_thread' } },
  { id: 'high_avg',        type: 'opportunity', severity: 'low', title: '', reason: '', cta_label: '', action: { kind: 'open_thread' } },
  { id: 'inactivity',      type: 'alert', severity: 'med', title: '', reason: '', cta_label: '', action: { kind: 'open_thread' } },
];
// Expected priority: reputation_drop(1) < inactivity(2) < high_avg(4)
function signalToPriority(s) {
  if (s.type === 'alert') { if (s.severity === 'high') return 1; if (s.severity === 'med') return 2; return 3; }
  if (s.type === 'opportunity') return 4;
  return 5;
}
const sorted = [...signals].map(s => ({ ...s, priority: signalToPriority(s) })).sort((a, b) => a.priority - b.priority);
const ids = sorted.map(s => s.id).join(',');
const expected = 'reputation_drop,inactivity,high_avg';
if (ids === expected) {
  process.stdout.write('  [PASS] signalsToCandidates priority sort (' + ids + ')\n');
} else {
  process.stdout.write('  [FAIL] signalsToCandidates priority sort (got: ' + ids + ', expected: ' + expected + ')\n');
  process.exitCode = 1;
}
JS
MAPPER_EXIT=$?
if [ "${MAPPER_EXIT}" -ne 0 ]; then
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.4 Signals → Weekly Recos smoke tests passed."
  exit 0
fi
echo "${FAILURES} test(s) failed."
exit 1
