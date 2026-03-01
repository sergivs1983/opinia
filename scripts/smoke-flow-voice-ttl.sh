#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-flow-voice-ttl.sh
#
# Smoke-tests the voice TTL purge endpoint.
#
# Prerequisites:
#   - Server running at BASE_URL (default: http://localhost:3000)
#   - INTERNAL_HMAC_SECRET set to the same value as the running server
#   - openssl and sha256sum (or shasum on macOS) available in PATH
#
# Usage:
#   INTERNAL_HMAC_SECRET=<secret> bash scripts/smoke-flow-voice-ttl.sh
#   INTERNAL_HMAC_SECRET=<secret> BASE_URL=https://staging.example.com \
#     bash scripts/smoke-flow-voice-ttl.sh
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SECRET="${INTERNAL_HMAC_SECRET:-}"
PURGE_PATH="/api/_internal/voice/purge"
PURGE_URL="${BASE_URL}${PURGE_PATH}"

PASS=0
FAIL=0

ok()   { echo "  ✓ $*"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $*" >&2; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# sha256 helper: works on both Linux (sha256sum) and macOS (shasum -a 256)
# ---------------------------------------------------------------------------
sha256hex() {
  if command -v sha256sum &>/dev/null; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

# ---------------------------------------------------------------------------
# 1. Missing secret → should get 401 immediately
# ---------------------------------------------------------------------------
echo ""
echo "=== TEST 1: Missing HMAC headers → expect 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PURGE_URL" \
  -H "Content-Type: application/json" \
  -d '{}')
if [ "$STATUS" = "401" ]; then
  ok "Got 401 for missing HMAC headers"
else
  fail "Expected 401, got $STATUS"
fi

# ---------------------------------------------------------------------------
# If no secret is set we can't run the authenticated tests
# ---------------------------------------------------------------------------
if [ -z "$SECRET" ]; then
  echo ""
  echo "WARNING: INTERNAL_HMAC_SECRET is not set — skipping authenticated tests."
  echo ""
  echo "Results: ${PASS} passed, ${FAIL} failed."
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
fi

# ---------------------------------------------------------------------------
# Helper: build HMAC headers for a POST request
# ---------------------------------------------------------------------------
hmac_headers() {
  local body="$1"
  local ts
  ts=$(date +%s000)
  local body_hex
  body_hex=$(sha256hex "$body")
  local canonical="${ts}.POST.${PURGE_PATH}.${body_hex}"
  local sig
  sig=$(printf '%s' "$canonical" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
  echo "${ts} ${sig}"
}

# ---------------------------------------------------------------------------
# 2. Valid HMAC → expect 200 { ok: true, deleted: N }
# ---------------------------------------------------------------------------
echo ""
echo "=== TEST 2: Valid HMAC → expect 200 ==="
RAW_BODY="{}"
read -r TS SIG <<< "$(hmac_headers "$RAW_BODY")"

HTTP_STATUS=$(curl -s -o /tmp/_purge_resp.json -w "%{http_code}" \
  -X POST "$PURGE_URL" \
  -H "Content-Type: application/json" \
  -H "x-opin-timestamp: $TS" \
  -H "x-opin-signature: $SIG" \
  -d "$RAW_BODY")

RESP=$(cat /tmp/_purge_resp.json)

if [ "$HTTP_STATUS" = "200" ]; then
  ok "HTTP 200"
else
  fail "Expected 200, got $HTTP_STATUS — body: $RESP"
fi

if echo "$RESP" | grep -q '"ok":true'; then
  ok "Response contains ok:true"
else
  fail "Response missing ok:true — body: $RESP"
fi

if echo "$RESP" | grep -q '"deleted":'; then
  DELETED=$(echo "$RESP" | grep -o '"deleted":[0-9]*' | grep -o '[0-9]*')
  ok "Response contains deleted:${DELETED}"
else
  fail "Response missing deleted count — body: $RESP"
fi

# ---------------------------------------------------------------------------
# 3. Replayed timestamp → expect 401 (replay_window)
# ---------------------------------------------------------------------------
echo ""
echo "=== TEST 3: Stale timestamp → expect 401 (replay_window) ==="
OLD_TS=$(( $(date +%s) - 400 ))000   # 400 seconds ago, beyond 5-min window
OLD_BODY="{}"
OLD_BODY_HEX=$(sha256hex "$OLD_BODY")
OLD_CANONICAL="${OLD_TS}.POST.${PURGE_PATH}.${OLD_BODY_HEX}"
OLD_SIG=$(printf '%s' "$OLD_CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PURGE_URL" \
  -H "Content-Type: application/json" \
  -H "x-opin-timestamp: $OLD_TS" \
  -H "x-opin-signature: $OLD_SIG" \
  -d "$OLD_BODY")

if [ "$STATUS" = "401" ]; then
  ok "Got 401 for stale timestamp"
else
  fail "Expected 401 (replay_window), got $STATUS"
fi

# ---------------------------------------------------------------------------
# 4. Wrong signature → expect 401 (signature_mismatch)
# ---------------------------------------------------------------------------
echo ""
echo "=== TEST 4: Wrong signature → expect 401 (signature_mismatch) ==="
VALID_BODY="{}"
read -r V_TS _ <<< "$(hmac_headers "$VALID_BODY")"
BAD_SIG="0000000000000000000000000000000000000000000000000000000000000000"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PURGE_URL" \
  -H "Content-Type: application/json" \
  -H "x-opin-timestamp: $V_TS" \
  -H "x-opin-signature: $BAD_SIG" \
  -d "$VALID_BODY")

if [ "$STATUS" = "401" ]; then
  ok "Got 401 for bad signature"
else
  fail "Expected 401 (signature_mismatch), got $STATUS"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "====================================================="
echo "Results: ${PASS} passed, ${FAIL} failed."
echo "====================================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
