#!/usr/bin/env bash
# security-monitoring-test.sh — Bloc 9
#
# Verifies the observability / monitoring setup:
#   A) x-request-id header present on /api/health (correlation sanity)
#   B) /api/observability-probe returns 200 in dev (Sentry context probe)
#   C) Static: no hardcoded SENTRY_DSN values; no raw token literals (sk-…) in src/
#
# Assumes dev server is already running on localhost:3000.
# Does NOT start the server itself.
#
# Usage:  npm run check:monitoring
#         bash scripts/security-monitoring-test.sh
#
# Exit 0 = all assertions passed, OR server not running (tests A & B skipped)
# Exit 1 = an assertion failed

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }

echo "Monitoring smoke-tests  →  $BASE"
echo "──────────────────────────────────────────────────────"

# ── Server reachability check ──────────────────────────────────────────────────
SERVER_UP=true
if ! curl -s --max-time 5 "$BASE/api/health" > /dev/null 2>&1; then
  echo -e "${YELLOW}Server not running — skipping live tests A & B (start with: npm run dev)${NC}"
  SERVER_UP=false
fi

# ════════════════════════════════════════════════════════════════════════════════
# TEST A — x-request-id header present on /api/health (correlation sanity)
# ════════════════════════════════════════════════════════════════════════════════
if [ "$SERVER_UP" = "true" ]; then
  echo ""
  echo "Test A: x-request-id header on /api/health"

  RID=$(curl -s -I --max-time 5 "$BASE/api/health" 2>/dev/null \
    | grep -i '^x-request-id:' | head -1 | tr -d '\r\n' || true)

  if [[ -n "$RID" ]]; then
    pass "x-request-id present  ($RID)"
  else
    fail "x-request-id header MISSING from /api/health response"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════════
# TEST B — /api/observability-probe returns 200 in dev
# ════════════════════════════════════════════════════════════════════════════════
if [ "$SERVER_UP" = "true" ]; then
  echo ""
  echo "Test B: /api/observability-probe → expect 200 (dev)"

  STATUS_B=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
    "$BASE/api/observability-probe" 2>/dev/null)

  if [ "$STATUS_B" = "200" ]; then
    pass "GET /api/observability-probe → 200"
  else
    fail "GET /api/observability-probe → expected 200, got $STATUS_B"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════════
# TEST C — Static: no hardcoded SENTRY_DSN or raw API-key literals in src/
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "Test C: Static scan — no hardcoded SENTRY_DSN or token literals"

# C1: SENTRY_DSN must not be hardcoded (i.e. assigned a real "https://…@sentry.io" value)
SENTRY_HARDCODED=$(grep -rn --include='*.ts' --include='*.tsx' --include='*.js' \
  -E 'SENTRY_DSN\s*=\s*"https://' \
  src/ sentry.*.ts sentry.*.config.ts instrumentation.ts 2>/dev/null || true)

if [[ -z "$SENTRY_HARDCODED" ]]; then
  pass "No hardcoded SENTRY_DSN value in source files"
else
  fail "Hardcoded SENTRY_DSN found:\n$SENTRY_HARDCODED"
fi

# C2: No raw sk-… API key strings in src/ (catches accidental commits)
SK_TOKENS=$(grep -rn --include='*.ts' --include='*.tsx' \
  -E '"sk-[a-zA-Z0-9]{10,}"' \
  src/ 2>/dev/null || true)

if [[ -z "$SK_TOKENS" ]]; then
  pass "No raw sk-… token literals in src/"
else
  fail "Raw API-key literals found in src/:\n$SK_TOKENS"
fi

# C3: beforeSendPIISafe is referenced in all 3 Sentry config files
for cfg in sentry.client.config.ts sentry.server.config.ts sentry.edge.config.ts; do
  if grep -q "beforeSendPIISafe" "$cfg" 2>/dev/null; then
    pass "$cfg references beforeSendPIISafe"
  else
    fail "$cfg does NOT reference beforeSendPIISafe"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
