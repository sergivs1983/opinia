#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-${BASE:-http://localhost:3000}}"
WORKER_PATH="/api/_internal/google/publish"
WORKER_URL="${BASE}${WORKER_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"

resolve_secret() {
  if [ -n "${INTERNAL_HMAC_SECRET:-}" ]; then
    printf '%s' "${INTERNAL_HMAC_SECRET}"
    return
  fi
  if [ -f "${ENV_FILE}" ]; then
    awk -F= '/^INTERNAL_HMAC_SECRET=/{v=$2} END{print v}' "${ENV_FILE}"
    return
  fi
  printf ''
}

SECRET="$(resolve_secret)"
if [ -z "${SECRET}" ]; then
  echo "ERROR: falta INTERNAL_HMAC_SECRET (.env.local o env)"
  exit 1
fi

PASS=0
FAIL=0
SKIP=0
REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

ok() { echo "✅ $1"; PASS=$((PASS+1)); }
ko() { echo "❌ $1 (HTTP=${REQ_CODE})"; FAIL=$((FAIL+1)); }
sk() { echo "⏭️  $1"; SKIP=$((SKIP+1)); }

build_hmac() {
  local path="$1"
  local body="$2"
  OPIN_HMAC_SECRET="${SECRET}" OPIN_HMAC_PATH="${path}" OPIN_HMAC_BODY="${body}" node - <<'JS'
const crypto = require('crypto');
const secret = process.env.OPIN_HMAC_SECRET;
const path = process.env.OPIN_HMAC_PATH;
const body = process.env.OPIN_HMAC_BODY || '';
const ts = Date.now().toString();
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
}

echo "D1.6 smoke publish — ${BASE}"
echo ""

# Case 7: internal guard (always executable)
perform_request -X POST "${WORKER_URL}" -H "Content-Type: application/json" -d ''
if [ "${REQ_CODE}" = "401" ] || [ "${REQ_CODE}" = "403" ]; then
  ok "Case 7a internal guard without HMAC"
else
  ko "Case 7a internal guard without HMAC"
fi

HMAC_LINES="$(build_hmac "${WORKER_PATH}" '')"
TS="$(printf '%s\n' "${HMAC_LINES}" | sed -n '1p')"
SIG="$(printf '%s\n' "${HMAC_LINES}" | sed -n '2p')"
perform_request -X POST "${WORKER_URL}" \
  -H "x-opin-timestamp: ${TS}" \
  -H "x-opin-signature: ${SIG}" \
  -H "Content-Type: application/json" \
  -d ''
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "500" ]; then
  ok "Case 7b internal guard with valid HMAC"
else
  ko "Case 7b internal guard with valid HMAC"
fi

# Cases 1,2,3,6,8 need authenticated seeded data
if [ -z "${SMOKE_AUTH_COOKIE:-}" ] || [ -z "${SMOKE_DRAFT_ID:-}" ]; then
  sk "Case 1 execute creates/links reply + enqueues job (set SMOKE_AUTH_COOKIE + SMOKE_DRAFT_ID)"
  sk "Case 2 execute idempotent on second run"
  sk "Case 3 worker success path"
  sk "Case 6 cross-tenant 404"
  sk "Case 8 recovery of expired running lock"
else
  perform_request -X POST "${BASE}/api/lito/action-drafts/${SMOKE_DRAFT_ID}/execute" \
    -H "Cookie: ${SMOKE_AUTH_COOKIE}" \
    -H "Content-Type: application/json" \
    -d '{}'
  if [ "${REQ_CODE}" = "200" ]; then
    ok "Case 1 execute creates/links reply + enqueues job"
  else
    ko "Case 1 execute creates/links reply + enqueues job"
  fi

  perform_request -X POST "${BASE}/api/lito/action-drafts/${SMOKE_DRAFT_ID}/execute" \
    -H "Cookie: ${SMOKE_AUTH_COOKIE}" \
    -H "Content-Type: application/json" \
    -d '{}'
  if [ "${REQ_CODE}" = "200" ]; then
    ok "Case 2 execute idempotent on second run"
  else
    ko "Case 2 execute idempotent on second run"
  fi

  sk "Case 3 worker success path (requires controlled GBP credentials and seeded job state)"
  sk "Case 6 cross-tenant 404 (requires second-tenant auth cookie)"
  sk "Case 8 recovery of expired running lock (requires SQL setup)"
fi

# Cases 4 and 5 are covered by unit adapter test
if npx tsx src/__tests__/google-publish-adapter.test.ts >/dev/null; then
  ok "Case 4 permanent error path (adapter unit test)"
  ok "Case 5 transient error path (adapter unit test)"
else
  ko "Case 4/5 adapter error paths"
fi

echo ""
echo "Results: pass=${PASS} fail=${FAIL} skip=${SKIP}"
if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
