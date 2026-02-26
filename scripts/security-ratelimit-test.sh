#!/usr/bin/env bash
# security-ratelimit-test.sh — Bloc 8
#
# Smoke-tests the rate limit + AI daily quota guard against probe endpoints.
# Assumes the dev server is already running on localhost:3000.
# Does NOT start the server itself.
#
# Usage:  npm run check:ratelimit
#         bash scripts/security-ratelimit-test.sh
#
# Exit 0 = all assertions passed, OR server not running (skipped)
# Exit 1 = an assertion failed

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
STANDARD_PROBE="$BASE/api/ratelimit-probe"
AI_PROBE="$BASE/api/ai-quota-probe"

PASS=0
FAIL=0

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }

# ── Check server reachability ──────────────────────────────────────────────────
echo "Rate limit smoke-tests  →  $BASE"
echo "──────────────────────────────────────────────────────"

if ! curl -s --max-time 5 "$BASE/api/health" > /dev/null 2>&1; then
  echo -e "${YELLOW}Server not running — skipping live rate-limit tests (start with: npm run dev)${NC}"
  exit 0
fi

# ── Unique keys per run to avoid cross-run pollution ──────────────────────────
RUN_ID="$(date +%s%3N)"
STD_BIZ="std-biz-${RUN_ID}"
STD_USER="std-user-${RUN_ID}"
AI_BIZ="ai-biz-${RUN_ID}"
AI_USER="ai-user-${RUN_ID}"
QUOTA_BIZ="quota-biz-${RUN_ID}"
QUOTA_USER="quota-user-${RUN_ID}"

# ── Helper: assert that at least one of N parallel requests returns the expected status ──
assert_any_status() {
  local label="$1"
  local count="$2"
  local expected="$3"
  shift 3
  local args=("$@")

  # Run `count` requests in parallel using xargs; collect HTTP status codes
  local got
  got=$(seq "$count" | xargs -P 50 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
        --max-time 5 "${args[@]}" 2>/dev/null | sort | uniq -c | tr -s ' ')

  if echo "$got" | grep -q " ${expected}$"; then
    pass "$label  (found HTTP $expected among $count responses)"
  else
    fail "$label  (expected at least one HTTP $expected in $count responses; got: $got)"
  fi
}

# ── Helper: assert exact status for a single request ──────────────────────────
assert_status() {
  local label="$1"
  local expected="$2"
  shift 2
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@")
  if [ "$actual" = "$expected" ]; then
    pass "$label  (HTTP $actual)"
  else
    fail "$label  (expected HTTP $expected, got HTTP $actual)"
  fi
}

# ════════════════════════════════════════════════════════════════════════════════
# TEST 1 — Standard rate limit (300 req/60 s)
# Send 305 parallel requests to /api/ratelimit-probe; expect at least one 429.
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "Test 1: Standard rate limit (305 requests, limit 300/60s)"

assert_any_status \
  "305 requests → at least one 429" \
  305 \
  429 \
  -X GET "$STANDARD_PROBE" \
  -H "x-biz-id: $STD_BIZ" \
  -H "x-user-id: $STD_USER"

# ════════════════════════════════════════════════════════════════════════════════
# TEST 2 — AI rate limit (20 req/60 s)
# Send 25 parallel requests to /api/ai-quota-probe with a high test quota
# (x-test-limit: 10000) so only the rate limiter fires, not the quota.
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "Test 2: AI rate limit (25 requests, limit 20/60s)"

assert_any_status \
  "25 requests → at least one 429 rate limit" \
  25 \
  429 \
  -X POST "$AI_PROBE" \
  -H "x-biz-id: $AI_BIZ" \
  -H "x-user-id: $AI_USER" \
  -H "x-plan: free" \
  -H "x-test-limit: 10000" \
  -H "Content-Type: application/json"

# ════════════════════════════════════════════════════════════════════════════════
# TEST 3 — Daily AI quota (limit 3, 4th hit → 429 "Daily quota exceeded")
# Uses x-test-limit: 3 to override the quota limit for this test bizId.
# Each request is sequential so the INCR is deterministic.
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "Test 3: Daily AI quota (4 sequential requests, limit 3)"

# Use a unique bizId for this test to ensure a fresh quota counter.
# Requests 1-3: expect 200
for i in 1 2 3; do
  assert_status \
    "Quota request $i/3 → expect 200" \
    "200" \
    -X POST "$AI_PROBE" \
    -H "x-biz-id: $QUOTA_BIZ" \
    -H "x-user-id: $QUOTA_USER" \
    -H "x-plan: free" \
    -H "x-test-limit: 3" \
    -H "Content-Type: application/json"
done

# Request 4: expect 429 "Daily quota exceeded"
BODY_4=$(curl -s --max-time 5 \
  -X POST "$AI_PROBE" \
  -H "x-biz-id: $QUOTA_BIZ" \
  -H "x-user-id: $QUOTA_USER" \
  -H "x-plan: free" \
  -H "x-test-limit: 3" \
  -H "Content-Type: application/json" \
  -w '\n%{http_code}' 2>/dev/null)

STATUS_4=$(echo "$BODY_4" | tail -1)
BODY_TEXT=$(echo "$BODY_4" | head -1)

if [ "$STATUS_4" = "429" ] && echo "$BODY_TEXT" | grep -q "Daily quota exceeded"; then
  pass "Quota request 4/3 → 429 Daily quota exceeded"
else
  fail "Quota request 4/3 → expected 429 'Daily quota exceeded', got HTTP $STATUS_4: $BODY_TEXT"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
