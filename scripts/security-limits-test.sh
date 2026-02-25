#!/usr/bin/env bash
# security-limits-test.sh
#
# Smoke-tests query-param limit validation against the probe endpoint.
# Assumes the dev server is already running on localhost:3000.
# Does NOT start the server itself.
#
# Usage:  npm run check:limits
#         bash scripts/security-limits-test.sh
#
# Exit 0 = all assertions passed
# Exit 1 = server not running, or an assertion failed

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
PROBE="$BASE/api/limits-probe"

PASS=0
FAIL=0

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }

# ── Check server reachability ─────────────────────────────────────────────────
echo "Query-limit smoke-tests  →  $PROBE  (GET)"
echo "──────────────────────────────────────────────────────"

if ! curl -s --max-time 5 "$BASE/api/health" > /dev/null 2>&1; then
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

# ── Test: absurd limit → 400 ──────────────────────────────────────────────────
assert_status \
  "GET limit=999999 → expect 400" \
  "400" \
  -G "$PROBE" \
  --data-urlencode "limit=999999"

# ── Test: max allowed limit → 200 ────────────────────────────────────────────
assert_status \
  "GET limit=100 → expect 200" \
  "200" \
  -G "$PROBE" \
  --data-urlencode "limit=100"

# ── Test: limit=0 (below min) → 400 ──────────────────────────────────────────
assert_status \
  "GET limit=0 → expect 400" \
  "400" \
  -G "$PROBE" \
  --data-urlencode "limit=0"

# ── Test: non-integer limit → 400 ────────────────────────────────────────────
assert_status \
  "GET limit=abc → expect 400" \
  "400" \
  -G "$PROBE" \
  --data-urlencode "limit=abc"

# ── Test: no limit param (default) → 200 ─────────────────────────────────────
assert_status \
  "GET (no limit param) → expect 200" \
  "200" \
  "$PROBE"

# ── Summary ───────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
