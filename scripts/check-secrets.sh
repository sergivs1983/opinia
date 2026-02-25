#!/usr/bin/env bash
# check-secrets.sh — Static secrets-hygiene gate.
#
# Checks (all static — no server required):
#   1. .env.local is NOT tracked by git
#   2. No hardcoded secrets (real tokens/keys) in source files
#   3. No NEXT_PUBLIC_* secret vars in tracked .env files (non-example)
#
# Scan targets: src/  scripts/  next.config.*  middleware.ts
# Exclusions:   node_modules  .next  dist  package-lock.json
#               check-secrets.sh (this file)  SECURITY_NOTES.md
#
# Usage:  npm run check:secrets
#         bash scripts/check-secrets.sh
#
# Exit 0 = PASS: secrets hygiene
# Exit 1 = at least one check failed

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
FAIL=0

pass() { echo -e "${GREEN}PASS${NC}  $*"; }
fail() { echo -e "${RED}FAIL${NC}  $*"; FAIL=1; }

# ── 1. .env.local must not be tracked by git ─────────────────────────────────
if git ls-files --error-unmatch .env.local >/dev/null 2>&1; then
  fail ".env.local is tracked by git — fix: git rm --cached .env.local"
else
  pass ".env.local is not tracked by git"
fi

# ── 2. Hardcoded secrets in source ───────────────────────────────────────────
# Build array of targets that actually exist
TARGETS=()
for p in src scripts next.config.js next.config.ts next.config.mjs \
         middleware.ts src/middleware.ts; do
  [ -e "$p" ] && TARGETS+=("$p")
done

EXCLUDES=(
  "--exclude-dir=node_modules"
  "--exclude-dir=.next"
  "--exclude-dir=dist"
  "--exclude=package-lock.json"
  "--exclude=check-secrets.sh"
  "--exclude=SECURITY_NOTES.md"
)

SECRETS_FOUND=0

# Helper: run one grep pattern; print matches and mark failure
check() {
  local label="$1"
  local pattern="$2"
  local hits
  hits=$(grep -rEn "${EXCLUDES[@]}" -- "$pattern" "${TARGETS[@]}" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "$hits"
    fail "$label"
    SECRETS_FOUND=1
  fi
}

# sk-... keys (OpenAI, Anthropic) hardcoded inside quotes
check "hardcoded sk-... key" \
  '"sk-[A-Za-z0-9]{20,}"|'"'"'sk-[A-Za-z0-9]{20,}'"'"

# Real JWT tokens inside quotes (requires 30+ base64url chars — avoids matching
# regex pattern literals like [A-Za-z0-9_\-\.]+ which contain '[')
check "hardcoded JWT token" \
  '"eyJhbGciOi[A-Za-z0-9+/_-]{30,}"|'"'"'eyJhbGciOi[A-Za-z0-9+/_-]{30,}'"'"

# PEM private keys
check "PEM private key" \
  '-----BEGIN (RSA |EC )?PRIVATE KEY-----'

# Object-literal secret assignments: { KEY_NAME: "actual_value" }
# process.env.KEY_NAME refs are NOT matched (no "KEY": "value" syntax)
check 'object-literal SUPABASE_SERVICE_ROLE_KEY value' \
  '"SUPABASE_SERVICE_ROLE_KEY"[[:space:]]*:[[:space:]]*"[^"]+"'
check 'object-literal OPENAI_API_KEY value' \
  '"OPENAI_API_KEY"[[:space:]]*:[[:space:]]*"[^"]+"'
check 'object-literal STRIPE_SECRET_KEY value' \
  '"STRIPE_SECRET_KEY"[[:space:]]*:[[:space:]]*"[^"]+"'

[ "$SECRETS_FOUND" -eq 0 ] && pass "no hardcoded secrets found in source"

# ── 3. No NEXT_PUBLIC_ secret keys in tracked .env files (skip *.example) ────
TRACKED_ENV=$(git ls-files | grep -E '^\.env' | grep -v '\.example$' || true)
if [ -n "$TRACKED_ENV" ]; then
  env_hits=$(echo "$TRACKED_ENV" | xargs grep -En \
    'NEXT_PUBLIC_.*(KEY|SECRET|TOKEN)' 2>/dev/null || true)
  if [ -n "$env_hits" ]; then
    echo "$env_hits"
    fail "NEXT_PUBLIC_ secret key found in a tracked .env file"
  else
    pass "no NEXT_PUBLIC_ secret keys in tracked .env files"
  fi
else
  pass "no non-example .env files are tracked"
fi

# ── Result ────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}PASS: secrets hygiene${NC}"
  exit 0
else
  exit 1
fi
