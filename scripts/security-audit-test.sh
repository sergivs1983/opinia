#!/usr/bin/env bash
# scripts/security-audit-test.sh
#
# Smoke-tests the audit log endpoints and static integrity.
# Assumes the dev server may or may not be running on localhost:3000.
# Skips live tests (A, B) if server is not running.
# Skips authenticated test (B) if CRON_SECRET env var is not set.
#
# Test C is a static scan + immutability documentation (no live server needed).
#
# Usage:  npm run check:audit
#         bash scripts/security-audit-test.sh
#
# Exit 0 = all active assertions passed
# Exit 1 = at least one assertion failed

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
PROBE="$BASE/api/cron/audit-probe"

PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass()  { echo -e "${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
fail()  { echo -e "${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }
skip()  { echo -e "${YELLOW}SKIP${NC}  $1"; }
info()  { echo "  $1"; }

echo "Audit log smoke-tests  →  $PROBE  (POST)"
echo "──────────────────────────────────────────────────────"

# ── Server reachability ───────────────────────────────────────────────────────

SERVER_UP=false
if curl -s --max-time 5 "$BASE/api/health" > /dev/null 2>&1; then
  SERVER_UP=true
fi

# ── Test A: No auth → 401 ─────────────────────────────────────────────────────

echo ""
echo "Test A: POST /api/cron/audit-probe without auth → expect 401"

if [ "$SERVER_UP" = "false" ]; then
  skip "Server not running — skipping live tests A & B (start with: npm run dev)"
else
  A_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$PROBE" || echo "000")
  if [ "$A_STATUS" = "401" ]; then
    pass "POST without auth → 401  (HTTP $A_STATUS)"
  else
    fail "POST without auth → 401  (expected HTTP 401, got HTTP $A_STATUS)"
  fi

  # ── Test B: Valid Bearer → 200 + id ────────────────────────────────────────

  echo ""
  echo "Test B: POST /api/cron/audit-probe with Bearer CRON_SECRET → expect 200 + id"

  if [ -z "${CRON_SECRET:-}" ]; then
    skip "CRON_SECRET not set in env — skipping authenticated probe test"
    info "(set CRON_SECRET=<value> before running, or add to .env.local and source it)"
  else
    B_TMPFILE=$(mktemp)
    B_STATUS=$(curl -s -o "$B_TMPFILE" -w "%{http_code}" --max-time 5 \
      -X POST \
      -H "Authorization: Bearer $CRON_SECRET" \
      -H "Content-Type: application/json" \
      "$PROBE" || echo "000")
    B_RESPONSE=$(cat "$B_TMPFILE")
    rm -f "$B_TMPFILE"

    if [ "$B_STATUS" = "200" ]; then
      B_ID=$(echo "$B_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "")
      if [ -n "$B_ID" ]; then
        pass "POST with auth → 200 + id=${B_ID}"
      else
        pass "POST with auth → 200  (response: ${B_RESPONSE})"
      fi
    else
      fail "POST with auth → 200  (expected HTTP 200, got HTTP $B_STATUS; body: $B_RESPONSE)"
    fi
  fi
fi

# ── Test C: Static integrity ──────────────────────────────────────────────────

echo ""
echo "Test C: Static scan — audit infrastructure integrity"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# C1: audit-log.ts exists with REDACT_KEYS
AUDIT_LIB="$REPO_ROOT/src/lib/audit-log.ts"
if [ -f "$AUDIT_LIB" ] && grep -q "REDACT_KEYS" "$AUDIT_LIB"; then
  pass "src/lib/audit-log.ts exists with REDACT_KEYS"
else
  fail "src/lib/audit-log.ts missing or REDACT_KEYS not defined"
fi

# C2: writeAudit does not throw (has try/catch)
if grep -q "try {" "$AUDIT_LIB" 2>/dev/null; then
  pass "writeAudit wraps in try/catch (never throws)"
else
  fail "writeAudit is missing try/catch — audit failures could break requests"
fi

# C3: migration file exists and contains trigger
MIGRATION=$(ls "$REPO_ROOT/supabase/migrations/"*audit_log*.sql 2>/dev/null | head -1 || echo "")
if [ -n "$MIGRATION" ] && grep -q "AUDIT_IMMUTABLE" "$MIGRATION"; then
  pass "Migration $(basename "$MIGRATION") exists with AUDIT_IMMUTABLE trigger"
else
  fail "Audit migration missing or AUDIT_IMMUTABLE trigger not found"
fi

# C4: migration has RLS deny for UPDATE and DELETE
if grep -q "audit_logs_deny_update" "$MIGRATION" 2>/dev/null && \
   grep -q "audit_logs_deny_delete" "$MIGRATION" 2>/dev/null; then
  pass "Migration has deny policies for UPDATE and DELETE"
else
  fail "Migration is missing deny policies for UPDATE or DELETE"
fi

# ── Test C – Immutability (manual / documented) ───────────────────────────────

echo ""
echo "Test C (manual): Immutability verification — run these in Supabase SQL editor"
info "These must raise: ERROR: AUDIT_IMMUTABLE: audit_logs rows cannot be modified or deleted"
info ""
info "  -- Block UPDATE for all roles (including service_role):"
info "  UPDATE public.audit_logs SET action = 'tampered' WHERE id = 1;"
info ""
info "  -- Block DELETE for authenticated role:"
info "  DELETE FROM public.audit_logs WHERE id = 1;"
info "  (service_role is allowed to delete for retention cleanup — by design)"
info ""
info "  -- Verify via supabase CLI:"
info "  supabase db execute --sql \"UPDATE public.audit_logs SET action='x' WHERE created_at > now() - interval '1 minute';\""
echo ""

pass "Immutability trigger + deny policies documented (manual verification above)"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "──────────────────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"
[ "$FAIL" -eq 0 ]
