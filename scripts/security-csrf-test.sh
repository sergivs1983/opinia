#!/usr/bin/env bash
# security-csrf-test.sh
#
# Smoke-tests the CSRF guard against the probe endpoint.
# Assumes the dev server is already running on localhost:3000.
# Does NOT start the server itself.
#
# Usage:  npm run check:csrf
#         bash scripts/security-csrf-test.sh
#
# Exit 0 = all assertions passed
# Exit 1 = server not running, or an assertion failed

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
PROBE="$BASE/api/probe/csrf-check"

PASS=0
FAIL=0

# ── Colours (degrade gracefully if tty lacks support) ────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }

# ── Check server reachability ─────────────────────────────────────────────────
echo "CSRF guard smoke-tests  →  $PROBE  (POST)"
echo "──────────────────────────────────────────────────────"

if ! curl -sf --max-time 5 "$BASE/api/health" > /dev/null 2>&1; then
  echo -e "${YELLOW}Server not running. Start it with: npm run dev${NC}"
  exit 1
fi

# ── Helper ────────────────────────────────────────────────────────────────────
assert_status() {
  local label="$1"
  local expected="$2"
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${@:3}")
  if [ "$actual" = "$expected" ]; then
    pass "$label  (HTTP $actual)"
  else
    fail "$label  (expected HTTP $expected, got HTTP $actual)"
  fi
}

# ── Test 1: malicious origin → 403 ───────────────────────────────────────────
assert_status \
  "T1  POST with Origin: https://evil.com → expect 403" \
  "403" \
  -X POST "$PROBE" \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{}'

# ── Test 2: no origin / no referer → 403 ─────────────────────────────────────
assert_status \
  "T2  POST with no Origin and no Referer → expect 403" \
  "403" \
  -X POST "$PROBE" \
  -H "Content-Type: application/json" \
  -d '{}'

# ── Test 3: malicious referer → 403 ──────────────────────────────────────────
assert_status \
  "T3  POST with Referer from evil.com → expect 403" \
  "403" \
  -X POST "$PROBE" \
  -H "Referer: https://evil.com/page" \
  -H "Content-Type: application/json" \
  -d '{}'

# ── Test 4: allowed origin → 200 ─────────────────────────────────────────────
assert_status \
  "T4  POST with Origin: http://localhost:3000 → expect 200" \
  "200" \
  -X POST "$PROBE" \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{}'

# ── Test 5: Bearer-token request → exempt → 200 ──────────────────────────────
assert_status \
  "T5  POST with Bearer token (no Origin) → expect 200 (exempt)" \
  "200" \
  -X POST "$PROBE" \
  -H "Authorization: Bearer some-api-token" \
  -H "Content-Type: application/json" \
  -d '{}'

# ── Summary ───────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
