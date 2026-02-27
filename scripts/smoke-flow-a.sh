#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# smoke-flow-a.sh — Flow A local smoke tests
#
# Prerequisites:
#   1. npm run dev is running on localhost:3000
#   2. INTERNAL_HMAC_SECRET is set in .env.local (or exported in env)
#
# Usage:
#   ./scripts/smoke-flow-a.sh [base_url]
#
# Optional: override base URL, e.g.
#   BASE=https://staging.opinia.cat ./scripts/smoke-flow-a.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-${BASE:-http://localhost:3000}}"
WORKER_PATH="/api/_internal/google/publish"
WORKER_URL="${BASE}${WORKER_PATH}"

# ── Resolve INTERNAL_HMAC_SECRET ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"

if [[ -n "${INTERNAL_HMAC_SECRET:-}" ]]; then
  SECRET="${INTERNAL_HMAC_SECRET}"
elif [[ -f "${ENV_FILE}" ]]; then
  # Last-wins (dotenv semantics): grep all lines, take last
  SECRET=$(grep '^INTERNAL_HMAC_SECRET=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)
fi

if [[ -z "${SECRET:-}" ]]; then
  echo "ERROR: INTERNAL_HMAC_SECRET not found in .env.local or environment" >&2
  exit 1
fi

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; RESET='\033[0m'
PASS="${GREEN}PASS${RESET}"; FAIL="${RED}FAIL${RESET}"; SKIP="${YELLOW}SKIP${RESET}"

FAILURES=0

check() {
  local name="$1" want_code="$2" want_body_pattern="$3"
  shift 3
  local response http_code body

  response=$(curl -s -w "\n%{http_code}" --max-time 15 "$@" 2>/dev/null) || {
    echo -e "  [${FAIL}] ${name} — curl error (server down?)"
    (( FAILURES++ )); return
  }
  http_code=$(echo "${response}" | tail -1)
  body=$(echo "${response}" | sed '$d')

  local code_ok=0 body_ok=0
  [[ "${http_code}" == "${want_code}" ]] && code_ok=1
  [[ "${want_body_pattern}" == "*" ]] || echo "${body}" | grep -qE "${want_body_pattern}" && body_ok=1
  [[ "${want_body_pattern}" == "*" ]] && body_ok=1

  if [[ "${code_ok}" -eq 1 && "${body_ok}" -eq 1 ]]; then
    echo -e "  [${PASS}] ${name}  HTTP ${http_code}"
  else
    echo -e "  [${FAIL}] ${name}  HTTP ${http_code} (want ${want_code})  body=${body}"
    (( FAILURES++ ))
  fi
}

# ── Generate HMAC headers ─────────────────────────────────────────────────────
hmac_headers() {
  # Pass secret via env var to avoid shell-quoting issues with special chars
  OPIN_HMAC_SECRET="${SECRET}" OPIN_HMAC_PATH="${WORKER_PATH}" node - <<'JSEOF'
const {createHmac, createHash} = require('crypto');
const secret = process.env.OPIN_HMAC_SECRET;
const path   = process.env.OPIN_HMAC_PATH;
const ts = Date.now().toString();
const bodyHex = createHash('sha256').update('').digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHex}`;
const sig = createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`x-opin-timestamp: ${ts}\nx-opin-signature: ${sig}\n`);
JSEOF
}

HMAC_OUT=$(hmac_headers)
TS=$(echo "${HMAC_OUT}" | grep 'x-opin-timestamp' | cut -d' ' -f2)
SIG=$(echo "${HMAC_OUT}" | grep 'x-opin-signature'  | cut -d' ' -f2)

# ─────────────────────────────────────────────────────────────────────────────
echo "Flow A smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

echo ""
echo "Guard: HMAC (worker endpoint)"
# A — no HMAC headers → 401
check "no HMAC → 401" "401" '"error"' \
  -X POST "${WORKER_URL}" \
  -H "Content-Type: application/json" \
  -d ''

# B — bad signature → 401
check "bad HMAC sig → 401" "401" '"error"' \
  -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: $(date +%s)000" \
  -H "x-opin-signature: deadbeefdeadbeef" \
  -H "Content-Type: application/json" \
  -d ''

# C — replayed timestamp (way in the past → outside 5-min window) → 401
check "replayed ts → 401" "401" '"error"' \
  -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: 1000000000000" \
  -H "x-opin-signature: deadbeefdeadbeef" \
  -H "Content-Type: application/json" \
  -d ''

# D — valid HMAC → guard passes (200 if DB up, 500 rpc_error if placeholder DB)
response=$(curl -s -w "\n%{http_code}" --max-time 20 \
  -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: ${TS}" \
  -H "x-opin-signature: ${SIG}" \
  -H "Content-Type: application/json" \
  -d '' 2>/dev/null)
http_code=$(echo "${response}" | tail -1)
body=$(echo "${response}" | sed '$d')

if [[ "${http_code}" == "200" ]]; then
  echo -e "  [${PASS}] valid HMAC → 200 + JSON  body=${body}"
elif [[ "${http_code}" == "500" ]] && echo "${body}" | grep -q 'rpc_error'; then
  echo -e "  [${PASS}] valid HMAC → guard passed (rpc_error expected — no live DB)  HTTP 500"
else
  echo -e "  [${FAIL}] valid HMAC → HTTP ${http_code}  body=${body}"
  (( FAILURES++ ))
fi

echo ""
echo "Guard: middleware blocks direct cron path"
# E — direct /api/cron/worker/... → 404 (middleware)
check "direct cron path → 404" "404" '"not_found"' \
  -X POST "${BASE}/api/cron/worker/google/publish" \
  -H "Content-Type: application/json" \
  -d ''

echo ""
echo "Guard: CSRF (publish endpoint)"
# F — evil origin → 403
check "evil origin → 403" "403" '"csrf_failed"' \
  -X POST "${BASE}/api/replies/00000000-0000-0000-0000-000000000001/publish" \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.com" \
  -d '{"final_content":"test"}'

echo ""
echo "Guard: auth (session cookie required)"
# G — no session on publish → 401
check "no session publish → 401" "401" '"unauthorized"' \
  -X POST "${BASE}/api/replies/00000000-0000-0000-0000-000000000001/publish" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE}" \
  -d '{"final_content":"test"}'

# H — no session on publish-jobs → 401
check "no session publish-jobs → 401" "401" '"unauthorized"' \
  "${BASE}/api/publish-jobs/00000000-0000-0000-0000-000000000001"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [[ "${FAILURES}" -eq 0 ]]; then
  echo -e "${GREEN}All Flow A smoke tests passed.${RESET}"
else
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi
